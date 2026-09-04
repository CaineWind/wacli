import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import '@/i18n/config.js';

import TokenRateIndicator from './TokenRateIndicator';

test('token rate indicator is always visible before a sample exists', () => {
  const markup = renderToStaticMarkup(
    <TokenRateIndicator
      rate={{ value: null, isLive: false, estimatedTokens: 0, activeDurationMs: 0 }}
    />,
  );

  assert.match(markup, /--/);
  assert.match(markup, /tok\/s/);
  assert.match(markup, /min-w-\[5\.75rem\]/);
});

test('token rate indicator formats live and completed values', () => {
  const liveMarkup = renderToStaticMarkup(
    <TokenRateIndicator
      rate={{ value: 12.36, isLive: true, estimatedTokens: 20, activeDurationMs: 1_618 }}
    />,
  );
  const completedMarkup = renderToStaticMarkup(
    <TokenRateIndicator
      rate={{ value: 125.6, isLive: false, estimatedTokens: 200, activeDurationMs: 1_592 }}
    />,
  );

  assert.match(liveMarkup, /12\.4/);
  assert.match(liveMarkup, /animate-pulse/);
  assert.match(completedMarkup, /126/);
  assert.doesNotMatch(completedMarkup, /animate-pulse/);
});
