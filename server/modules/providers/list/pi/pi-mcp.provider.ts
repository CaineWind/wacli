import type { IProviderMcp } from '@/shared/interfaces.js';
import type { LLMProvider, McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const unsupported = (): never => {
  throw new AppError('Pi does not provide native MCP configuration.', {
    code: 'MCP_NOT_SUPPORTED',
    statusCode: 400,
  });
};

/** Explicit no-op MCP facet required by the provider contract. */
export class PiMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    return unsupported();
  }

  async removeServer(_input: {
    name: string;
    scope?: McpScope;
    workspacePath?: string;
  }): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    return unsupported();
  }
}
