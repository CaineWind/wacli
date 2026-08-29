import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeTerminalBinaryInput,
  installTerminalInputSync,
} from './terminalInput';

test('terminal binary input preserves non-UTF-8 mouse report bytes', () => {
  const report = String.fromCharCode(0x1b, 0x5b, 0x4d, 0x20, 0xff, 0x21);

  assert.equal(encodeTerminalBinaryInput(report), 'G1tNIP8h');
});

test('Herdr terminal input sync forwards events, restores mouse tracking, and disposes cleanly', () => {
  const listeners = {
    binary: null as ((data: string) => void) | null,
    data: null as ((data: string) => void) | null,
    parsed: null as (() => void) | null,
  };
  const terminal = {
    modes: { mouseTrackingMode: 'none' },
    writes: [] as string[],
    write(data: string) {
      this.writes.push(data);
    },
    onBinary(listener: (data: string) => void) {
      listeners.binary = listener;
      return { dispose: () => { listeners.binary = null; } };
    },
    onData(listener: (data: string) => void) {
      listeners.data = listener;
      return { dispose: () => { listeners.data = null; } };
    },
    onWriteParsed(listener: () => void) {
      listeners.parsed = listener;
      return { dispose: () => { listeners.parsed = null; } };
    },
  };
  const container = new EventTarget();
  const messages: Array<{ type: string; data: string }> = [];

  const dispose = installTerminalInputSync({
    terminal: terminal as never,
    container: container as never,
    shellMode: 'herdr',
    send: (message) => messages.push(message),
  });

  assert.deepEqual(terminal.writes, ['\x1b[?1002h\x1b[?1006h']);
  terminal.modes.mouseTrackingMode = 'drag';
  listeners.data?.('typed');
  listeners.binary?.(String.fromCharCode(0xff));
  assert.deepEqual(messages, [
    { type: 'input', data: 'typed' },
    { type: 'input_binary', data: '/w==' },
  ]);

  const contextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(contextMenuEvent);
  assert.equal(contextMenuEvent.defaultPrevented, true);

  terminal.modes.mouseTrackingMode = 'none';
  listeners.parsed?.();
  assert.equal(terminal.writes.length, 2);

  dispose();
  assert.deepEqual(listeners, { binary: null, data: null, parsed: null });
  const disposedContextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(disposedContextMenuEvent);
  assert.equal(disposedContextMenuEvent.defaultPrevented, false);
});

test('default shell input sync leaves browser context menus and mouse tracking unchanged', () => {
  const terminal = {
    modes: { mouseTrackingMode: 'none' },
    writes: [] as string[],
    write(data: string) {
      this.writes.push(data);
    },
    onBinary: () => ({ dispose: () => undefined }),
    onData: () => ({ dispose: () => undefined }),
    onWriteParsed: () => ({ dispose: () => undefined }),
  };
  const container = new EventTarget();
  const dispose = installTerminalInputSync({
    terminal: terminal as never,
    container: container as never,
    shellMode: 'default',
    send: () => undefined,
  });

  const contextMenuEvent = new Event('contextmenu', { cancelable: true });
  container.dispatchEvent(contextMenuEvent);
  assert.equal(contextMenuEvent.defaultPrevented, false);
  assert.deepEqual(terminal.writes, []);

  dispose();
});
