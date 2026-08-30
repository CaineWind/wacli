type ShellSocketRef<TSocket extends ReleasableShellSocket> = {
  current: TSocket | null;
};

export type ReleasableShellSocket = {
  readyState: number;
  close: () => void;
  onopen: unknown;
  onmessage: unknown;
  onclose: unknown;
  onerror: unknown;
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/**
 * Releases a socket only when it still owns the supplied ref. Detaching
 * handlers first prevents close events from retaining or updating an
 * unmounted shell component.
 */
export function releaseShellSocket<TSocket extends ReleasableShellSocket>(
  socketRef: ShellSocketRef<TSocket>,
  socket: TSocket | null = socketRef.current,
  closeTransport = true,
): boolean {
  if (!socket || socketRef.current !== socket) {
    return false;
  }

  socketRef.current = null;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;

  if (
    closeTransport
    && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)
  ) {
    socket.close();
  }

  return true;
}
