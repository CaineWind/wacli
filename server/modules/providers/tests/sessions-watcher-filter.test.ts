import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createSessionWatcherIgnored } from '@/modules/providers/services/sessions-watcher.service.js';

const directoryStats = { isDirectory: () => true, isFile: () => false };
const fileStats = { isDirectory: () => false, isFile: () => true };

test('watcher filter traverses provider directories but ignores unrelated files', () => {
  const rootPath = path.join('C:', 'Users', 'example', '.codex', 'sessions');
  const ignored = createSessionWatcherIgnored('codex', rootPath);

  assert.equal(ignored(path.join(rootPath, '2026', '08'), directoryStats), false);
  assert.equal(ignored(path.join(rootPath, '2026', 'session.jsonl'), fileStats), false);
  assert.equal(ignored(path.join(rootPath, '2026', 'notes.txt'), fileStats), true);
  assert.equal(ignored(path.join(rootPath, 'node_modules', 'session.jsonl'), fileStats), true);
});

test('OpenCode watcher only accepts the shared database file', () => {
  const rootPath = path.join('C:', 'Users', 'example', '.local', 'share', 'opencode');
  const ignored = createSessionWatcherIgnored('opencode', rootPath);

  assert.equal(ignored(path.join(rootPath, 'opencode.db'), fileStats), false);
  assert.equal(ignored(path.join(rootPath, 'opencode.db-wal'), fileStats), true);
  assert.equal(ignored(path.join(rootPath, 'storage', 'message.json'), fileStats), true);
});
