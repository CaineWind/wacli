import { useMemo } from 'react';

import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { createHerdrShellProps, getHerdrClientSessionId } from '../utils/herdrShell';

type HerdrPanelProps = {
  isActive: boolean;
};

export default function HerdrPanel({ isActive }: HerdrPanelProps) {
  const shellSessionId = useMemo(() => getHerdrClientSessionId(), []);
  return <StandaloneShell {...createHerdrShellProps(isActive, shellSessionId)} />;
}
