import type { ReactNode } from 'react';

type MainContentHeaderRowProps = {
  hasSelectedProject: boolean;
  children: ReactNode;
};

export default function MainContentHeaderRow({
  hasSelectedProject,
  children,
}: MainContentHeaderRowProps) {
  const className = hasSelectedProject
    ? 'flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3'
    : 'flex min-w-0 flex-row items-center justify-between gap-2 sm:gap-3';

  return <div className={className}>{children}</div>;
}
