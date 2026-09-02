import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMobileTerminalContextMenuLabels,
  isMobileTerminalTwoFingerTap,
} from './mobileTerminalSelection';

test('mobile terminal long-press menu exposes paste', () => {
  assert.deepEqual(getMobileTerminalContextMenuLabels(), ['Paste', 'Copy', 'Select All']);
});

test('mobile terminal recognizes only a short stationary two-finger tap', () => {
  assert.equal(isMobileTerminalTwoFingerTap(1_000, 1_250, false), true);
  assert.equal(isMobileTerminalTwoFingerTap(1_000, 1_250, true), false);
  assert.equal(isMobileTerminalTwoFingerTap(1_000, 1_500, false), false);
});
