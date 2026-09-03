import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMobileKeyboardInset,
  isIosLikePlatform,
} from './mobileKeyboardViewport';

const androidChrome = {
  maxTouchPoints: 5,
  platform: 'Linux armv8l',
  userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile',
};

const iosSafari = {
  maxTouchPoints: 5,
  platform: 'iPhone',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15',
};

const ipadOsSafari = {
  maxTouchPoints: 5,
  platform: 'MacIntel',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
};

test('layout-resizing mobile browsers never accumulate a keyboard inset', () => {
  const repeatedFocusMeasurements = [
    { layoutHeight: 800, visualHeight: 500 },
    { layoutHeight: 500, visualHeight: 300 },
    { layoutHeight: 800, visualHeight: 460 },
  ];

  assert.equal(isIosLikePlatform(androidChrome), false);
  assert.deepEqual(
    repeatedFocusMeasurements.map(({ layoutHeight, visualHeight }) => (
      calculateMobileKeyboardInset(layoutHeight, visualHeight, androidChrome)
    )),
    [0, 0, 0],
  );
});

test('iOS overlay keyboards still receive a visual viewport inset', () => {
  assert.equal(isIosLikePlatform(iosSafari), true);
  assert.equal(isIosLikePlatform(ipadOsSafari), true);
  assert.equal(calculateMobileKeyboardInset(800, 500, iosSafari), 300);
});
