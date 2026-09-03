import type { AgentCategory } from '../../../types/types';

export type SettingsProviderCapabilities = {
  supportsMcp: boolean;
  supportsSkills: boolean;
  supportsPermissionSettings: boolean;
};

export const getVisibleAgentCategories = (
  capabilities: SettingsProviderCapabilities,
): AgentCategory[] => [
  'account',
  ...(capabilities.supportsPermissionSettings ? ['permissions' as const] : []),
  ...(capabilities.supportsMcp ? ['mcp' as const] : []),
  ...(capabilities.supportsSkills ? ['skills' as const] : []),
];
