import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  hasSeenPwaInstallPrompt,
  markPwaInstallPromptSeen,
} from '../components/app/pwaInstallState';

import { PwaInstallContext, type PwaInstallContextValue } from './PwaInstallContext';

type InstallChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();
  const [automaticPromptVisible, setAutomaticPromptVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(detectInstalled);

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const updateInstalled = () => setIsInstalled(detectInstalled());
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (!hasSeenPwaInstallPrompt(window.localStorage)) {
        setAutomaticPromptVisible(true);
      }
    };
    const handleInstalled = () => {
      setInstallPrompt(undefined);
      setAutomaticPromptVisible(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    displayMode.addEventListener('change', updateInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      displayMode.removeEventListener('change', updateInstalled);
    };
  }, []);

  const dismissAutomaticPrompt = useCallback(() => {
    setAutomaticPromptVisible(false);
  }, []);

  const recordAutomaticPromptShown = useCallback(() => {
    markPwaInstallPromptSeen(window.localStorage);
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return null;

    setAutomaticPromptVisible(false);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(undefined);
    if (choice.outcome === 'accepted') setIsInstalled(true);
    return choice.outcome;
  }, [installPrompt]);

  const value = useMemo<PwaInstallContextValue>(() => ({
    automaticPromptVisible,
    canInstall: Boolean(installPrompt),
    dismissAutomaticPrompt,
    install,
    isInstalled,
    recordAutomaticPromptShown,
  }), [
    automaticPromptVisible,
    dismissAutomaticPrompt,
    install,
    installPrompt,
    isInstalled,
    recordAutomaticPromptShown,
  ]);

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}
