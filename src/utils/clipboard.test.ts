import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { copyTextToClipboardFromUserGesture } from './clipboard';

test('user-gesture clipboard copy runs the synchronous fallback before async browser APIs', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let modernClipboardCalls = 0;
  let copiedValue = '';

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          modernClipboardCalls++;
        },
      },
    },
  });
  Object.defineProperty(dom.window.document, 'execCommand', {
    configurable: true,
    value: () => {
      copiedValue = dom.window.document.querySelector('textarea')?.value ?? '';
      return true;
    },
  });

  try {
    assert.equal(await copyTextToClipboardFromUserGesture('Herdr selection'), true);
    assert.equal(copiedValue, 'Herdr selection');
    assert.equal(modernClipboardCalls, 0);
  } finally {
    dom.window.close();
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
});
