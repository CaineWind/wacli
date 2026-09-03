import { createContext, useContext } from 'react';

export type PwaInstallContextValue = {
  automaticPromptVisible: boolean;
  canInstall: boolean;
  dismissAutomaticPrompt: () => void;
  install: () => Promise<'accepted' | 'dismissed' | null>;
  isInstalled: boolean;
  recordAutomaticPromptShown: () => void;
};

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error('usePwaInstall must be used within PwaInstallProvider');
  return context;
}
