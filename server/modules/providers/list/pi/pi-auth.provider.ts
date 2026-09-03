import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { parsePiModelsTable, runPiCommand } from './pi-models.provider.js';

const MINIMUM_VERSION = [0, 84, 2] as const;

const isSupportedVersion = (output: string): boolean => {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  for (let index = 0; index < MINIMUM_VERSION.length; index += 1) {
    if (version[index] > MINIMUM_VERSION[index]) return true;
    if (version[index] < MINIMUM_VERSION[index]) return false;
  }
  return true;
};

/** Reports Pi CLI/version readiness and whether model discovery finds usable credentials. */
export class PiProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const version = runPiCommand(['--version']);
    const installed = version.status === 0 && !version.error;
    if (!installed) {
      return {
        installed: false,
        provider: 'pi',
        authenticated: false,
        email: null,
        method: null,
        error: 'Pi CLI is not installed. Install @earendil-works/pi-coding-agent >= 0.84.2.',
      };
    }
    if (!isSupportedVersion(`${version.stdout}\n${version.stderr}`)) {
      return {
        installed: false,
        provider: 'pi',
        authenticated: false,
        email: null,
        method: null,
        error: 'Pi CLI 0.84.2 or newer is required.',
      };
    }

    const models = runPiCommand(['--list-models']);
    const authenticated = models.status === 0 && parsePiModelsTable(models.stdout).length > 0;
    return {
      installed: true,
      provider: 'pi',
      authenticated,
      email: authenticated ? 'Pi model credentials' : null,
      method: authenticated ? 'pi_cli' : null,
      error: authenticated
        ? undefined
        : 'No authenticated Pi models. Run pi and use /login, or configure a provider API key.',
    };
  }
}
