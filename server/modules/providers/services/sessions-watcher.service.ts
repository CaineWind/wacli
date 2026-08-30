import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { SessionWatchScheduler } from '@/modules/providers/services/session-watch-scheduler.js';

const PROVIDER_WATCH_PATHS: Array<{ provider: LLMProvider; rootPath: string }> = [
  {
    provider: 'claude',
    rootPath: path.join(os.homedir(), '.claude', 'projects'),
  },
  {
    provider: 'cursor',
    rootPath: path.join(os.homedir(), '.cursor', 'projects'),
  },
  {
    provider: 'codex',
    rootPath: path.join(os.homedir(), '.codex', 'sessions'),
  },
  {
    provider: 'opencode',
    rootPath: path.join(os.homedir(), '.local', 'share', 'opencode'),
  },
];

const WATCHER_IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'subagents',
  'tool-results',
]);

const PROJECTS_UPDATE_DEBOUNCE_MS = 500;
const PROJECTS_UPDATE_MAX_WAIT_MS = 2_000;

const watchers: FSWatcher[] = [];
let watchScheduler: SessionWatchScheduler | null = null;

type PendingWatcherUpdate = {
  providers: Set<LLMProvider>;
  changeTypes: Set<'add' | 'change'>;
  /**
   * Provider-native session ids reported by the synchronizers. They are
   * translated back to app-facing session rows at flush time, because the
   * transcript file names on disk only ever contain provider ids.
   */
  updatedSessionIds: Set<string>;
};

let pendingWatcherUpdate: PendingWatcherUpdate | null = null;
let pendingWatcherUpdateStartedAt: number | null = null;
let pendingWatcherFlushTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRefreshInFlight = false;
let watcherRescheduleAfterRefresh = false;

/**
 * Filters watcher events to provider-specific session artifact file types.
 */
function isWatcherTargetFile(provider: LLMProvider, filePath: string): boolean {
  if (provider === 'opencode') {
    return path.basename(filePath) === 'opencode.db';
  }

  return filePath.endsWith('.jsonl');
}

function clearPendingWatcherFlushTimer(): void {
  if (pendingWatcherFlushTimer) {
    clearTimeout(pendingWatcherFlushTimer);
    pendingWatcherFlushTimer = null;
  }
}

function schedulePendingWatcherFlush(): void {
  if (!pendingWatcherUpdate) {
    return;
  }

  const now = Date.now();
  if (pendingWatcherUpdateStartedAt === null) {
    pendingWatcherUpdateStartedAt = now;
  }

  const elapsed = now - pendingWatcherUpdateStartedAt;
  const remainingMaxWait = Math.max(0, PROJECTS_UPDATE_MAX_WAIT_MS - elapsed);
  const delay = Math.min(PROJECTS_UPDATE_DEBOUNCE_MS, remainingMaxWait);

  clearPendingWatcherFlushTimer();
  pendingWatcherFlushTimer = setTimeout(() => {
    void flushPendingWatcherUpdate();
  }, delay);
}

function queuePendingWatcherUpdate(
  eventType: 'add' | 'change',
  provider: LLMProvider,
  updatedSessionId: string | null
): void {
  if (!pendingWatcherUpdate) {
    pendingWatcherUpdate = {
      providers: new Set<LLMProvider>(),
      changeTypes: new Set<'add' | 'change'>(),
      updatedSessionIds: new Set<string>(),
    };
  }

  pendingWatcherUpdate.providers.add(provider);
  pendingWatcherUpdate.changeTypes.add(eventType);
  if (updatedSessionId) {
    pendingWatcherUpdate.updatedSessionIds.add(updatedSessionId);
  }

  schedulePendingWatcherFlush();
}

/**
 * Builds one `session_upserted` delta event for a provider-native session id.
 *
 * The event carries everything a sidebar needs to upsert the session in place
 * (session summary plus owning-project metadata), so clients never need a full
 * project-list refetch when a transcript file changes on disk. Returns `null`
 * when the id cannot be resolved to an indexed session row.
 */
async function buildSessionUpsertedEvent(updatedProviderSessionId: string): Promise<string | null> {
  const row = sessionsDb.getSessionByProviderSessionId(updatedProviderSessionId)
    ?? sessionsDb.getSessionById(updatedProviderSessionId);
  if (!row || row.isArchived) {
    return null;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  return JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    provider: row.provider,
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  });
}

async function flushPendingWatcherUpdate(): Promise<void> {
  clearPendingWatcherFlushTimer();

  if (!pendingWatcherUpdate) {
    return;
  }

  if (watcherRefreshInFlight) {
    watcherRescheduleAfterRefresh = true;
    return;
  }

  const queuedUpdate = pendingWatcherUpdate;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = true;

  try {
    // Per-session deltas instead of full project snapshots: an upsert of one
    // session can never clobber unrelated client state, so the frontend needs
    // no "suppress updates while a run is active" protection logic.
    const events: string[] = [];
    for (const updatedSessionId of queuedUpdate.updatedSessionIds) {
      const event = await buildSessionUpsertedEvent(updatedSessionId);
      if (event) {
        events.push(event);
      }
    }

    if (events.length > 0) {
      connectedClients.forEach(client => {
        if (client.readyState === WS_OPEN_STATE) {
          for (const event of events) {
            client.send(event);
          }
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    watcherRefreshInFlight = false;

    if (pendingWatcherUpdate || watcherRescheduleAfterRefresh) {
      watcherRescheduleAfterRefresh = false;
      schedulePendingWatcherFlush();
    }
  }
}

/**
 * Handles file watcher updates and triggers provider file-level synchronization.
 */
function containsIgnoredDirectory(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some((segment) => WATCHER_IGNORED_DIRECTORY_NAMES.has(segment));
}

/** Used by this module's watcher setup and its filter regression tests. */
export function createSessionWatcherIgnored(
  provider: LLMProvider,
  rootPath: string,
): (candidatePath: string, stats?: { isDirectory(): boolean; isFile(): boolean }) => boolean {
  return (candidatePath, stats) => {
    if (containsIgnoredDirectory(candidatePath, rootPath)) {
      return true;
    }

    if (!stats || stats.isDirectory()) {
      return false;
    }

    if (!stats.isFile()) {
      return true;
    }

    const basename = path.basename(candidatePath);
    if (basename === '.DS_Store' || basename.endsWith('.tmp') || basename.endsWith('.swp')) {
      return true;
    }

    return !isWatcherTargetFile(provider, candidatePath);
  };
}

function createWatchScheduler(): SessionWatchScheduler {
  return new SessionWatchScheduler({
    platform: process.platform,
    synchronize: (event) => sessionSynchronizerService.synchronizeProviderFile(
      event.provider,
      event.filePath,
    ),
    onSynchronized: (event, result) => {
      console.log(
        `Session synchronization triggered by ${event.eventType} event for provider "${event.provider}"`,
        { filePath: event.filePath, sessionId: result.sessionId },
      );
      queuePendingWatcherUpdate(event.eventType, event.provider, result.sessionId);
    },
    onError: (event, error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Session watcher sync failed for provider "${event.provider}"`, {
        eventType: event.eventType,
        filePath: event.filePath,
        error: message,
      });
    },
  });
}

/**
 * Used by the server bootstrap in `server/index.ts` to start provider
 * filesystem watchers after the application services are ready.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  if (watchers.length > 0 || watchScheduler) {
    return;
  }

  console.log('Setting up session watchers');

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    failures: initialSync.failures,
  });

  watchScheduler = createWatchScheduler();

  for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
    try {
      await fsPromises.mkdir(rootPath, { recursive: true });
      const watchTarget = provider === 'opencode'
        ? path.join(rootPath, 'opencode.db')
        : rootPath;

      const watcher = chokidar.watch(watchTarget, {
        ignored: createSessionWatcherIgnored(provider, rootPath),
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        interval: 6_000,
        binaryInterval: 6_000,
      });

      watcher
        .on('add', (filePath: string) => {
          watchScheduler?.enqueue({ eventType: 'add', filePath, provider });
        })
        .on('change', (filePath: string) => {
          watchScheduler?.enqueue({ eventType: 'change', filePath, provider });
        })
        .on('ready', () => {
          const watchedDirectoryCount = Object.keys(watcher.getWatched()).length;
          console.log(`Session watcher ready for provider "${provider}"`, {
            backend: watcher.options.usePolling ? 'polling' : 'native',
            rootPath,
            watchTarget,
            watchedDirectoryCount,
          });
        })
        .on('error', (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Session watcher error for provider "${provider}"`, { error: message });
        });

      watchers.push(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to initialize session watcher for provider "${provider}"`, {
        rootPath,
        error: message,
      });
    }
  }
}

/**
 * Used by the shutdown path in `server/index.ts` to drain scheduler work and
 * close every provider filesystem watcher before process exit.
 */
export async function closeSessionsWatcher(): Promise<void> {
  clearPendingWatcherFlushTimer();

  const scheduler = watchScheduler;
  watchScheduler = null;
  await scheduler?.close();

  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to close session watcher', { error: message });
      }
    })
  );
  watchers.length = 0;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = false;
  watcherRescheduleAfterRefresh = false;
}
