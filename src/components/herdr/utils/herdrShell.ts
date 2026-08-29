import type { Project } from '../../../types/app';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;

function createHerdrClientSessionId(): string {
  const randomId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `herdr-${randomId}`;
}

export function getHerdrClientSessionId(projectId: string, storage?: SessionStorage): string {
  const sessionKey = `cloudcli:herdr-client:${projectId}`;
  const clientSessionId = createHerdrClientSessionId();

  try {
    const resolvedStorage = storage ?? sessionStorage;
    const existingSessionId = resolvedStorage.getItem(sessionKey);
    if (existingSessionId) {
      return existingSessionId;
    }
    resolvedStorage.setItem(sessionKey, clientSessionId);
  } catch {
    // Browsers can disable session storage; an in-memory id still isolates this mount.
  }

  return clientSessionId;
}

export function createHerdrShellProps(
  project: Project,
  isActive: boolean,
  shellSessionId: string,
) {
  return {
    project,
    command: 'herdr',
    isPlainShell: true,
    autoConnect: true,
    minimal: true,
    isActive,
    shellSessionId,
    shellMode: 'herdr',
  } as const;
}
