import path from 'node:path';

import type { LLMProvider } from '@/shared/types.js';

type SessionWatchEventType = 'add' | 'change';

type SessionWatchEvent = {
  eventType: SessionWatchEventType;
  provider: LLMProvider;
  filePath: string;
};

type SynchronizeResult = {
  indexed: boolean;
  sessionId: string | null;
};

type SchedulerDependencies = {
  synchronize: (event: SessionWatchEvent) => Promise<SynchronizeResult>;
  onSynchronized: (event: SessionWatchEvent, result: SynchronizeResult) => void;
  onError: (event: SessionWatchEvent, error: unknown) => void;
  platform?: NodeJS.Platform;
};

type SchedulerOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  addRetryDelaysMs?: number[];
};

type PendingEntry = {
  event: SessionWatchEvent;
  firstQueuedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  dirty: boolean;
  retryIndex: number;
};

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 6_000;
const DEFAULT_ADD_RETRY_DELAYS_MS = [250, 1_000, 3_000];

/**
 * Used by the provider session watcher to coalesce filesystem noise while
 * guaranteeing serialized synchronization per artifact. Provider tests also
 * construct it directly to verify retry and shutdown behavior.
 */
export class SessionWatchScheduler {
  private readonly dependencies: SchedulerDependencies;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly addRetryDelaysMs: number[];
  private readonly pending = new Map<string, PendingEntry>();
  private readonly inFlight = new Set<Promise<void>>();
  private closed = false;

  constructor(dependencies: SchedulerDependencies, options: SchedulerOptions = {}) {
    this.dependencies = dependencies;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.addRetryDelaysMs = options.addRetryDelaysMs ?? DEFAULT_ADD_RETRY_DELAYS_MS;
  }

  enqueue(event: SessionWatchEvent): void {
    if (this.closed) {
      return;
    }

    const key = this.keyFor(event);
    const existing = this.pending.get(key);
    if (!existing) {
      const entry: PendingEntry = {
        event,
        firstQueuedAt: Date.now(),
        timer: null,
        inFlight: false,
        dirty: false,
        retryIndex: 0,
      };
      this.pending.set(key, entry);
      this.schedule(key, entry, this.debounceMs);
      return;
    }

    existing.event = {
      ...event,
      eventType: existing.event.eventType === 'add' ? 'add' : event.eventType,
    };
    existing.retryIndex = 0;

    if (existing.inFlight) {
      existing.dirty = true;
      return;
    }

    const elapsed = Date.now() - existing.firstQueuedAt;
    this.schedule(key, existing, Math.min(this.debounceMs, Math.max(0, this.maxWaitMs - elapsed)));
  }

  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight);
      return;
    }

    this.closed = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    await Promise.allSettled(this.inFlight);
    this.pending.clear();
  }

  private keyFor(event: SessionWatchEvent): string {
    const resolvedPath = path.resolve(event.filePath);
    const normalizedPath = this.dependencies.platform === 'win32'
      ? resolvedPath.toLowerCase()
      : resolvedPath;
    return `${event.provider}:${normalizedPath}`;
  }

  private schedule(key: string, entry: PendingEntry, delayMs: number): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.startFlush(key, entry);
    }, delayMs);
  }

  private startFlush(key: string, entry: PendingEntry): void {
    if (this.closed || entry.inFlight || this.pending.get(key) !== entry) {
      return;
    }

    entry.inFlight = true;
    entry.dirty = false;
    const event = entry.event;
    const operation = this.flush(key, entry, event);
    this.inFlight.add(operation);
    void operation.finally(() => this.inFlight.delete(operation));
  }

  private async flush(key: string, entry: PendingEntry, event: SessionWatchEvent): Promise<void> {
    let indexed = false;
    try {
      const result = await this.dependencies.synchronize(event);
      indexed = result.indexed;
      if (result.indexed) {
        this.dependencies.onSynchronized(event, result);
      }
    } catch (error) {
      this.dependencies.onError(event, error);
    } finally {
      entry.inFlight = false;
    }

    if (this.closed || this.pending.get(key) !== entry) {
      return;
    }

    if (entry.dirty) {
      entry.firstQueuedAt = Date.now();
      entry.retryIndex = 0;
      this.schedule(key, entry, this.debounceMs);
      return;
    }

    if (!indexed && event.eventType === 'add' && entry.retryIndex < this.addRetryDelaysMs.length) {
      const retryDelay = this.addRetryDelaysMs[entry.retryIndex];
      entry.retryIndex += 1;
      this.schedule(key, entry, retryDelay);
      return;
    }

    this.pending.delete(key);
  }
}
