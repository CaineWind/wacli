import assert from 'node:assert/strict';
import test from 'node:test';

import { createHerdrShellProps, getHerdrClientSessionId } from '../utils/herdrShell';

test('launches Herdr without requiring a selected project', () => {
  const shellProps = createHerdrShellProps(true, 'herdr-client-id');

  assert.equal(shellProps.project, null);
  assert.equal(shellProps.command, 'herdr');
  assert.equal(shellProps.isPlainShell, true);
  assert.equal(shellProps.autoConnect, true);
  assert.equal(shellProps.minimal, true);
  assert.equal(shellProps.isActive, true);
  assert.equal(shellProps.shellSessionId, 'herdr-client-id');
  assert.equal(shellProps.shellMode, 'herdr');
});

test('reuses one global Herdr client id per browser tab', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  const firstId = getHerdrClientSessionId(storage);
  const repeatedId = getHerdrClientSessionId(storage);

  assert.equal(repeatedId, firstId);
  assert.equal(values.size, 1);
  assert.match(firstId, /^herdr-[a-zA-Z0-9-]+$/);
});
