import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { CodexAppServerClient } from '@/modules/providers/list/codex/codex-app-server.client.js';

function createFakeAppServer() {
  const processHandle = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(processHandle, {
    stdin,
    stdout,
    stderr,
    kill: () => true,
  });

  const requests: Array<Record<string, any>> = [];
  stdin.on('data', (chunk) => {
    for (const line of String(chunk).trim().split('\n')) {
      if (!line) {
        continue;
      }
      const request = JSON.parse(line) as Record<string, any>;
      requests.push(request);
      if (request.method === 'initialize') {
        stdout.write(`${JSON.stringify({ id: request.id, result: { userAgent: 'test' } })}\n`);
      }
    }
  });
  return { processHandle, requests, stdout };
}

test('app-server client forwards handled server requests and writes their response', async () => {
  const fake = createFakeAppServer();
  const client = await CodexAppServerClient.start(() => fake.processHandle);
  let receivedRequestId: number | null = null;
  client.onRequest((request) => {
    receivedRequestId = request.id;
    client.respond(request.id, { decision: 'accept' });
    return true;
  });

  fake.stdout.write(`${JSON.stringify({
    id: 91,
    method: 'item/commandExecution/requestApproval',
    params: { command: 'git status' },
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(receivedRequestId, 91);
  assert.deepEqual(fake.requests.at(-1), {
    id: 91,
    result: { decision: 'accept' },
  });
  client.close();
});

test('app-server client reports an unexpected process exit once', async () => {
  const fake = createFakeAppServer();
  const client = await CodexAppServerClient.start(() => fake.processHandle);
  const exits: Error[] = [];
  client.onExit(({ error }) => exits.push(error));

  fake.processHandle.emit('exit', 7, null);
  fake.processHandle.emit('error', new Error('duplicate process error'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(exits.length, 1);
  assert.match(exits[0]?.message || '', /exited \(7\)/);
});
