import type { Terminal } from '@xterm/xterm';

import { HERDR_MOUSE_TRACKING_SEQUENCE } from '../constants/constants';
import type {
  ShellBinaryInputMessage,
  ShellInputMessage,
  ShellMode,
} from '../types/types';

type TerminalInputMessage = ShellInputMessage | ShellBinaryInputMessage;

type InstallTerminalInputSyncOptions = {
  terminal: Pick<Terminal, 'modes' | 'onBinary' | 'onData' | 'onWriteParsed' | 'write'>;
  container: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>;
  shellMode?: ShellMode;
  send: (message: TerminalInputMessage) => void;
};

export function encodeTerminalBinaryInput(data: string): string {
  return btoa(data);
}

export function installTerminalInputSync({
  terminal,
  container,
  shellMode,
  send,
}: InstallTerminalInputSyncOptions): () => void {
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

  container.addEventListener('contextmenu', handleContextMenu);

  const dataSubscription = terminal.onData((data) => send({ type: 'input', data }));
  const binarySubscription = terminal.onBinary((data) => {
    send({ type: 'input_binary', data: encodeTerminalBinaryInput(data) });
  });
  const writeParsedSubscription = terminal.onWriteParsed(ensureHerdrMouseTracking);

  ensureHerdrMouseTracking();

  return () => {
    container.removeEventListener('contextmenu', handleContextMenu);
    dataSubscription.dispose();
    binarySubscription.dispose();
    writeParsedSubscription.dispose();
  };
}
