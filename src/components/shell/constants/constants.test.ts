import assert from 'node:assert/strict';
import test from 'node:test';

import { getTerminalOptions } from './constants';

test('Herdr uses full-screen TUI terminal semantics', () => {
  const options = getTerminalOptions('herdr');

  assert.equal(options.convertEol, false);
  assert.equal(options.scrollback, 0);
});

test('default shells retain scrollback and line-oriented output behavior', () => {
  const options = getTerminalOptions('default');

  assert.equal(options.convertEol, true);
  assert.equal(options.scrollback, 10000);
});
