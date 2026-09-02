import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePwaPromptKind } from './pwaLifecycleState';

const baseState = {
  installAvailable: false,
  installDismissed: false,
  needRefresh: false,
  offlineDismissed: false,
  offlineReady: false,
};

test('prioritizes an available update over install and offline prompts', () => {
  assert.equal(resolvePwaPromptKind({
    ...baseState,
    installAvailable: true,
    needRefresh: true,
    offlineReady: true,
  }), 'update');
});

test('shows install only while the browser prompt is available and not dismissed', () => {
  assert.equal(resolvePwaPromptKind({ ...baseState, installAvailable: true }), 'install');
  assert.equal(resolvePwaPromptKind({
    ...baseState,
    installAvailable: true,
    installDismissed: true,
  }), null);
});

test('uses the offline-ready notice as the lowest priority prompt', () => {
  assert.equal(resolvePwaPromptKind({ ...baseState, offlineReady: true }), 'offline');
  assert.equal(resolvePwaPromptKind({
    ...baseState,
    offlineDismissed: true,
    offlineReady: true,
  }), null);
});
