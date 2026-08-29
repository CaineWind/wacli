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
type TerminalContainer = Pick<
  HTMLElement,
  'addEventListener' | 'getBoundingClientRect' | 'removeEventListener'
>;

type TouchPoint = Pick<Touch, 'clientX' | 'clientY'>;

const MAX_HERDR_WHEEL_STEPS_PER_EVENT = 12;
const HERDR_WHEEL_UP_BUTTON = 64;
const HERDR_WHEEL_DOWN_BUTTON = 65;

type InstallTerminalInputSyncOptions = {
  terminal: Pick<
    Terminal,
    'cols' | 'modes' | 'onBinary' | 'onData' | 'onWriteParsed' | 'rows' | 'write'
  >;
  container: TerminalContainer;
  focusTarget?: EventListenerTarget | null;
  visibilityTarget?: EventListenerTarget | null;
  isVisible?: () => boolean;
  shellMode?: ShellMode;
  send: (message: TerminalInputMessage) => void;
};

type CreateHerdrTouchScrollHandlerOptions = {
  terminal: Pick<Terminal, 'cols' | 'rows'>;
  getBoundingClientRect: () => DOMRect;
  send: (message: ShellInputMessage) => void;
};

export type HerdrTouchScrollHandler = ((
  deltaY: number,
  touch: TouchPoint,
) => boolean) & {
  reset: () => void;
};

export function encodeTerminalBinaryInput(data: string): string {
  return btoa(data);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function encodeHerdrWheelInput(
  steps: number,
  touch: TouchPoint,
  rect: DOMRect,
  cols: number,
  rows: number,
): string {
  const col = clamp(
    Math.floor(((touch.clientX - rect.left) / Math.max(1, rect.width)) * cols) + 1,
    1,
    cols,
  );
  const row = clamp(
    Math.floor(((touch.clientY - rect.top) / Math.max(1, rect.height)) * rows) + 1,
    1,
    rows,
  );
  const button = steps > 0 ? HERDR_WHEEL_DOWN_BUTTON : HERDR_WHEEL_UP_BUTTON;
  return `\x1b[<${button};${col};${row}M`.repeat(Math.abs(steps));
}

export function createHerdrTouchScrollHandler({
  terminal,
  getBoundingClientRect,
  send,
}: CreateHerdrTouchScrollHandlerOptions): HerdrTouchScrollHandler {
  let remainder = 0;

  const handleTouchScroll = ((deltaY, touch) => {
    remainder += deltaY;
    const rect = getBoundingClientRect();
    const rowHeight = rect.height / Math.max(1, terminal.rows);
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      return true;
    }

    const requestedSteps = Math.trunc(remainder / rowHeight);
    if (requestedSteps === 0) {
      return true;
    }

    const steps = clamp(
      requestedSteps,
      -MAX_HERDR_WHEEL_STEPS_PER_EVENT,
      MAX_HERDR_WHEEL_STEPS_PER_EVENT,
    );
    remainder -= steps * rowHeight;
    send({
      type: 'input',
      data: encodeHerdrWheelInput(
        steps,
        touch,
        rect,
        Math.max(1, terminal.cols),
        Math.max(1, terminal.rows),
      ),
    });
    return true;
  }) as HerdrTouchScrollHandler;

  handleTouchScroll.reset = () => {
    remainder = 0;
  };
  return handleTouchScroll;
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
