import { useEffect, useState } from 'react';
import { Download, RefreshCw, Wifi, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { usePwaInstall } from '../../contexts/PwaInstallContext';

import { resolvePwaPromptKind } from './pwaLifecycleState';

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export default function PwaLifecycle() {
  const { t } = useTranslation('common');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const {
    automaticPromptVisible,
    canInstall,
    dismissAutomaticPrompt,
    install,
    recordAutomaticPromptShown,
  } = usePwaInstall();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_scriptUrl, registeredWorker) => setRegistration(registeredWorker),
    onRegisterError: (error) => console.error('Service worker registration failed:', error),
  });

  useEffect(() => {
    if (!registration) return undefined;

    const interval = window.setInterval(() => {
      if (navigator.onLine) void registration.update();
    }, UPDATE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [registration]);

  useEffect(() => {
    if (!offlineReady) return undefined;
    const timeout = window.setTimeout(() => setOfflineDismissed(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [offlineReady]);

  const promptKind = resolvePwaPromptKind({
    installAvailable: canInstall && automaticPromptVisible,
    installDismissed: false,
    needRefresh,
    offlineDismissed,
    offlineReady,
  });

  useEffect(() => {
    if (promptKind === 'install') recordAutomaticPromptShown();
  }, [promptKind, recordAutomaticPromptShown]);

  if (!promptKind) return null;

  const content = {
    update: {
      icon: RefreshCw,
      message: t('pwa.updateReady'),
      action: t('pwa.reload'),
    },
    install: {
      icon: Download,
      message: t('pwa.installAvailable'),
      action: t('pwa.install'),
    },
    offline: {
      icon: Wifi,
      message: t('pwa.offlineReady'),
      action: null,
    },
  }[promptKind];
  const Icon = content.icon;

  const dismiss = () => {
    if (promptKind === 'update') setNeedRefresh(false);
    if (promptKind === 'install') dismissAutomaticPrompt();
    if (promptKind === 'offline') {
      setOfflineDismissed(true);
      setOfflineReady(false);
    }
  };

  const runAction = async () => {
    if (promptKind === 'update') {
      await updateServiceWorker(true);
      return;
    }
    if (promptKind === 'install') await install();
  };

  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-[100] mx-auto flex min-h-12 max-w-xl items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground shadow-lg"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-sm">{content.message}</span>
      {content.action && (
        <button
          type="button"
          className="flex-shrink-0 text-sm font-medium text-primary hover:underline"
          onClick={() => void runAction()}
        >
          {content.action}
        </button>
      )}
      <button
        type="button"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={dismiss}
        aria-label={t('pwa.dismiss')}
        title={t('pwa.dismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
