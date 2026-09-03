import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource, findTopmostGitRoot } from '@/shared/utils.js';

/** Discovers Pi-native and cross-agent skills using Pi's `/skill:<name>` syntax. */
export class PiSkillsProvider extends SkillsProvider {
  constructor() {
    super('pi');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seen = new Set<string>();
    const add = (scope: 'user' | 'project', rootDir: string) => addUniqueProviderSkillSource(
      sources,
      seen,
      { scope, rootDir, commandForSkill: (skillName) => `/skill:${skillName}` },
    );
    add('user', path.join(os.homedir(), '.pi', 'agent', 'skills'));
    add('user', path.join(os.homedir(), '.agents', 'skills'));
    add('project', path.join(workspacePath, '.pi', 'skills'));

    const repoRoot = await findTopmostGitRoot(workspacePath);
    let current = path.resolve(workspacePath);
    while (true) {
      add('project', path.join(current, '.agents', 'skills'));
      if (!repoRoot || current === path.resolve(repoRoot)) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return sources;
  }
}
