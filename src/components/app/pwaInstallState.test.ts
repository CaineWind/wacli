import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasSeenPwaInstallPrompt,
  markPwaInstallPromptSeen,
  PWA_INSTALL_PROMPT_SEEN_KEY,
} from './pwaInstallState';

test('persists that the automatic PWA install prompt has been shown', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.equal(hasSeenPwaInstallPrompt(storage), false);
  markPwaInstallPromptSeen(storage);
  assert.equal(values.get(PWA_INSTALL_PROMPT_SEEN_KEY), 'true');
  assert.equal(hasSeenPwaInstallPrompt(storage), true);
});

test('does not break PWA startup when browser storage is unavailable', () => {
  const unavailableStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };

  assert.equal(hasSeenPwaInstallPrompt(unavailableStorage), false);
  assert.doesNotThrow(() => markPwaInstallPromptSeen(unavailableStorage));
});
