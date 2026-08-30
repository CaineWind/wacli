type ReplayRecord = {
  sessionKey: string;
  data: string;
  bytes: number;
  active: boolean;
};

type ReplaySession = {
  records: ReplayRecord[];
  head: number;
  bytes: number;
  truncated: boolean;
};

type TerminalReplaySnapshot = {
  chunks: string[];
  truncated: boolean;
};

type TerminalReplayStoreOptions = {
  maxSessionBytes?: number;
  maxSessionEntries?: number;
  maxTotalBytes?: number;
};

const DEFAULT_MAX_SESSION_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SESSION_ENTRIES = 5_000;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function retainUtf8Tail(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) {
    return { value, truncated: false };
  }

  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }

  return {
    value: bytes.subarray(start).toString('utf8'),
    truncated: true,
  };
}

/**
 * Used by the shell websocket service to own replay memory across retained
 * PTYs. Websocket module tests construct isolated instances to verify that per-session
 * and global budgets do not affect process lifetime or live output.
 */
export class TerminalReplayStore {
  private readonly maxSessionBytes: number;
  private readonly maxSessionEntries: number;
  private readonly maxTotalBytes: number;
  private readonly sessions = new Map<string, ReplaySession>();
  private globalRecords: ReplayRecord[] = [];
  private globalHead = 0;
  private inactiveGlobalRecords = 0;
  private totalBytes = 0;

  constructor(options: TerminalReplayStoreOptions = {}) {
    this.maxSessionBytes = options.maxSessionBytes ?? DEFAULT_MAX_SESSION_BYTES;
    this.maxSessionEntries = options.maxSessionEntries ?? DEFAULT_MAX_SESSION_ENTRIES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  append(sessionKey: string, data: string): void {
    if (!data || this.maxSessionBytes <= 0 || this.maxTotalBytes <= 0) {
      return;
    }

    const retained = retainUtf8Tail(data, Math.min(this.maxSessionBytes, this.maxTotalBytes));
    const bytes = Buffer.byteLength(retained.value, 'utf8');
    const session = this.sessions.get(sessionKey) ?? {
      records: [],
      head: 0,
      bytes: 0,
      truncated: false,
    };
    this.sessions.set(sessionKey, session);

    const record: ReplayRecord = {
      sessionKey,
      data: retained.value,
      bytes,
      active: true,
    };
    session.records.push(record);
    session.bytes += bytes;
    session.truncated ||= retained.truncated;
    this.globalRecords.push(record);
    this.totalBytes += bytes;

    while (
      session.records.length - session.head > this.maxSessionEntries
      || session.bytes > this.maxSessionBytes
    ) {
      this.deactivate(session.records[session.head], true);
      this.advanceSessionHead(session);
    }

    while (this.totalBytes > this.maxTotalBytes) {
      const oldest = this.nextActiveGlobalRecord();
      if (!oldest) {
        break;
      }
      const owner = this.sessions.get(oldest.sessionKey);
      this.deactivate(oldest, true);
      if (owner) {
        this.advanceSessionHead(owner);
      }
    }

    this.compact(session);
    this.compactGlobalRecords();
  }

  snapshot(sessionKey: string): TerminalReplaySnapshot {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return { chunks: [], truncated: false };
    }

    return {
      chunks: session.records
        .slice(session.head)
        .filter((record) => record.active)
        .map((record) => record.data),
      truncated: session.truncated,
    };
  }

  clear(sessionKey: string): void {
    this.delete(sessionKey);
    this.sessions.set(sessionKey, {
      records: [],
      head: 0,
      bytes: 0,
      truncated: false,
    });
  }

  delete(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }

    for (let index = session.head; index < session.records.length; index += 1) {
      this.deactivate(session.records[index], false);
    }
    this.sessions.delete(sessionKey);
    this.compactGlobalRecords();
  }

  private deactivate(record: ReplayRecord | undefined, markTruncated: boolean): void {
    if (!record?.active) {
      return;
    }

    record.active = false;
    this.inactiveGlobalRecords += 1;
    this.totalBytes -= record.bytes;
    const session = this.sessions.get(record.sessionKey);
    if (session) {
      session.bytes -= record.bytes;
      session.truncated ||= markTruncated;
    }
  }

  private advanceSessionHead(session: ReplaySession): void {
    while (session.head < session.records.length && !session.records[session.head].active) {
      session.head += 1;
    }
  }

  private nextActiveGlobalRecord(): ReplayRecord | null {
    while (
      this.globalHead < this.globalRecords.length
      && !this.globalRecords[this.globalHead].active
    ) {
      this.globalHead += 1;
    }
    return this.globalRecords[this.globalHead] ?? null;
  }

  private compact(session: ReplaySession): void {
    if (session.head >= 1_024 && session.head * 2 >= session.records.length) {
      session.records = session.records.slice(session.head);
      session.head = 0;
    }
  }

  private compactGlobalRecords(): void {
    this.nextActiveGlobalRecord();
    if (this.globalHead >= 1_024 && this.globalHead * 2 >= this.globalRecords.length) {
      this.globalRecords = this.globalRecords.slice(this.globalHead);
      this.globalHead = 0;
      this.inactiveGlobalRecords = this.globalRecords.reduce(
        (count, record) => count + (record.active ? 0 : 1),
        0,
      );
    }

    if (
      this.inactiveGlobalRecords >= 1_024
      && this.inactiveGlobalRecords * 2 >= this.globalRecords.length
    ) {
      this.globalRecords = this.globalRecords.filter((record) => record.active);
      this.globalHead = 0;
      this.inactiveGlobalRecords = 0;
    }
  }
}

/** Used by the shell websocket service to bound retained PTY output globally. */
export const terminalReplayStore = new TerminalReplayStore();
