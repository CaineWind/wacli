import assert from 'node:assert/strict';
import test from 'node:test';

import { createHerdrTerminalFocusScheduler } from './mobileTerminalSelection';

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
