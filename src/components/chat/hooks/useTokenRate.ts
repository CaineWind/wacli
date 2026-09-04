import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { SessionActivity } from '../../../hooks/useSessionProtection';
import { TokenRateTracker, type TokenRateSnapshot } from '../utils/tokenRate';

export function useTokenRate(
  sessionId: string | null,
  activity: SessionActivity | null,
): {
  tokenRate: TokenRateSnapshot;
  recordTokenRateEvent: (event: ServerEvent, resolvedSessionId: string | null) => void;
} {
  const trackerRef = useRef<TokenRateTracker>();
  if (!trackerRef.current) trackerRef.current = new TokenRateTracker();

  const activeSessionIdRef = useRef(sessionId);
  activeSessionIdRef.current = sessionId;
  const [tokenRate, setTokenRate] = useState(() => trackerRef.current!.getSnapshot(sessionId));

  useEffect(() => {
    setTokenRate(trackerRef.current!.getSnapshot(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !activity) return;
    trackerRef.current!.begin(sessionId, activity.startedAt);
  }, [activity, sessionId]);

  const recordTokenRateEvent = useCallback((event: ServerEvent, resolvedSessionId: string | null) => {
    if (!resolvedSessionId) return;
    const snapshot = trackerRef.current!.record(resolvedSessionId, event);
    if (resolvedSessionId === activeSessionIdRef.current) {
      setTokenRate((previous) => (
        previous.value === snapshot.value && previous.isLive === snapshot.isLive
          ? previous
          : snapshot
      ));
    }
  }, []);

  return { tokenRate, recordTokenRateEvent };
}
