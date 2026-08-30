import { useCallback, useEffect, useRef } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import type { UseShellRuntimeOptions, UseShellRuntimeResult } from '../types/types';
import { releaseShellSocket } from '../utils/shellClientResources';
import { resolveShellProjectPath } from '../utils/shellProject';

import { useShellConnection } from './useShellConnection';
import { useShellTerminal } from './useShellTerminal';

export function useShellRuntime({
  selectedProject,
  selectedSession,
  initialCommand,
  isPlainShell,
  minimal,
  autoConnect,
  isRestarting,
  onProcessComplete,
  onOutputRef,
  shellSessionId,
  shellMode,
}: UseShellRuntimeOptions): UseShellRuntimeResult {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const onProcessCompleteRef = useRef(onProcessComplete);
  const shellSessionIdRef = useRef(shellSessionId);
  const shellModeRef = useRef(shellMode);
  const lastSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  const connectionKey = JSON.stringify({
    projectPath: resolveShellProjectPath(selectedProject, shellMode),
    shellMode: shellMode ?? 'default',
  });

  // Keep mutable values in refs so websocket handlers always read current data.
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    onProcessCompleteRef.current = onProcessComplete;
    shellSessionIdRef.current = shellSessionId;
    shellModeRef.current = shellMode;
  }, [selectedProject, selectedSession, initialCommand, isPlainShell, onProcessComplete, shellSessionId, shellMode]);

  const closeSocket = useCallback(() => {
    releaseShellSocket(wsRef);
  }, []);

  const { isInitialized, clearTerminalScreen, disposeTerminal } = useShellTerminal({
    terminalContainerRef,
    terminalRef,
    fitAddonRef,
    wsRef,
    selectedProject,
    shellMode,
    minimal,
    isRestarting,
    closeSocket,
  });

  const { isConnected, isConnecting, connectToShell, disconnectFromShell } = useShellConnection({
    connectionKey,
    wsRef,
    terminalRef,
    fitAddonRef,
    selectedProjectRef,
    selectedSessionRef,
    initialCommandRef,
    isPlainShellRef,
    onProcessCompleteRef,
    isInitialized,
    autoConnect,
    closeSocket,
    clearTerminalScreen,
    onOutputRef,
    shellSessionIdRef,
    shellModeRef,
  });

  useEffect(() => {
    if (!isRestarting) {
      return;
    }

    disconnectFromShell({ suppressAutoConnect: true });
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, isRestarting]);

  useEffect(() => {
    if (resolveShellProjectPath(selectedProject, shellMode) !== null) {
      return;
    }

    disconnectFromShell();
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, selectedProject, shellMode]);

  useEffect(() => {
    const currentSessionId = selectedSession?.id ?? null;
    if (lastSessionIdRef.current !== currentSessionId && isInitialized) {
      disconnectFromShell();
    }

    lastSessionIdRef.current = currentSessionId;
  }, [disconnectFromShell, isInitialized, selectedSession?.id]);

  return {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    connectToShell,
    disconnectFromShell,
  };
}
