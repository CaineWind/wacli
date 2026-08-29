import type { Project } from '../../../types/app';
import type { ShellMode } from '../types/types';

export function resolveShellProjectPath(
  project: Project | null | undefined,
  shellMode: ShellMode | undefined,
): string | null {
  if (project) {
    return project.fullPath || project.path || '';
  }

  return shellMode === 'herdr' ? '' : null;
}
