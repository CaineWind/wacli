import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiErrorMessage } from './utils';

test('resolveApiErrorMessage extracts a nested application error message', () => {
  assert.equal(
    resolveApiErrorMessage(
      {
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid username or password',
        },
      },
      'Login failed',
    ),
    'Invalid username or password',
  );
});

test('resolveApiErrorMessage ignores unsupported error values', () => {
  assert.equal(
    resolveApiErrorMessage({ error: { code: 'UNKNOWN' } }, 'Login failed'),
    'Login failed',
  );
});
