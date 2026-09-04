import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AnyRecord, ProviderRuntimeContext } from '@/shared/types.js';
import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import { parsePiModelsTable } from '@/modules/providers/list/pi/pi-models.provider.js';
import { abortPiSession, runPi } from '@/modules/providers/list/pi/pi-runtime.provider.js';
import { PiSessionsProvider } from '@/modules/providers/list/pi/pi-sessions.provider.js';
import { PiSessionSynchronizer } from '@/modules/providers/list/pi/pi-session-synchronizer.provider.js';
import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

test('Pi model discovery parses fixed columns and preserves provider/model ids', () => {
  const models = parsePiModelsTable([
    'provider          model                         context    max-out  thinking  images',
    'anthropic         claude/sonnet-special         200K       64K      yes       yes',
    'openai            gpt-4o                        128K       16K      no        yes',
  ].join('\r\n'));

  assert.deepEqual(models.map((model) => model.value), [
    'anthropic/claude/sonnet-special',
    'openai/gpt-4o',
  ]);
  assert.deepEqual(models[0].effort?.values.map((entry) => entry.value), [
    'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
  ]);
  assert.equal(models[1].effort, undefined);
  assert.match(models[0].description ?? '', /Images/);
});

test('Pi sessions normalize RPC deltas and tool lifecycle events', () => {
  const sessions = new PiSessionsProvider();
  const text = sessions.normalizeMessage({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
  }, 'session-1');
  const thinking = sessions.normalizeMessage({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' },
  }, 'session-1');
  const start = sessions.normalizeMessage({
    type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'a.ts' },
  }, 'session-1');
  const end = sessions.normalizeMessage({
    type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: { content: 'done' }, isError: false,
  }, 'session-1');

  assert.equal(text[0].kind, 'stream_delta');
  assert.equal(text[0].content, 'hello');
  assert.equal(thinking[0].kind, 'thinking');
  assert.equal(start[0].toolId, 'tool-1');
  assert.equal(end[0].kind, 'tool_result');
  assert.equal(end[0].toolResult?.content, 'done');
});

test('Pi sessions expose assistant provider errors emitted inside message events', () => {
  const sessions = new PiSessionsProvider();
  const errors = sessions.normalizeMessage({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '401: Authentication failed',
      content: [],
    },
  }, 'session-1');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'error');
  assert.equal(errors[0].content, '401: Authentication failed');
});

test('Pi synchronizer and history reader restore only the active JSONL branch', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-history-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    const sessionRoot = path.join(tempRoot, 'sessions');
    const workspace = path.join(tempRoot, 'workspace');
    const transcript = path.join(sessionRoot, 'session.jsonl');
    await mkdir(sessionRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const entries = [
      { type: 'session', version: 3, id: 'pi-session-1', cwd: workspace, timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'root prompt' } },
      { type: 'message', id: 'a-old', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'abandoned answer' }] } },
      { type: 'message', id: 'u2', parentId: 'u1', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'user', content: 'active fork' } },
      { type: 'message', id: 'a2', parentId: 'u2', timestamp: '2026-01-01T00:00:04.000Z', message: {
        role: 'assistant',
        content: [{ type: 'thinking', text: 'considering' }, { type: 'text', text: 'active answer' }],
        usage: { input: 5, output: 4, cacheRead: 1, cacheWrite: 0 },
      } },
      { type: 'session_info', name: 'Active Pi branch' },
    ];
    await writeFile(transcript, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n{partial`, 'utf8');

    closeConnection();
    process.env.DATABASE_PATH = path.join(tempRoot, 'windcli.db');
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionRoot;
    await initializeDatabase();
    assert.equal(await new PiSessionSynchronizer().synchronize(), 1);
    assert.equal(sessionsDb.getSessionById('pi-session-1')?.custom_name, 'Active Pi branch');

    const history = await new PiSessionsProvider().fetchHistory('pi-session-1', { limit: 2, offset: 0 });
    assert.equal(history.total, 4);
    assert.equal(history.hasMore, true);
    assert.deepEqual(history.messages.map((message) => message.content), ['considering', 'active answer']);
    assert.equal((history.tokenUsage as AnyRecord).used, 10);
    assert.ok(!history.messages.some((message) => message.content === 'abandoned answer'));
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Pi MCP facet lists no servers and rejects mutation with a stable error', async () => {
  const mcp = new PiMcpProvider();
  assert.deepEqual(await mcp.listServers(), { user: [], local: [], project: [] });
  await assert.rejects(
    () => mcp.upsertServer({ name: 'test', scope: 'user', transport: 'stdio', command: 'test' }),
    (error: unknown) => error instanceof AppError && error.code === 'MCP_NOT_SUPPORTED',
  );
});

const waitForFile = async (filePath: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await readFile(filePath); return; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
};

test('Pi runtime uses JSONL RPC arguments, streams events, and emits one terminal state', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-runtime-'));
  const originalPath = process.env.PATH;
  const originalCapture = process.env.PI_FAKE_CAPTURE;
  try {
    const workspace = path.join(tempRoot, 'workspace');
    const capture = path.join(tempRoot, 'capture.json');
    const scriptPath = path.join(tempRoot, 'fake-pi.cjs');
    await mkdir(path.join(workspace, '.pi', 'skills'), { recursive: true });
    await writeFile(path.join(workspace, 'image.png'), 'fake image', 'utf8');
    await writeFile(scriptPath, `
const fs = require('node:fs');
const readline = require('node:readline');
const capture = process.env.PI_FAKE_CAPTURE;
const seen = [];
fs.writeFileSync(capture, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), seen }));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const command = JSON.parse(line);
  seen.push(command);
  fs.writeFileSync(capture, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), seen }));
  const write = (event) => process.stdout.write(JSON.stringify(event) + '\\r\\n');
  write({ type: 'response', command: 'prompt', success: true });
  if (command.message === 'Trigger provider error') {
    const failedMessage = {
      role: 'assistant', content: [], stopReason: 'error', errorMessage: '401: Authentication failed',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    write({ type: 'message_end', message: failedMessage });
    write({ type: 'agent_end', messages: [failedMessage], willRetry: false });
    rl.close();
    return;
  }
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } });
  write({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Think' } });
  write({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'x' } });
  write({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: { content: 'ok' }, isError: false });
  write({ type: 'agent_end', messages: [{ role: 'assistant', usage: { input: 2, output: 3, cacheRead: 1, cacheWrite: 0 } }] });
  write({ type: 'agent_end', messages: [] });
  rl.close();
});
`, 'utf8');
    await writeFile(path.join(tempRoot, 'pi.cmd'), '@echo off\r\nnode "%~dp0fake-pi.cjs" %*\r\n', 'utf8');
    const unixShim = path.join(tempRoot, 'pi');
    await writeFile(unixShim, `#!/bin/sh\nexec node "${scriptPath.replace(/\\/g, '/')}" "$@"\n`, 'utf8');
    await chmod(unixShim, 0o755);
    process.env.PATH = `${tempRoot}${path.delimiter}${originalPath ?? ''}`;
    process.env.PI_FAKE_CAPTURE = capture;

    const sent: AnyRecord[] = [];
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'anthropic/claude-sonnet-4-5',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
      normalizeMessage: (event, sessionId) => new PiSessionsProvider().normalizeMessage(event, sessionId),
      isProviderInstalled: async () => true,
    };
    await runPi('Inspect', {
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: workspace,
      model: 'anthropic/claude-sonnet-4-5',
      effort: 'high',
      images: [{ path: path.join(workspace, 'image.png'), mimeType: 'image/png' }],
      files: [{ path: path.join(workspace, 'notes.txt') }],
    }, { send: (message) => sent.push(message as AnyRecord) }, context);

    const captured = JSON.parse(await readFile(capture, 'utf8')) as { args: string[]; cwd: string; seen: AnyRecord[] };
    assert.equal(captured.cwd, workspace);
    assert.deepEqual(captured.args.slice(0, 3), ['--mode', 'rpc', '--no-approve']);
    assert.ok(captured.args.includes('anthropic/claude-sonnet-4-5'));
    assert.ok(captured.args.includes('--session-id'));
    assert.ok(captured.args.includes('--thinking'));
    assert.ok(captured.args.includes('--skill'));
    assert.equal(captured.seen[0].type, 'prompt');
    assert.equal((captured.seen[0].images as unknown[]).length, 1);
    assert.match(String(captured.seen[0].message), /<files_input>/);
    assert.ok(sent.some((message) => message.kind === 'stream_delta' && message.content === 'Hello'));
    assert.ok(sent.some((message) => message.kind === 'thinking'));
    assert.ok(sent.some((message) => message.kind === 'tool_use'));
    assert.ok(sent.some((message) => message.kind === 'tool_result'));
    assert.ok(sent.some((message) => message.kind === 'status' && (message.tokenBudget as AnyRecord).used === 6));
    assert.equal(sent.filter((message) => message.kind === 'complete').length, 1);

    const failed: AnyRecord[] = [];
    await runPi('Trigger provider error', {
      sessionId: '66666666-6666-4666-8666-666666666666',
      cwd: workspace,
      model: 'anthropic/claude-sonnet-4-5',
    }, { send: (message) => failed.push(message as AnyRecord) }, context);
    assert.ok(failed.some((message) => message.kind === 'error' && message.content === '401: Authentication failed'));
    assert.equal(failed.find((message) => message.kind === 'complete')?.success, false);
  } finally {
    process.env.PATH = originalPath;
    if (originalCapture === undefined) delete process.env.PI_FAKE_CAPTURE;
    else process.env.PI_FAKE_CAPTURE = originalCapture;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Pi abort sends RPC before stopping the child', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-abort-'));
  const originalPath = process.env.PATH;
  const originalCapture = process.env.PI_FAKE_CAPTURE;
  try {
    const capture = path.join(tempRoot, 'abort.json');
    const scriptPath = path.join(tempRoot, 'fake-pi.cjs');
    await writeFile(scriptPath, `
const fs = require('node:fs');
const readline = require('node:readline');
const seen = [];
const save = () => fs.writeFileSync(process.env.PI_FAKE_CAPTURE, JSON.stringify(seen));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  seen.push(JSON.parse(line)); save();
  if (seen.at(-1).type === 'abort') process.exit(0);
});
`, 'utf8');
    await writeFile(path.join(tempRoot, 'pi.cmd'), '@echo off\r\nnode "%~dp0fake-pi.cjs" %*\r\n', 'utf8');
    const unixShim = path.join(tempRoot, 'pi');
    await writeFile(unixShim, `#!/bin/sh\nexec node "${scriptPath.replace(/\\/g, '/')}" "$@"\n`, 'utf8');
    await chmod(unixShim, 0o755);
    process.env.PATH = `${tempRoot}${path.delimiter}${originalPath ?? ''}`;
    process.env.PI_FAKE_CAPTURE = capture;
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };
    const running = runPi('Wait', { sessionId, cwd: tempRoot }, { send: () => undefined }, context);
    await waitForFile(capture);
    assert.equal(abortPiSession(sessionId), true);
    await running;
    const seen = JSON.parse(await readFile(capture, 'utf8')) as AnyRecord[];
    assert.deepEqual(seen.map((entry) => entry.type), ['prompt', 'abort']);
  } finally {
    process.env.PATH = originalPath;
    if (originalCapture === undefined) delete process.env.PI_FAKE_CAPTURE;
    else process.env.PI_FAKE_CAPTURE = originalCapture;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
