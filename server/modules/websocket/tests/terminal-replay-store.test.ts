import assert from 'node:assert/strict';
import test from 'node:test';

import { TerminalReplayStore } from '@/modules/websocket/services/terminal-replay-store.js';

test('retains ordered output within per-session entry and byte budgets', () => {
  const store = new TerminalReplayStore({
    maxSessionBytes: 6,
    maxSessionEntries: 2,
    maxTotalBytes: 20,
  });

  store.append('one', 'aa');
  store.append('one', 'bb');
  store.append('one', 'cc');

  assert.deepEqual(store.snapshot('one'), {
    chunks: ['bb', 'cc'],
    truncated: true,
  });
});

test('trims oversized unicode chunks at a valid UTF-8 boundary', () => {
  const store = new TerminalReplayStore({
    maxSessionBytes: 5,
    maxSessionEntries: 10,
    maxTotalBytes: 10,
  });

  store.append('unicode', 'a你b好');
  const snapshot = store.snapshot('unicode');

  assert.equal(Buffer.byteLength(snapshot.chunks[0], 'utf8') <= 5, true);
  assert.equal(snapshot.chunks[0].includes('\ufffd'), false);
  assert.equal(snapshot.truncated, true);
});

test('enforces a global budget without deleting retained sessions', () => {
  const store = new TerminalReplayStore({
    maxSessionBytes: 10,
    maxSessionEntries: 10,
    maxTotalBytes: 6,
  });

  store.append('one', '1111');
  store.append('two', '2222');

  assert.deepEqual(store.snapshot('one'), { chunks: [], truncated: true });
  assert.deepEqual(store.snapshot('two'), { chunks: ['2222'], truncated: false });
});

test('clear and delete release replay state', () => {
  const store = new TerminalReplayStore({ maxTotalBytes: 10 });
  store.append('one', 'abc');
  store.clear('one');
  assert.deepEqual(store.snapshot('one'), { chunks: [], truncated: false });

  store.append('one', 'def');
  store.delete('one');
  assert.deepEqual(store.snapshot('one'), { chunks: [], truncated: false });
});

test('compacts deleted records even when a long-lived session remains at the queue head', () => {
  const store = new TerminalReplayStore({
    maxSessionBytes: 10_000,
    maxSessionEntries: 2_000,
    maxTotalBytes: 20_000,
  });
  store.append('anchor', 'a');
  for (let index = 0; index < 1_100; index += 1) {
    store.append('deleted', 'b');
  }

  store.delete('deleted');

  const internals = store as unknown as { globalRecords: unknown[] };
  assert.equal(internals.globalRecords.length, 1);
  assert.deepEqual(store.snapshot('anchor'), { chunks: ['a'], truncated: false });
});
