import assert from 'node:assert/strict';
import test from 'node:test';

import { createOscClipboardProvider } from './terminalClipboard';

test('OSC clipboard writes expose the text for a user-gesture retry when browser copy fails', async () => {
  const failures: string[] = [];
  const provider = createOscClipboardProvider({
    copyText: async () => false,
    onCopyFailed: (text) => failures.push(text),
  });

  await provider.writeText('c' as never, 'selected from Herdr');

  assert.deepEqual(failures, ['selected from Herdr']);
});

test('successful OSC clipboard writes do not request a retry', async () => {
  const failures: string[] = [];
  const provider = createOscClipboardProvider({
    copyText: async () => true,
    onCopyFailed: (text) => failures.push(text),
  });

  await provider.writeText('c' as never, 'copied');

  assert.deepEqual(failures, []);
});

test('OSC clipboard provider ignores non-system selections', async () => {
  const copied: string[] = [];
  const provider = createOscClipboardProvider({
    copyText: async (text) => {
      copied.push(text);
      return true;
    },
    onCopyFailed: () => undefined,
  });

  await provider.writeText('p' as never, 'primary selection');

  assert.deepEqual(copied, []);
});
