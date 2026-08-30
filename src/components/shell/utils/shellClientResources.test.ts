import assert from 'node:assert/strict';
import test from 'node:test';

import {
  releaseShellSocket,
  type ReleasableShellSocket,
} from './shellClientResources';

type FakeSocket = ReleasableShellSocket & {
  closeCalls: number;
};

function createSocket(readyState = 1): FakeSocket {
  return {
    readyState,
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
    },
    onopen: () => undefined,
    onmessage: () => undefined,
    onclose: () => undefined,
    onerror: () => undefined,
  };
}

test('releaseShellSocket detaches every handler before closing an active transport', () => {
  const socket = createSocket();
  const socketRef = { current: socket as FakeSocket | null };

  assert.equal(releaseShellSocket(socketRef), true);
  assert.equal(socketRef.current, null);
  assert.equal(socket.onopen, null);
  assert.equal(socket.onmessage, null);
  assert.equal(socket.onclose, null);
  assert.equal(socket.onerror, null);
  assert.equal(socket.closeCalls, 1);
  assert.equal(releaseShellSocket(socketRef, socket), false);
  assert.equal(socket.closeCalls, 1);
});

test('releaseShellSocket cannot let a stale socket release the current connection', () => {
  const staleSocket = createSocket(3);
  const currentSocket = createSocket();
  const socketRef = { current: currentSocket as FakeSocket | null };

  assert.equal(releaseShellSocket(socketRef, staleSocket), false);
  assert.equal(socketRef.current, currentSocket);
  assert.notEqual(staleSocket.onclose, null);
  assert.equal(staleSocket.closeCalls, 0);
});

test('remote close cleanup detaches handlers without closing the transport again', () => {
  const socket = createSocket(3);
  const socketRef = { current: socket as FakeSocket | null };

  assert.equal(releaseShellSocket(socketRef, socket, false), true);
  assert.equal(socketRef.current, null);
  assert.equal(socket.onclose, null);
  assert.equal(socket.closeCalls, 0);
});
