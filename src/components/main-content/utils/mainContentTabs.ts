import {
  ClipboardCheck,
  Folder,
  GitBranch,
  MessageSquare,
  MonitorPlay,
  PanelsTopLeft,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import type { AppTab } from '../../../types/app';

export type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

const HERDR_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'herdr',
  labelKey: 'tabs.herdr',
  icon: PanelsTopLeft,
};

const PROJECT_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  HERDR_TAB,
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'git', labelKey: 'tabs.git', icon: GitBranch },
];

const BROWSER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};

const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

type BuiltInTabOptions = {
  hasSelectedProject: boolean;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
};

export function getBuiltInTabs({
  hasSelectedProject,
  shouldShowTasksTab,
  shouldShowBrowserTab,
}: BuiltInTabOptions): BuiltInTab[] {
  if (!hasSelectedProject) {
    return [HERDR_TAB];
  }

  return [
    ...PROJECT_TABS,
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
  ];
}

export function shouldShowPluginTabs(hasSelectedProject: boolean): boolean {
  return hasSelectedProject;
}
