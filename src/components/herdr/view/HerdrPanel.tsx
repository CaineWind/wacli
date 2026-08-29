import { useMemo } from 'react';

import type { Project } from '../../../types/app';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { createHerdrShellProps, getHerdrClientSessionId } from '../utils/herdrShell';

type HerdrPanelProps = {
  project: Project;
  isActive: boolean;
};

export default function HerdrPanel({ project, isActive }: HerdrPanelProps) {
  const shellSessionId = useMemo(
    () => getHerdrClientSessionId(project.projectId),
    [project.projectId],
  );
  return <StandaloneShell {...createHerdrShellProps(project, isActive, shellSessionId)} />;
}
