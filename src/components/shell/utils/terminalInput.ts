import type { Terminal } from '@xterm/xterm';

import { HERDR_MOUSE_TRACKING_SEQUENCE } from '../constants/constants';
import type {
  ShellBinaryInputMessage,
  ShellInputMessage,
  ShellMode,
  ShellViewportClaimMessage,
} from '../types/types';

type TerminalInputMessage =
  | ShellInputMessage
  | ShellBinaryInputMessage
  | ShellViewportClaimMessage;

type EventListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type InstallTerminalInputSyncOptions = {
  terminal: Pick<
    Terminal,
    'cols' | 'modes' | 'onBinary' | 'onData' | 'onWriteParsed' | 'rows' | 'write'
  >;
  container: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>;
  focusTarget?: EventListenerTarget | null;
  visibilityTarget?: EventListenerTarget | null;
  isVisible?: () => boolean;
  shellMode?: ShellMode;
  send: (message: TerminalInputMessage) => void;
};

export function encodeTerminalBinaryInput(data: string): string {
  return btoa(data);
}

export function installTerminalInputSync({
  terminal,
  container,
  focusTarget = typeof window === 'undefined' ? null : window,
  visibilityTarget = typeof document === 'undefined' ? null : document,
  isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible',
  shellMode,
  send,
}: InstallTerminalInputSyncOptions): () => void {
  let hasClaimedHerdrViewport = false;

  const ensureHerdrMouseTracking = () => {
    if (shellMode === 'herdr' && terminal.modes.mouseTrackingMode === 'none') {
      terminal.write(HERDR_MOUSE_TRACKING_SEQUENCE);
    }
  };

  const handleContextMenu = (event: Event) => {
    if (shellMode === 'herdr') {
      event.preventDefault();
    }
  };

  const claimHerdrViewport = () => {
    if (shellMode !== 'herdr' || hasClaimedHerdrViewport) {
      return;
    }

    hasClaimedHerdrViewport = true;
    send({
      type: 'viewport_claim',
      cols: terminal.cols,
      rows: terminal.rows,
    });
  };

  const releaseHerdrViewportClaim = () => {
    hasClaimedHerdrViewport = false;
  };

  const claimVisibleHerdrViewport = () => {
    if (isVisible()) {
      claimHerdrViewport();
    } else {
      releaseHerdrViewportClaim();
    }
  };

  container.addEventListener('contextmenu', handleContextMenu);
  container.addEventListener('pointerdown', claimHerdrViewport, true);
  container.addEventListener('keydown', claimHerdrViewport, true);
  focusTarget?.addEventListener('focus', claimHerdrViewport);
  focusTarget?.addEventListener('blur', releaseHerdrViewportClaim);
  visibilityTarget?.addEventListener('visibilitychange', claimVisibleHerdrViewport);

  const dataSubscription = terminal.onData((data) => send({ type: 'input', data }));
  const binarySubscription = terminal.onBinary((data) => {
    send({ type: 'input_binary', data: encodeTerminalBinaryInput(data) });
  });
  const writeParsedSubscription = terminal.onWriteParsed(ensureHerdrMouseTracking);

  ensureHerdrMouseTracking();

  return () => {
    container.removeEventListener('contextmenu', handleContextMenu);
    container.removeEventListener('pointerdown', claimHerdrViewport, true);
    container.removeEventListener('keydown', claimHerdrViewport, true);
    focusTarget?.removeEventListener('focus', claimHerdrViewport);
    focusTarget?.removeEventListener('blur', releaseHerdrViewportClaim);
    visibilityTarget?.removeEventListener('visibilitychange', claimVisibleHerdrViewport);
    dataSubscription.dispose();
    binarySubscription.dispose();
    writeParsedSubscription.dispose();
  };
}
