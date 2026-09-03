import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { usePwaInstall, type PwaInstallContextValue } from './PwaInstallContext';
import { PwaInstallProvider } from './PwaInstallProvider';

test('offers install automatically once while keeping manual install available', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://windcli.test',
  });
  const globalNames = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Node',
    'Event',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const;
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
    Event: { configurable: true, value: dom.window.Event },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
  });

  let installState: PwaInstallContextValue | undefined;
  const Probe = ({ children }: { children?: ReactNode }) => {
    installState = usePwaInstall();
    return children ?? null;
  };
  const dispatchInstallPrompt = async () => {
    const event = new dom.window.Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    });
    await act(async () => dom.window.dispatchEvent(event));
  };
  const mountProvider = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<PwaInstallProvider><Probe /></PwaInstallProvider>);
    });
    return root;
  };

  const firstRoot = await mountProvider();
  await dispatchInstallPrompt();
  assert.equal(installState?.automaticPromptVisible, true);
  assert.equal(installState?.canInstall, true);
  installState?.recordAutomaticPromptShown();
  await act(async () => firstRoot.unmount());

  const refreshedRoot = await mountProvider();
  await dispatchInstallPrompt();
  assert.equal(installState?.automaticPromptVisible, false);
  assert.equal(installState?.canInstall, true);
  await act(async () => refreshedRoot.unmount());
});
