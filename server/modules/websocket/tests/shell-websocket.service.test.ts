import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
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
    writes: [] as Array<string | Buffer>,
    resizeHistory: [] as Array<{ cols: number; rows: number }>,
    lastResize: null as { cols: number; rows: number } | null,
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
    write(data: string | Buffer) {
      this.writes.push(data);
    },
    resize(cols: number, rows: number) {
      this.lastResize = { cols, rows };
      this.resizeHistory.push({ cols, rows });
    },
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
    cols: 110,
    rows: 34,
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
  firstSocket.emit('message', JSON.stringify({ type: 'input', data: 'stale-input' }));
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.deepEqual(pty.writes, []);
  assert.deepEqual(pty.lastResize, { cols: 110, rows: 34 });
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

test('Herdr shell clients do not inherit a parent pane identity', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  let spawnedEnvironment: NodeJS.ProcessEnv | undefined;
  const dependencies = {
    resolveProviderSessionId: () => null,
    environment: {
      PATH: process.env.PATH,
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'w1:p1',
      HERDR_TAB_ID: 'w1:t1',
      HERDR_WORKSPACE_ID: 'w1',
      HERDR_SOCKET_PATH: 'C:\\herdr\\herdr.sock',
    },
    spawnPty: (
      _shell: string,
      _args: string | string[],
      options: IPtyForkOptions | IWindowsPtyForkOptions,
    ) => {
      spawnedEnvironment = options.env;
      return pty as never;
    },
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `herdr-shell-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      initialCommand: 'herdr',
      isPlainShell: true,
      shellMode: 'herdr',
    })
  );

  assert.equal(spawnedEnvironment?.HERDR_ENV, undefined);
  assert.equal(spawnedEnvironment?.HERDR_PANE_ID, undefined);
  assert.equal(spawnedEnvironment?.HERDR_TAB_ID, undefined);
  assert.equal(spawnedEnvironment?.HERDR_WORKSPACE_ID, undefined);
  assert.equal(spawnedEnvironment?.HERDR_SOCKET_PATH, 'C:\\herdr\\herdr.sock');

  pty.emitExit();
});

test('Herdr reconnect redraws the live TUI without replaying stale terminal frames', async () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `herdr-reconnect-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    initialCommand: 'herdr',
    isPlainShell: true,
    shellMode: 'herdr',
    cols: 120,
    rows: 40,
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);
  pty.emitData('stale-full-screen-frame');

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(
    replacementSocket.frames.some((frame) => frame.includes('stale-full-screen-frame')),
    false,
  );
  assert.deepEqual(pty.resizeHistory.slice(-2), [
    { cols: 119, rows: 40 },
    { cols: 120, rows: 40 },
  ]);

  pty.emitData('fresh-frame-after-redraw');
  assert.equal(
    replacementSocket.frames.some((frame) => frame.includes('fresh-frame-after-redraw')),
    true,
  );

  pty.emitExit();
});

test('Herdr forwards binary xterm mouse reports to the PTY without UTF-8 conversion', () => {
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
      sessionId: `herdr-mouse-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      initialCommand: 'herdr',
      isPlainShell: true,
      shellMode: 'herdr',
    }),
  );

  const mouseReport = Buffer.from([0x1b, 0x5b, 0x4d, 0x20, 0xff, 0x21]);
  socket.emit(
    'message',
    JSON.stringify({ type: 'input_binary', data: mouseReport.toString('base64') }),
  );

  assert.equal(pty.writes.length, 1);
  assert.ok(Buffer.isBuffer(pty.writes[0]));
  assert.deepEqual(pty.writes[0], mouseReport);

  socket.emit('message', JSON.stringify({ type: 'input_binary', data: 'not base64!' }));
  socket.emit(
    'message',
    JSON.stringify({ type: 'input_binary', data: Buffer.alloc(1025).toString('base64') }),
  );
  assert.equal(pty.writes.length, 1);

  pty.emitExit();
});

test('Herdr viewport claims restore the browser dimensions without affecting regular shells', async () => {
  const herdrPty = createFakePty();
  const herdrSocket = createFakeSocket();
  handleShellConnection(herdrSocket as never, {
    resolveProviderSessionId: () => null,
    spawnPty: () => herdrPty as never,
  });
  herdrSocket.emit('message', JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `herdr-viewport-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    initialCommand: 'herdr',
    isPlainShell: true,
    shellMode: 'herdr',
    cols: 120,
    rows: 40,
  }));

  herdrSocket.emit('message', JSON.stringify({
    type: 'viewport_claim',
    cols: 120,
    rows: 40,
  }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(herdrPty.resizeHistory.slice(-2), [
    { cols: 119, rows: 40 },
    { cols: 120, rows: 40 },
  ]);

  const regularPty = createFakePty();
  const regularSocket = createFakeSocket();
  handleShellConnection(regularSocket as never, {
    resolveProviderSessionId: () => null,
    spawnPty: () => regularPty as never,
  });
  regularSocket.emit('message', JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `regular-viewport-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    initialCommand: 'powershell',
    isPlainShell: true,
    cols: 100,
    rows: 30,
  }));
  regularSocket.emit('message', JSON.stringify({
    type: 'viewport_claim',
    cols: 100,
    rows: 30,
  }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(regularPty.resizeHistory, []);

  herdrPty.emitExit();
  regularPty.emitExit();
});
