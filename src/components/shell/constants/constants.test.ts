import assert from 'node:assert/strict';
import test from 'node:test';

import { getTerminalOptions } from './constants';

test('Herdr uses full-screen TUI terminal semantics', () => {
  const options = getTerminalOptions('herdr');

  assert.equal(options.convertEol, false);
  assert.equal(options.scrollback, 0);
  assert.equal(options.cursorBlink, false);
  assert.equal(options.theme?.cursor, 'rgba(0, 0, 0, 0)');
});

test('default shells retain scrollback and line-oriented output behavior', () => {
  const options = getTerminalOptions('default');

  assert.equal(options.convertEol, true);
  assert.equal(options.scrollback, 10000);
  assert.equal(options.cursorBlink, true);
  assert.equal(options.theme?.cursor, '#ffffff');
});
