import { useEffect, useMemo, useState } from 'react';

import { authenticatedFetch } from '../../../../../utils/api';
import type { AgentCategory, AgentProvider } from '../../../types/types';

import type { AgentContext, AgentsSettingsTabProps } from './types';
import {
  getVisibleAgentCategories,
  type SettingsProviderCapabilities,
} from './agentCategories';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from './sections/AgentCategoryTabsSection';
import AgentSelectorSection from './sections/AgentSelectorSection';

const FALLBACK_CAPABILITIES: Record<AgentProvider, SettingsProviderCapabilities> = {
  claude: { supportsMcp: true, supportsSkills: true, supportsPermissionSettings: true },
  cursor: { supportsMcp: true, supportsSkills: true, supportsPermissionSettings: true },
  codex: { supportsMcp: true, supportsSkills: true, supportsPermissionSettings: true },
  opencode: { supportsMcp: true, supportsSkills: false, supportsPermissionSettings: false },
  pi: { supportsMcp: false, supportsSkills: true, supportsPermissionSettings: false },
};

export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  const [capabilities, setCapabilities] = useState(FALLBACK_CAPABILITIES);
  const visibleCategories = useMemo(
    () => getVisibleAgentCategories(capabilities[selectedAgent]),
    [capabilities, selectedAgent],
  );

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    return ['claude', 'cursor', 'codex', 'opencode', 'pi'];
  }, []);

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    claude: {
      authStatus: providerAuthStatus.claude,
      onLogin: () => onProviderLogin('claude'),
    },
    cursor: {
      authStatus: providerAuthStatus.cursor,
      onLogin: () => onProviderLogin('cursor'),
    },
    codex: {
      authStatus: providerAuthStatus.codex,
      onLogin: () => onProviderLogin('codex'),
    },
    opencode: {
      authStatus: providerAuthStatus.opencode,
      onLogin: () => onProviderLogin('opencode'),
    },
    pi: {
      authStatus: providerAuthStatus.pi,
      onLogin: () => onProviderLogin('pi'),
    },
  }), [
    onProviderLogin,
    providerAuthStatus.claude,
    providerAuthStatus.codex,
    providerAuthStatus.cursor,
    providerAuthStatus.opencode,
    providerAuthStatus.pi,
  ]);

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch('/api/providers/capabilities')
      .then((response) => response.json())
      .then((body: { data?: { providers?: Array<{ provider: AgentProvider } & SettingsProviderCapabilities> } }) => {
        if (cancelled || !body.data?.providers) return;
        setCapabilities(body.data.providers.reduce((result, entry) => ({
          ...result,
          [entry.provider]: {
            supportsMcp: entry.supportsMcp,
            supportsSkills: entry.supportsSkills,
            supportsPermissionSettings: entry.supportsPermissionSettings,
          },
        }), FALLBACK_CAPABILITIES));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(visibleCategories[0] ?? 'account');
    }
  }, [selectedCategory, visibleCategories]);

  return (
    <div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] min-w-0 flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
      <AgentSelectorSection
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          categories={visibleCategories}
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          projects={projects}
        />
      </div>
    </div>
  );
}
