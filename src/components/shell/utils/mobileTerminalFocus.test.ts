import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import type { Terminal } from '@xterm/xterm';

import {
  createHerdrTerminalFocusScheduler,
  installMobileTerminalSelection,
} from './mobileTerminalSelection';

test('Herdr terminal focus waits for touch defaults and skips stale requests', async () => {
  let focusCount = 0;
  let canFocus = true;
  const scheduler = createHerdrTerminalFocusScheduler(() => { focusCount++; });

  scheduler.schedule(() => canFocus);
  assert.equal(focusCount, 0);

  await Promise.resolve();
  assert.equal(focusCount, 1);

  scheduler.schedule(() => canFocus);
  scheduler.schedule(() => canFocus);
  await Promise.resolve();
  assert.equal(focusCount, 2);

  scheduler.schedule(() => canFocus);
  scheduler.cancel();
  await Promise.resolve();
  assert.equal(focusCount, 2);

  scheduler.schedule(() => canFocus);
  canFocus = false;
  await Promise.resolve();
  assert.equal(focusCount, 2);
});

test('a plain Herdr tap prevents the browser default before restoring focus', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'Node'] as const;
  const previousGlobals = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  t.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[name];
      }
    }
    dom.window.close();
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
  });
  Object.defineProperty(dom.window, 'ontouchstart', { configurable: true, value: null });

  const terminalContent = document.createElement('div');
  const terminalElement = document.createElement('div');
  terminalContent.appendChild(terminalElement);
  document.body.appendChild(terminalContent);

  let focusCount = 0;
  const disposable = { dispose: () => undefined };
  const terminal = {
    element: terminalElement,
    options: { fontSize: 14 },
    rows: 24,
    cols: 80,
    buffer: { active: { viewportY: 0, getLine: () => null } },
    focus: () => { focusCount++; },
    onSelectionChange: () => disposable,
    onResize: () => disposable,
    onScroll: () => disposable,
  } as unknown as Terminal;

  const manager = installMobileTerminalSelection(terminal, terminalContent, {
    onTouchScroll: () => false,
  });
  assert.ok(manager);

  const touchStart = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(touchStart, 'touches', {
    value: [{ clientX: 20, clientY: 20 }],
  });
  terminalElement.dispatchEvent(touchStart);

  const touchEnd = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
  Object.defineProperty(touchEnd, 'touches', { value: [] });
  terminalElement.dispatchEvent(touchEnd);

  assert.equal(touchEnd.defaultPrevented, true);
  await Promise.resolve();
  assert.equal(focusCount, 1);
  manager.dispose();
});
