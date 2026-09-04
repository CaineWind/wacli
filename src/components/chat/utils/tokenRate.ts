import type { ServerEvent } from '../../../contexts/WebSocketContext';

export type TokenRateSnapshot = {
  value: number | null;
  isLive: boolean;
  estimatedTokens: number;
  activeDurationMs: number;
};

type ActiveTokenRateRun = {
  requestStartedAt: number;
  firstOutputAt: number | null;
  lastOutputAt: number | null;
  segmentStartedAt: number | null;
  activeDurationMs: number;
  content: string;
  estimatedTokens: number;
  outputEventCount: number;
  hasStreamDelta: boolean;
  lastRateUpdateAt: number | null;
};

type SessionTokenRateState = {
  snapshot: TokenRateSnapshot;
  activeRun: ActiveTokenRateRun | null;
  lastSeq: number;
  seenMessageIds: Set<string>;
};

const EMPTY_SNAPSHOT: TokenRateSnapshot = {
  value: null,
  isLive: false,
  estimatedTokens: 0,
  activeDurationMs: 0,
};

const MIN_LIVE_DURATION_MS = 250;
const MIN_LIVE_TOKENS = 2;
const DEFAULT_MAX_SESSIONS = 100;

const CJK_OR_EMOJI_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;

export function estimateOutputTokens(content: string): number {
  let directTokens = 0;
  let compactCharacters = 0;

  const outputContent = content.replace(/<\/?proposed_plan>/giu, '');
  for (const character of outputContent) {
    if (/\s/u.test(character)) continue;
    if (CJK_OR_EMOJI_PATTERN.test(character)) {
      directTokens += 1;
    } else {
      compactCharacters += 1;
    }
  }

  return directTokens + Math.ceil(compactCharacters / 4);
}

function createSessionState(): SessionTokenRateState {
  return {
    snapshot: { ...EMPTY_SNAPSHOT },
    activeRun: null,
    lastSeq: 0,
    seenMessageIds: new Set(),
  };
}

function createActiveRun(startedAt: number): ActiveTokenRateRun {
  return {
    requestStartedAt: startedAt,
    firstOutputAt: null,
    lastOutputAt: null,
    segmentStartedAt: null,
    activeDurationMs: 0,
    content: '',
    estimatedTokens: 0,
    outputEventCount: 0,
    hasStreamDelta: false,
    lastRateUpdateAt: null,
  };
}

function currentDuration(run: ActiveTokenRateRun, at: number): number {
  if (run.segmentStartedAt === null) return run.activeDurationMs;
  return run.activeDurationMs + Math.max(0, at - run.segmentStartedAt);
}

function pauseAtLastOutput(run: ActiveTokenRateRun): void {
  if (run.segmentStartedAt === null || run.lastOutputAt === null) return;
  run.activeDurationMs += Math.max(0, run.lastOutputAt - run.segmentStartedAt);
  run.segmentStartedAt = null;
}

/** Maintains bounded, in-memory output-rate state for the chat interface. */
export class TokenRateTracker {
  private readonly sessions = new Map<string, SessionTokenRateState>();

  constructor(private readonly maxSessions = DEFAULT_MAX_SESSIONS) {}

  getSnapshot(sessionId: string | null | undefined): TokenRateSnapshot {
    if (!sessionId) return { ...EMPTY_SNAPSHOT };
    return { ...(this.sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT) };
  }

  begin(sessionId: string, startedAt = Date.now()): TokenRateSnapshot {
    const state = this.touch(sessionId);
    if (!state.activeRun) {
      state.activeRun = createActiveRun(startedAt);
      state.lastSeq = 0;
      state.seenMessageIds.clear();
    }
    return { ...state.snapshot };
  }

  record(sessionId: string, event: ServerEvent, at = Date.now()): TokenRateSnapshot {
    const state = this.touch(sessionId);
    const startsRun = (event.kind === 'chat_subscribed' && event.isProcessing === true)
      || (event.kind === 'status' && event.text !== 'token_budget')
      || event.kind === 'stream_delta'
      || event.kind === 'thinking'
      || event.kind === 'text';
    if (!state.activeRun && startsRun) {
      this.begin(sessionId, at);
    }
    if (this.isDuplicate(state, event)) return { ...state.snapshot };

    if (event.kind === 'chat_subscribed' && event.isProcessing === true) {
      return this.begin(sessionId, at);
    }

    if (event.kind === 'status' && event.text !== 'token_budget') {
      return this.begin(sessionId, at);
    }

    if (event.kind === 'protocol_error') {
      return this.finish(state, at);
    }

    if (event.kind === 'complete') {
      return this.finish(state, at);
    }

    if (event.kind === 'tool_use' || event.kind === 'permission_request' || event.kind === 'stream_end') {
      if (state.activeRun) pauseAtLastOutput(state.activeRun);
      return { ...state.snapshot };
    }

    if (event.kind !== 'stream_delta' && event.kind !== 'thinking' && event.kind !== 'text') {
      return { ...state.snapshot };
    }

    const content = typeof event.content === 'string' ? event.content : '';
    if (!content) return { ...state.snapshot };

    const run = state.activeRun ?? createActiveRun(at);
    state.activeRun = run;
    if (event.kind === 'text' && run.hasStreamDelta) {
      return { ...state.snapshot };
    }
    if (event.kind === 'stream_delta') run.hasStreamDelta = true;

    if (run.firstOutputAt === null) run.firstOutputAt = at;
    if (run.segmentStartedAt === null) run.segmentStartedAt = at;
    run.lastOutputAt = at;
    run.outputEventCount += 1;
    run.content += content;
    run.estimatedTokens = estimateOutputTokens(run.content);

    const duration = currentDuration(run, at);
    const hasLiveSample = duration >= MIN_LIVE_DURATION_MS && run.estimatedTokens >= MIN_LIVE_TOKENS;
    const shouldRefreshRate = hasLiveSample
      && (run.lastRateUpdateAt === null || at - run.lastRateUpdateAt >= MIN_LIVE_DURATION_MS);
    if (shouldRefreshRate) run.lastRateUpdateAt = at;
    state.snapshot = {
      value: shouldRefreshRate
        ? run.estimatedTokens / (duration / 1_000)
        : state.snapshot.value,
      isLive: true,
      estimatedTokens: run.estimatedTokens,
      activeDurationMs: duration,
    };
    return { ...state.snapshot };
  }

  private finish(state: SessionTokenRateState, at: number): TokenRateSnapshot {
    const run = state.activeRun;
    if (!run) return { ...state.snapshot, isLive: false };

    pauseAtLastOutput(run);
    let duration = run.activeDurationMs;
    if (run.outputEventCount === 1 && duration === 0 && run.firstOutputAt !== null) {
      duration = Math.max(0, at - run.requestStartedAt);
    }

    const value = run.estimatedTokens > 0
      ? run.estimatedTokens / (Math.max(duration, MIN_LIVE_DURATION_MS) / 1_000)
      : state.snapshot.value;
    state.snapshot = {
      value,
      isLive: false,
      estimatedTokens: run.estimatedTokens || state.snapshot.estimatedTokens,
      activeDurationMs: duration || state.snapshot.activeDurationMs,
    };
    state.activeRun = null;
    return { ...state.snapshot };
  }

  private isDuplicate(state: SessionTokenRateState, event: ServerEvent): boolean {
    if (typeof event.seq === 'number') {
      if (event.seq <= state.lastSeq) return true;
      state.lastSeq = event.seq;
      return false;
    }

    const id = typeof event.id === 'string' ? event.id : null;
    if (!id) return false;
    if (state.seenMessageIds.has(id)) return true;
    state.seenMessageIds.add(id);
    if (state.seenMessageIds.size > 200) {
      const oldest = state.seenMessageIds.values().next().value;
      if (oldest) state.seenMessageIds.delete(oldest);
    }
    return false;
  }

  private touch(sessionId: string): SessionTokenRateState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, existing);
      return existing;
    }

    const state = createSessionState();
    this.sessions.set(sessionId, state);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }
    return state;
  }
}
