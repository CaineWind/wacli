import type {
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';

import { PiProviderAuth } from './pi-auth.provider.js';
import { PiMcpProvider } from './pi-mcp.provider.js';
import { PiProviderModels } from './pi-models.provider.js';
import { piRuntime } from './pi-runtime.provider.js';
import { PiSessionSynchronizer } from './pi-session-synchronizer.provider.js';
import { PiSessionsProvider } from './pi-sessions.provider.js';
import { PiSkillsProvider } from './pi-skills.provider.js';

/** Registry wrapper that composes all seven Pi provider facets. */
export class PiProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = piRuntime;
  readonly models: IProviderModels = new PiProviderModels();
  readonly mcp: IProviderMcp = new PiMcpProvider();
  readonly auth: IProviderAuth = new PiProviderAuth();
  readonly skills: IProviderSkills = new PiSkillsProvider();
  readonly sessions: IProviderSessions = new PiSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new PiSessionSynchronizer();

  constructor() {
    super('pi');
  }
}
