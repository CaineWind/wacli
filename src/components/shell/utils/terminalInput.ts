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
type MouseTerminal = Pick<Terminal, 'cols' | 'rows'> & Partial<Pick<Terminal, 'element'>>;

function getMouseScreenRect(terminal: MouseTerminal, fallback?: DOMRect): DOMRect | undefined {
  // FitAddon rounds down to whole cells; container remainder is not part of the grid.
  const rect = terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : fallback;
}

const MAX_HERDR_WHEEL_STEPS_PER_EVENT = 12;
const HERDR_WHEEL_UP_BUTTON = 64;
const HERDR_WHEEL_DOWN_BUTTON = 65;

function normalizeHerdrImeWhitespace(data: unknown): string | null {
  if (typeof data !== 'string' || !/^[ \u00a0\u3000]+$/.test(data)) {
    return null;
  }

  return ' '.repeat(data.length);
}

type InstallTerminalInputSyncOptions = {
  terminal: Pick<
    Terminal,
    'cols' | 'input' | 'modes' | 'onBinary' | 'onData' | 'onWriteParsed' | 'rows' | 'write'
  >;
  container: TerminalContainer;
  focusTarget?: EventListenerTarget | null;
  visibilityTarget?: EventListenerTarget | null;
  isVisible?: () => boolean;
  shellMode?: ShellMode;
  send: (message: TerminalInputMessage) => void;
};

type CreateHerdrTouchScrollHandlerOptions = {
  terminal: MouseTerminal;
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

function encodeHerdrMouseClickInput(
  button: number,
  terminal: MouseTerminal,
  touch?: TouchPoint,
  rect?: DOMRect,
): string {
  rect = getMouseScreenRect(terminal, rect);
  const col = touch && rect
    ? clamp(
        Math.floor(((touch.clientX - rect.left) / Math.max(1, rect.width)) * terminal.cols) + 1,
        1,
        terminal.cols,
      )
    : Math.max(1, Math.ceil(terminal.cols / 2));
  const row = touch && rect
    ? clamp(
        Math.floor(((touch.clientY - rect.top) / Math.max(1, rect.height)) * terminal.rows) + 1,
        1,
        terminal.rows,
      )
    : Math.max(1, Math.ceil(terminal.rows / 2));
  return `\x1b[<${button};${col};${row}M\x1b[<${button};${col};${row}m`;
}

export function encodeHerdrLeftClickInput(
  terminal: MouseTerminal,
  touch?: TouchPoint,
  rect?: DOMRect,
): string {
  return encodeHerdrMouseClickInput(0, terminal, touch, rect);
}

export function encodeHerdrRightClickInput(
  terminal: MouseTerminal,
  touch?: TouchPoint,
  rect?: DOMRect,
): string {
  return encodeHerdrMouseClickInput(2, terminal, touch, rect);
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
    const rect = getMouseScreenRect(terminal) ?? getBoundingClientRect();
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
  let compositionCommitData: string | null = null;
  let pendingImeWhitespace: ReturnType<typeof setTimeout> | null = null;

  const clearPendingImeWhitespace = () => {
    if (pendingImeWhitespace !== null) {
      clearTimeout(pendingImeWhitespace);
      pendingImeWhitespace = null;
    }
  };

  const resetImeWhitespaceFallback = () => {
    clearPendingImeWhitespace();
    compositionCommitData = null;
  };

  const handleCompositionEnd = (event: Event) => {
    clearPendingImeWhitespace();
    compositionCommitData = (event as CompositionEvent).data ?? '';
  };

  const handleImeTextInput = (event: Event) => {
    if (compositionCommitData === null) {
      return;
    }

    const inputEvent = event as InputEvent;
    if (inputEvent.inputType && inputEvent.inputType !== 'insertText') {
      return;
    }

    const whitespace = normalizeHerdrImeWhitespace(inputEvent.data);
    if (whitespace === null) {
      if (inputEvent.data && inputEvent.data !== compositionCommitData) {
        resetImeWhitespaceFallback();
      }
      return;
    }

    if (pendingImeWhitespace !== null) {
      return;
    }

    pendingImeWhitespace = setTimeout(() => {
      pendingImeWhitespace = null;
      compositionCommitData = null;
      terminal.input(whitespace, true);
    }, 0);
  };

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

  if (shellMode === 'herdr') {
    container.addEventListener('compositionend', handleCompositionEnd, true);
    container.addEventListener('beforeinput', handleImeTextInput, true);
    container.addEventListener('input', handleImeTextInput, true);
  }

  const dataSubscription = terminal.onData((data) => {
    if (compositionCommitData !== null) {
      if (normalizeHerdrImeWhitespace(data) !== null || data !== compositionCommitData) {
        resetImeWhitespaceFallback();
      }
    }
    send({ type: 'input', data });
  });
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
    if (shellMode === 'herdr') {
      container.removeEventListener('compositionend', handleCompositionEnd, true);
      container.removeEventListener('beforeinput', handleImeTextInput, true);
      container.removeEventListener('input', handleImeTextInput, true);
    }
    resetImeWhitespaceFallback();
    dataSubscription.dispose();
    binarySubscription.dispose();
    writeParsedSubscription.dispose();
  };
}
