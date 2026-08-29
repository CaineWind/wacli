type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;

const HERDR_CLIENT_SESSION_KEY = 'cloudcli:herdr-client';

function createHerdrClientSessionId(): string {
  const randomId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `herdr-${randomId}`;
}

export function getHerdrClientSessionId(storage?: SessionStorage): string {
  const clientSessionId = createHerdrClientSessionId();

  try {
    const resolvedStorage = storage ?? sessionStorage;
    const existingSessionId = resolvedStorage.getItem(HERDR_CLIENT_SESSION_KEY);
    if (existingSessionId) {
      return existingSessionId;
    }
    resolvedStorage.setItem(HERDR_CLIENT_SESSION_KEY, clientSessionId);
  } catch {
    // Browsers can disable session storage; an in-memory id still isolates this mount.
  }

  return clientSessionId;
}

export function createHerdrShellProps(
  isActive: boolean,
  shellSessionId: string,
) {
  return {
    project: null,
    command: 'herdr',
    isPlainShell: true,
    autoConnect: true,
    minimal: true,
    isActive,
    shellSessionId,
    shellMode: 'herdr',
  } as const;
}
