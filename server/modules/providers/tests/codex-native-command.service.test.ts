import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexAppServerClient } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { parseCodexNativeCommand } from '@/modules/providers/list/codex/codex-native-command.service.js';
import { codexNativeRuntime } from '@/modules/providers/list/codex/codex-native-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

type FakeAppServer = {
  request(method: string, params?: unknown): Promise<any>;
  onNotification(listener: (event: any) => void): () => void;
  onRequest(listener: (event: any) => boolean): () => void;
  onExit(listener: (event: { error: Error }) => void): () => void;
  respond(id: number, result: unknown): void;
  close(): void;
};

function createRuntimeContext(): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => 'gpt-test',
    getProviderModels: async () => ({
      DEFAULT: 'gpt-test',
      OPTIONS: [{ value: 'gpt-test', label: 'GPT Test' }],
    }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

async function withFakeAppServer(fake: FakeAppServer, run: () => Promise<void>): Promise<void> {
  const originalStart = CodexAppServerClient.start;
  CodexAppServerClient.start = async () => fake as CodexAppServerClient;
  try {
    await run();
  } finally {
    CodexAppServerClient.start = originalStart;
  }
}

test('parses supported Codex native commands case-insensitively', () => {
  assert.deepEqual(parseCodexNativeCommand('/plan'), {
    kind: 'plan',
    prompt: '',
  });
  assert.deepEqual(parseCodexNativeCommand('/PLAN design the migration'), {
    kind: 'plan',
    prompt: 'design the migration',
  });
  assert.deepEqual(parseCodexNativeCommand('/review'), {
    kind: 'review',
    prompt: '',
  });
  assert.deepEqual(parseCodexNativeCommand('/review focus on authentication'), {
    kind: 'review',
    prompt: 'focus on authentication',
  });
  assert.deepEqual(parseCodexNativeCommand('/compact'), {
    kind: 'compact',
  });
});

test('does not intercept ordinary prompts or unsupported slash commands', () => {
  assert.equal(parseCodexNativeCommand('plan the work'), null);
  assert.equal(parseCodexNativeCommand('/planner'), null);
  assert.equal(parseCodexNativeCommand('/compact now'), null);
  assert.equal(parseCodexNativeCommand('/my-project-command value'), null);
});

test('bare plan command toggles plan mode without starting a Codex turn', async () => {
  const messages: Array<Record<string, any>> = [];
  const writer = { send: (message: unknown) => messages.push(message as Record<string, any>) };
  const context = {} as ProviderRuntimeContext;
  const options = { sessionId: 'plan-toggle-test-session' };

  await codexNativeRuntime.run('/plan', options, writer, context);
  await codexNativeRuntime.run('/plan', options, writer, context);

  assert.deepEqual(messages.map((message) => message.kind), [
    'text',
    'complete',
    'text',
    'complete',
  ]);
  assert.equal(messages[0]?.content, 'Plan mode enabled.');
  assert.equal(messages[2]?.content, 'Plan mode disabled.');
});

test('plan turns bridge app-server command approvals through the runtime gateway', { concurrency: false }, async () => {
  let notificationListener = (_event: any) => {};
  let requestListener = (_event: any) => false;
  const responses: Array<{ id: number; result: unknown }> = [];
  const fake: FakeAppServer = {
    async request(method) {
      if (method === 'thread/start') {
        return { thread: { id: 'native-approval-thread' } };
      }
      if (method === 'turn/start') {
        setImmediate(() => requestListener({
          id: 41,
          method: 'item/commandExecution/requestApproval',
          params: { command: 'git status', cwd: 'D:/workspace' },
        }));
        return { turn: { id: 'turn-approval' } };
      }
      return {};
    },
    onNotification(listener) {
      notificationListener = listener;
      return () => {};
    },
    onRequest(listener) {
      requestListener = listener;
      return () => {};
    },
    onExit() {
      return () => {};
    },
    respond(id, result) {
      responses.push({ id, result });
      if (id === 41) {
        setImmediate(() => requestListener({
          id: 42,
          method: 'item/tool/requestUserInput',
          params: {
            questions: [{
              id: 'scope',
              header: 'Scope',
              question: 'Which area?',
              options: [{ label: 'Backend', description: 'Server code' }],
            }],
          },
        }));
      } else {
        setImmediate(() => notificationListener({
          method: 'turn/completed',
          params: { turn: { status: 'completed' } },
        }));
      }
    },
    close() {},
  };
  const messages: Array<Record<string, any>> = [];

  await withFakeAppServer(fake, async () => {
    const run = codexNativeRuntime.run(
      '/plan inspect the repository',
      { sessionId: 'approval-app-session', projectPath: 'D:/workspace' },
      { send: (message) => messages.push(message as Record<string, any>) },
      createRuntimeContext(),
    ) as Promise<void>;
    for (let attempt = 0; attempt < 10 && !messages.some((message) => message.kind === 'permission_request'); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const approval = messages.find((message) => message.kind === 'permission_request');
    assert.ok(approval?.requestId);
    codexNativeRuntime.permissions?.resolve(approval.requestId as string, { allow: true });
    for (let attempt = 0; attempt < 10 && messages.filter((message) => message.kind === 'permission_request').length < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const userInput = messages.filter((message) => message.kind === 'permission_request').at(-1);
    assert.equal(userInput?.toolName, 'AskUserQuestion');
    codexNativeRuntime.permissions?.resolve(userInput?.requestId as string, {
      allow: true,
      updatedInput: { answers: { 'Which area?': 'Backend' } },
    });
    await run;
  });

  assert.deepEqual(responses, [
    { id: 41, result: { decision: 'accept' } },
    { id: 42, result: { answers: { scope: { answers: ['Backend'] } } } },
  ]);
  assert.equal(messages.at(-1)?.kind, 'complete');
  assert.equal(messages.at(-1)?.success, true);
});

test('an unexpected app-server exit terminates the chat run with an error', { concurrency: false }, async () => {
  let exitListener = (_event: { error: Error }) => {};
  const fake: FakeAppServer = {
    async request(method) {
      if (method === 'thread/start') {
        return { thread: { id: 'native-crash-thread' } };
      }
      if (method === 'turn/start') {
        setImmediate(() => exitListener({ error: new Error('simulated app-server crash') }));
        return { turn: { id: 'turn-crash' } };
      }
      return {};
    },
    onNotification: () => () => {},
    onRequest: () => () => {},
    onExit(listener) {
      exitListener = listener;
      return () => {};
    },
    respond() {},
    close() {},
  };
  const messages: Array<Record<string, any>> = [];

  await withFakeAppServer(fake, async () => {
    await codexNativeRuntime.run(
      '/plan inspect safely',
      { sessionId: 'crash-app-session', projectPath: 'D:/workspace' },
      { send: (message) => messages.push(message as Record<string, any>) },
      createRuntimeContext(),
    );
  });

  assert.equal(messages.some((message) => message.kind === 'error'
    && String(message.content).includes('simulated app-server crash')), true);
  assert.equal(messages.at(-1)?.kind, 'complete');
  assert.equal(messages.at(-1)?.success, false);
});
