export const PWA_INSTALL_PROMPT_SEEN_KEY = 'windcli:pwa-install-prompt-seen';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export function hasSeenPwaInstallPrompt(storage: StorageReader): boolean {
  try {
    return storage.getItem(PWA_INSTALL_PROMPT_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markPwaInstallPromptSeen(storage: StorageWriter): void {
  try {
    storage.setItem(PWA_INSTALL_PROMPT_SEEN_KEY, 'true');
  } catch {
    // Storage can be unavailable in private browsing or hardened browsers.
  }
}
