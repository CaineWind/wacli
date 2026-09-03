import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react/pure';
import { JSDOM } from 'jsdom';
import { useRef } from 'react';

import { useSessionStore } from '../../../stores/useSessionStore';
import type { Project, ProjectSession } from '../../../types/app';

import { useChatSessionState } from './useChatSessionState';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:5200',
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  localStorage: { configurable: true, value: dom.window.localStorage },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
});

const selectedProject: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: 'C:\\workspace\\project-one',
};

const selectedSession: ProjectSession = {
  id: 'session-1',
  title: 'Session One',
};

const historyMessage = {
  id: 'message-1',
  sessionId: selectedSession.id,
  timestamp: '2026-09-03T00:00:00.000Z',
  provider: 'claude' as const,
  kind: 'text' as const,
  role: 'assistant' as const,
  content: 'Loaded from history',
};

const noOp = () => undefined;
const noProcessingSessions = new Map();
const originalFetch = globalThis.fetch;

function historyResponse(messages: unknown[], total = messages.length) {
  return new Response(JSON.stringify({
    success: true,
    data: { messages, total, hasMore: false },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderChatSession(initialSession = selectedSession) {
  return renderHook(({ session }: { session: ProjectSession }) => {
    const sessionStore = useSessionStore();
    const statusCheckSentAtRef = useRef(new Map<string, number>());
    const lastSeqRef = useRef(new Map<string, number>());
    const sessionState = useChatSessionState({
      isActive: true,
      selectedProject,
      selectedSession: session,
      ws: null,
      sendMessage: noOp,
      processingSessions: noProcessingSessions,
      resetStreamingState: noOp,
      statusCheckSentAtRef,
      lastSeqRef,
      sessionStore,
    });

    return { sessionState, sessionStore };
  }, { initialProps: { session: initialSession } });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('publishes messages loaded into the session store to the active chat view', async () => {
  globalThis.fetch = async () => historyResponse([historyMessage]);
  const { result } = renderChatSession();

  await waitFor(() => assert.equal(result.current.sessionState.chatMessages.length, 1));

  assert.equal(result.current.sessionState.isLoadingSessionMessages, false);
  assert.equal(result.current.sessionState.chatMessages[0]?.content, 'Loaded from history');
});

test('publishes realtime messages to the active chat view', async () => {
  globalThis.fetch = async () => historyResponse([]);
  const { result } = renderChatSession();
  await waitFor(() => {
    assert.ok(result.current.sessionStore.getSessionSlot(selectedSession.id)?.fetchedAt);
  });

  act(() => {
    result.current.sessionStore.appendRealtime(selectedSession.id, {
      ...historyMessage,
      id: 'realtime-message-1',
      content: 'Delivered in realtime',
    });
  });

  assert.equal(result.current.sessionState.chatMessages.length, 1);
  assert.equal(result.current.sessionState.chatMessages[0]?.content, 'Delivered in realtime');
});

test('loads a newly selected session only once while its first request is pending', async () => {
  const sessionB: ProjectSession = { id: 'session-2', title: 'Session Two' };
  let releaseSessionB!: () => void;
  const sessionBGate = new Promise<void>((resolve) => {
    releaseSessionB = resolve;
  });
  let sessionBRequests = 0;
  const sessionBUrls: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(sessionB.id) && url.includes('/messages?')) {
      sessionBRequests += 1;
      sessionBUrls.push(url);
      await sessionBGate;
      return historyResponse([{ ...historyMessage, id: 'message-2', sessionId: sessionB.id }]);
    }
    return historyResponse([historyMessage]);
  };

  const { result, rerender } = renderChatSession();
  await waitFor(() => assert.equal(result.current.sessionState.chatMessages.length, 1));

  rerender({ session: sessionB });
  await waitFor(() => assert.equal(sessionBRequests, 1));
  releaseSessionB();
  await waitFor(() => assert.equal(result.current.sessionState.isLoadingSessionMessages, false));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(sessionBRequests, 1, JSON.stringify(sessionBUrls));
});

test('ignores history state from a session that resolves after navigation', async () => {
  const sessionB: ProjectSession = { id: 'session-2', title: 'Session Two' };
  let releaseSessionA!: () => void;
  const sessionAGate = new Promise<void>((resolve) => {
    releaseSessionA = resolve;
  });
  let sessionARequests = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/token-usage')) {
      return new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes(selectedSession.id) && url.includes('/messages?')) {
      sessionARequests += 1;
      await sessionAGate;
      return historyResponse([historyMessage], 99);
    }
    if (url.includes(sessionB.id) && url.includes('/messages?')) {
      return historyResponse([{
        ...historyMessage,
        id: 'message-2',
        sessionId: sessionB.id,
        content: 'Current session message',
      }], 1);
    }
    return historyResponse([]);
  };

  const { result, rerender } = renderChatSession();
  await waitFor(() => assert.equal(sessionARequests, 1));

  rerender({ session: sessionB });
  await waitFor(() => {
    assert.equal(result.current.sessionState.isLoadingSessionMessages, false);
    assert.equal(result.current.sessionState.chatMessages[0]?.content, 'Current session message');
    assert.equal(result.current.sessionState.totalMessages, 1);
  });

  await act(async () => {
    releaseSessionA();
    await sessionAGate;
  });

  assert.equal(result.current.sessionState.totalMessages, 1);
});

test('ignores token usage from a session that resolves after navigation', async () => {
  const sessionB: ProjectSession = { id: 'session-2', title: 'Session Two' };
  let releaseSessionATokens!: () => void;
  const sessionATokenGate = new Promise<void>((resolve) => {
    releaseSessionATokens = resolve;
  });
  let sessionATokenRequests = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(selectedSession.id) && url.includes('/token-usage')) {
      sessionATokenRequests += 1;
      await sessionATokenGate;
      return new Response(JSON.stringify({ success: true, data: { used: 99 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes(sessionB.id) && url.includes('/token-usage')) {
      return new Response(JSON.stringify({ success: true, data: { used: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes(sessionB.id) && url.includes('/messages?')) {
      return new Response(JSON.stringify({
        success: true,
        data: { messages: [], total: 0, hasMore: false, tokenUsage: { used: 1 } },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return historyResponse([]);
  };

  const { result, rerender } = renderChatSession();
  await waitFor(() => assert.equal(sessionATokenRequests, 1));

  rerender({ session: sessionB });
  await waitFor(() => assert.deepEqual(result.current.sessionState.tokenBudget, { used: 1 }));

  await act(async () => {
    releaseSessionATokens();
    await sessionATokenGate;
  });

  assert.deepEqual(result.current.sessionState.tokenBudget, { used: 1 });
});

test('leaves the loading state when the history request is aborted', async () => {
  const originalConsoleError = console.error;
  console.error = noOp;
  globalThis.fetch = async (input) => {
    if (String(input).includes('/messages?')) {
      throw new DOMException('The request timed out', 'AbortError');
    }
    return new Response(JSON.stringify({ success: true, data: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { result } = renderChatSession();
    await waitFor(() => {
      assert.equal(result.current.sessionStore.getSessionSlot(selectedSession.id)?.status, 'error');
    });
    assert.equal(result.current.sessionState.isLoadingSessionMessages, false);
    assert.deepEqual(result.current.sessionState.chatMessages, []);
  } finally {
    console.error = originalConsoleError;
  }
});
