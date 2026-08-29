import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    killed: false,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
  };
}

test('a stale socket close cannot detach the socket that replaced it', () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `stale-close-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    isPlainShell: true,
    initialCommand: 'test-command',
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  replacementSocket.frames.length = 0;

  // This ordering reproduces a delayed close from a backgrounded mobile tab.
  firstSocket.emit('close');
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);

  pty.emitExit();
});

test('shell output detects and normalizes a wrapped authentication URL', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `wrapped-url-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    })
  );
  socket.frames.length = 0;

  pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
  assert.deepEqual(authenticationFrame, {
    type: 'auth_url',
    url: 'https://example.com/authorize?code=abc',
    autoOpen: false,
  });

  pty.emitExit();
});

test('Codex shell sessions use the cmd shim on Windows', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  let spawnedShell = '';
  let spawnedArgs: string[] = [];
  const dependencies = {
    resolveProviderSessionId: () => 'codex-session-id',
    platform: () => 'win32' as const,
    spawnPty: (shell: string, args: string | string[]) => {
      spawnedShell = shell;
      spawnedArgs = Array.isArray(args) ? args : [args];
      return pty as never;
    },
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `codex-shell-${Date.now()}`,
      hasSession: true,
      provider: 'codex',
    })
  );

  assert.equal(spawnedShell, 'powershell.exe');
  assert.deepEqual(spawnedArgs, [
    '-Command',
    'codex.cmd resume "codex-session-id"; if ($LASTEXITCODE -ne 0) { codex.cmd }',
  ]);

  pty.emitExit();

  const freshPty = createFakePty();
  const freshSocket = createFakeSocket();
  const freshDependencies = {
    resolveProviderSessionId: () => null,
    platform: () => 'win32' as const,
    spawnPty: (shell: string, args: string | string[]) => {
      spawnedShell = shell;
      spawnedArgs = Array.isArray(args) ? args : [args];
      return freshPty as never;
    },
  };

  handleShellConnection(freshSocket as never, freshDependencies);
  freshSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `fresh-codex-shell-${Date.now()}`,
      hasSession: false,
      provider: 'codex',
    })
  );

  assert.equal(spawnedShell, 'powershell.exe');
  assert.deepEqual(spawnedArgs, ['-Command', 'codex.cmd']);

  freshPty.emitExit();
});
