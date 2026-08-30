import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionWatchScheduler } from '@/modules/providers/services/session-watch-scheduler.js';

const event = {
  eventType: 'change',
  provider: 'codex',
  filePath: 'C:/sessions/example.jsonl',
} satisfies Parameters<SessionWatchScheduler['enqueue']>[0];

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('coalesces filesystem noise and serializes synchronization by artifact', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const scheduler = new SessionWatchScheduler({
    platform: 'win32',
    synchronize: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await wait(12);
      active -= 1;
      return { indexed: true, sessionId: 'session-1' };
    },
    onSynchronized: () => undefined,
    onError: (queuedEvent, error) => assert.fail(`${queuedEvent.filePath}: ${String(error)}`),
  }, { debounceMs: 5, maxWaitMs: 20, addRetryDelaysMs: [] });

  scheduler.enqueue(event);
  scheduler.enqueue({ ...event, filePath: 'c:/SESSIONS/example.jsonl' });
  await wait(8);
  scheduler.enqueue(event);
  await wait(40);
  await scheduler.close();

  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
});

test('retries an incomplete add with bounded delays', async () => {
  let calls = 0;
  const synchronized: string[] = [];
  const scheduler = new SessionWatchScheduler({
    synchronize: async () => {
      calls += 1;
      return { indexed: calls === 3, sessionId: calls === 3 ? 'session-2' : null };
    },
    onSynchronized: (_queuedEvent, result) => synchronized.push(result.sessionId ?? ''),
    onError: (_queuedEvent, error) => assert.fail(String(error)),
  }, { debounceMs: 1, maxWaitMs: 5, addRetryDelaysMs: [2, 3, 4] });

  scheduler.enqueue({ ...event, eventType: 'add' });
  await wait(50);
  await scheduler.close();

  assert.equal(calls, 3);
  assert.deepEqual(synchronized, ['session-2']);
});

test('close cancels pending work and waits for an active synchronization', async () => {
  let release!: () => void;
  let calls = 0;
  const scheduler = new SessionWatchScheduler({
    synchronize: async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { indexed: true, sessionId: 'session-3' };
    },
    onSynchronized: () => undefined,
    onError: (_queuedEvent, error) => assert.fail(String(error)),
  }, { debounceMs: 1, maxWaitMs: 5 });

  scheduler.enqueue(event);
  await wait(5);
  const closing = scheduler.close();
  scheduler.enqueue({ ...event, filePath: 'C:/sessions/ignored.jsonl' });
  release();
  await closing;
  await wait(5);

  assert.equal(calls, 1);
});
