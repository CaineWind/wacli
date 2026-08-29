import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHerdrTouchScrollHandler,
  encodeTerminalBinaryInput,
  installTerminalInputSync,
} from './terminalInput';

test('terminal binary input preserves non-UTF-8 mouse report bytes', () => {
  const report = String.fromCharCode(0x1b, 0x5b, 0x4d, 0x20, 0xff, 0x21);

  assert.equal(encodeTerminalBinaryInput(report), 'G1tNIP8h');
});

function createTouchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
}

test('Herdr converts one-finger vertical swipes into mouse wheel input', () => {
  const terminal = {
    cols: 120,
    rows: 40,
  };
  const getBoundingClientRect = () => ({
      bottom: 800,
      height: 800,
      left: 0,
      right: 1200,
      top: 0,
      width: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const messages: Array<Record<string, unknown>> = [];
  const handleTouchScroll = createHerdrTouchScrollHandler({
    terminal: terminal as never,
    getBoundingClientRect,
    send: (message) => messages.push(message),
  });

  const handledUp = handleTouchScroll(40, { clientX: 600, clientY: 560 });
  const handledDown = handleTouchScroll(-60, { clientX: 600, clientY: 620 });

  assert.equal(handledUp, true);
  assert.equal(handledDown, true);
  assert.deepEqual(messages, [
    { type: 'input', data: '\x1b[<65;61;29M'.repeat(2) },
    { type: 'input', data: '\x1b[<64;61;32M'.repeat(3) },
  ]);

  messages.length = 0;
  handleTouchScroll.reset();
  handleTouchScroll(10, { clientX: 600, clientY: 560 });
  handleTouchScroll.reset();
  handleTouchScroll(10, { clientX: 600, clientY: 560 });
  assert.deepEqual(messages, []);
});

test('Herdr terminal input sync forwards events, restores mouse tracking, and disposes cleanly', () => {
  const listeners = {
    binary: null as ((data: string) => void) | null,
    data: null as ((data: string) => void) | null,
    parsed: null as (() => void) | null,
  };
  const terminal = {
    cols: 120,
    modes: { mouseTrackingMode: 'none' },
    rows: 40,
    writes: [] as string[],
    write(data: string) {
      this.writes.push(data);
    },
    onBinary(listener: (data: string) => void) {
      listeners.binary = listener;
      return { dispose: () => { listeners.binary = null; } };
    },
    onData(listener: (data: string) => void) {
      listeners.data = listener;
      return { dispose: () => { listeners.data = null; } };
    },
    onWriteParsed(listener: () => void) {
      listeners.parsed = listener;
      return { dispose: () => { listeners.parsed = null; } };
    },
  };
  const container = new EventTarget();
  const focusTarget = new EventTarget();
  const visibilityTarget = new EventTarget();
  let isVisible = true;
  const messages: Array<Record<string, unknown>> = [];

  const dispose = installTerminalInputSync({
    terminal: terminal as never,
    container: container as never,
    focusTarget,
    isVisible: () => isVisible,
    shellMode: 'herdr',
    send: (message) => messages.push(message),
    visibilityTarget,
  });

  assert.deepEqual(terminal.writes, ['\x1b[?1002h\x1b[?1006h']);
  terminal.modes.mouseTrackingMode = 'drag';
  listeners.data?.('typed');
  listeners.binary?.(String.fromCharCode(0xff));
  assert.deepEqual(messages, [
    { type: 'input', data: 'typed' },
    { type: 'input_binary', data: '/w==' },
  ]);

  focusTarget.dispatchEvent(new Event('focus'));
  container.dispatchEvent(new Event('pointerdown'));
  container.dispatchEvent(new Event('keydown'));
  assert.deepEqual(messages.slice(2), [{
    type: 'viewport_claim',
    cols: 120,
    rows: 40,
  }]);

  focusTarget.dispatchEvent(new Event('blur'));
  container.dispatchEvent(new Event('keydown'));
  isVisible = false;
  visibilityTarget.dispatchEvent(new Event('visibilitychange'));
  isVisible = true;
  visibilityTarget.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(messages.slice(2), Array.from({ length: 3 }, () => ({
    type: 'viewport_claim',
    cols: 120,
    rows: 40,
  })));

  const contextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(contextMenuEvent);
  assert.equal(contextMenuEvent.defaultPrevented, true);

  terminal.modes.mouseTrackingMode = 'none';
  listeners.parsed?.();
  assert.equal(terminal.writes.length, 2);

  dispose();
  assert.deepEqual(listeners, { binary: null, data: null, parsed: null });
  const disposedContextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(disposedContextMenuEvent);
  assert.equal(disposedContextMenuEvent.defaultPrevented, false);
  focusTarget.dispatchEvent(new Event('blur'));
  focusTarget.dispatchEvent(new Event('focus'));
  assert.equal(messages.length, 5);
});

test('default shell input sync leaves browser context menus and mouse tracking unchanged', () => {
  const terminal = {
    cols: 80,
    modes: { mouseTrackingMode: 'none' },
    rows: 24,
    writes: [] as string[],
    write(data: string) {
      this.writes.push(data);
    },
    onBinary: () => ({ dispose: () => undefined }),
    onData: () => ({ dispose: () => undefined }),
    onWriteParsed: () => ({ dispose: () => undefined }),
  };
  const container = new EventTarget();
  const focusTarget = new EventTarget();
  const messages: Array<Record<string, unknown>> = [];
  const dispose = installTerminalInputSync({
    terminal: terminal as never,
    container: container as never,
    focusTarget,
    shellMode: 'default',
    send: (message) => messages.push(message),
  });

  const contextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(contextMenuEvent);
  assert.equal(contextMenuEvent.defaultPrevented, false);
  container.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 20 }]));
  const touchMoveEvent = createTouchEvent('touchmove', [{ clientX: 10, clientY: 0 }]);
  container.dispatchEvent(touchMoveEvent);
  assert.equal(touchMoveEvent.defaultPrevented, false);
  assert.deepEqual(terminal.writes, []);
  focusTarget.dispatchEvent(new Event('focus'));
  assert.deepEqual(messages, []);

  dispose();
});
