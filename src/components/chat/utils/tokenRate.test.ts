import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateOutputTokens, TokenRateTracker } from './tokenRate';

test('estimates mixed-language content without depending on chunk boundaries', () => {
  assert.equal(estimateOutputTokens('hello world'), 3);
  assert.equal(estimateOutputTokens('你好世界'), 4);
  assert.equal(estimateOutputTokens('你好 test 🚀'), 4);
  assert.equal(estimateOutputTokens('<proposed_plan>\n你好\n</proposed_plan>'), 2);
  assert.equal(estimateOutputTokens('   \n\t'), 0);
  assert.equal(
    estimateOutputTokens('你好') + estimateOutputTokens('abcdefgh'),
    estimateOutputTokens('你好abcdefgh'),
  );
});

test('tracks a live average across answer and thinking output', () => {
  const tracker = new TokenRateTracker();
  tracker.begin('session-1', 0);

  tracker.record('session-1', { kind: 'thinking', content: '你好', seq: 1 }, 1_000);
  const live = tracker.record('session-1', { kind: 'stream_delta', content: 'abcdefgh', seq: 2 }, 1_500);

  assert.equal(live.isLive, true);
  assert.equal(live.estimatedTokens, 4);
  assert.equal(live.activeDurationMs, 500);
  assert.equal(live.value, 8);

  const finished = tracker.record('session-1', { kind: 'complete', seq: 3 }, 2_000);
  assert.equal(finished.isLive, false);
  assert.equal(finished.value, 8);
});

test('excludes tool waiting time and ignores replayed sequence numbers', () => {
  const tracker = new TokenRateTracker();
  tracker.begin('session-1', 0);
  tracker.record('session-1', { kind: 'stream_delta', content: 'abcd', seq: 1 }, 1_000);
  tracker.record('session-1', { kind: 'stream_delta', content: 'efgh', seq: 2 }, 1_500);
  tracker.record('session-1', { kind: 'stream_delta', content: 'efgh', seq: 2 }, 1_600);
  tracker.record('session-1', { kind: 'tool_use', seq: 3 }, 2_000);
  tracker.record('session-1', { kind: 'tool_result', seq: 4 }, 4_500);
  tracker.record('session-1', { kind: 'stream_delta', content: 'ijkl', seq: 5 }, 5_000);
  const live = tracker.record('session-1', { kind: 'stream_delta', content: 'mnop', seq: 6 }, 5_500);

  assert.equal(live.estimatedTokens, 4);
  assert.equal(live.activeDurationMs, 1_000);
  assert.equal(live.value, 4);
});

test('keeps the previous result until a new run has a measurable sample', () => {
  const tracker = new TokenRateTracker();
  tracker.begin('session-1', 0);
  tracker.record('session-1', { kind: 'stream_delta', content: 'abcd', seq: 1 }, 1_000);
  tracker.record('session-1', { kind: 'stream_delta', content: 'efgh', seq: 2 }, 1_500);
  const previous = tracker.record('session-1', { kind: 'complete', seq: 3 }, 1_600);

  tracker.begin('session-1', 2_000);
  const early = tracker.record('session-1', { kind: 'stream_delta', content: 'x', seq: 4 }, 2_100);
  assert.equal(early.value, previous.value);
  assert.equal(early.isLive, true);

  const noOutputTracker = new TokenRateTracker();
  noOutputTracker.begin('session-2', 0);
  assert.equal(noOutputTracker.record('session-2', { kind: 'complete' }, 1_000).value, null);
});

test('accepts sequence numbers that restart on the next run and throttles live values', () => {
  const tracker = new TokenRateTracker();
  tracker.begin('session-1', 0);
  tracker.record('session-1', { kind: 'stream_delta', content: 'abcd', seq: 1 }, 1_000);
  const firstRate = tracker.record('session-1', { kind: 'stream_delta', content: 'efgh', seq: 2 }, 1_500);
  const throttled = tracker.record('session-1', { kind: 'stream_delta', content: 'ijkl', seq: 3 }, 1_600);
  tracker.record('session-1', { kind: 'complete', seq: 4 }, 1_700);

  assert.equal(throttled.value, firstRate.value);

  tracker.begin('session-1', 2_000);
  tracker.record('session-1', { kind: 'stream_delta', content: 'mnop', seq: 1 }, 2_100);
  const nextRun = tracker.record('session-1', { kind: 'stream_delta', content: 'qrst', seq: 2 }, 2_600);
  assert.equal(nextRun.estimatedTokens, 2);
  assert.equal(nextRun.value, 4);
});

test('uses request duration as a fallback for providers with one final text event', () => {
  const tracker = new TokenRateTracker();
  tracker.begin('session-1', 0);
  tracker.record('session-1', { kind: 'text', content: 'abcdefgh' }, 1_000);
  const finished = tracker.record('session-1', { kind: 'complete' }, 2_000);

  assert.equal(finished.estimatedTokens, 2);
  assert.equal(finished.activeDurationMs, 2_000);
  assert.equal(finished.value, 1);
});

test('stores independent snapshots per session and evicts the oldest entry', () => {
  const tracker = new TokenRateTracker(2);
  tracker.begin('one', 0);
  tracker.record('one', { kind: 'text', content: 'abcdefgh' }, 500);
  tracker.record('one', { kind: 'complete' }, 1_000);
  tracker.begin('two', 0);
  tracker.begin('three', 0);

  assert.equal(tracker.getSnapshot('one').value, null);
  assert.equal(tracker.getSnapshot('two').value, null);
  assert.equal(tracker.getSnapshot('three').value, null);
});
