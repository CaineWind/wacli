import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canApplyResponsiveTerminalFontSize,
  getTerminalOptions,
} from './constants';

test('Herdr uses full-screen TUI terminal semantics', () => {
  const options = getTerminalOptions('herdr');

  assert.equal(options.convertEol, false);
  assert.equal(options.scrollback, 0);
  assert.equal(options.cursorBlink, false);
  assert.equal(options.theme?.cursor, 'rgba(0, 0, 0, 0)');
});

test('Herdr uses a compact font on mobile-width terminal surfaces', () => {
  assert.equal(getTerminalOptions('herdr', 440).fontSize, 9);
  assert.equal(getTerminalOptions('herdr', 480).fontSize, 9);
  assert.equal(getTerminalOptions('herdr', 481).fontSize, 12);
  assert.equal(getTerminalOptions('herdr', 767).fontSize, 12);
  assert.equal(getTerminalOptions('herdr', 768).fontSize, 14);
  assert.equal(getTerminalOptions('default', 440).fontSize, 14);
});

test('manual terminal zoom prevents responsive defaults from replacing it', () => {
  assert.equal(canApplyResponsiveTerminalFontSize(12, 12, false), true);
  assert.equal(canApplyResponsiveTerminalFontSize(14, 12, true), false);
});

test('default shells retain scrollback and line-oriented output behavior', () => {
  const options = getTerminalOptions('default');

  assert.equal(options.convertEol, true);
  assert.equal(options.scrollback, 10000);
  assert.equal(options.cursorBlink, true);
  assert.equal(options.theme?.cursor, '#ffffff');
});
