import type { IClipboardProvider } from '@xterm/addon-clipboard';

import { copyTextToClipboard } from '../../../utils/clipboard';

type CreateOscClipboardProviderOptions = {
  copyText?: (text: string) => Promise<boolean>;
  onCopyFailed: (text: string) => void;
};

export function createOscClipboardProvider({
  copyText = copyTextToClipboard,
  onCopyFailed,
}: CreateOscClipboardProviderOptions): IClipboardProvider {
  return {
    readText: async (selection) => {
      if (selection !== 'c') {
        return '';
      }

      try {
        return (await navigator.clipboard?.readText?.()) || '';
      } catch {
        return '';
      }
    },
    writeText: async (selection, text) => {
      if (selection !== 'c') {
        return;
      }

      let copied = false;
      try {
        copied = await copyText(text);
      } catch {
        copied = false;
      }

      if (!copied && text) {
        onCopyFailed(text);
      }
    },
  };
}
