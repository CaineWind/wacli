export type PwaPromptKind = 'update' | 'install' | 'offline';

type PwaPromptState = {
  installAvailable: boolean;
  installDismissed: boolean;
  needRefresh: boolean;
  offlineDismissed: boolean;
  offlineReady: boolean;
};

export function resolvePwaPromptKind(state: PwaPromptState): PwaPromptKind | null {
  if (state.needRefresh) return 'update';
  if (state.installAvailable && !state.installDismissed) return 'install';
  if (state.offlineReady && !state.offlineDismissed) return 'offline';
  return null;
}
