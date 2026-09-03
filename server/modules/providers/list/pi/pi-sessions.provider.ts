import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import { parseFilesInputTag } from '@/shared/image-attachments.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const textFromContent = (content: unknown, type = 'text'): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    const record = readObjectRecord(part);
    return record?.type === type ? [readOptionalString(record.text) ?? ''] : [];
  }).join('');
};

const formatToolResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  const record = readObjectRecord(result);
  const content = record?.content;
  const text = textFromContent(content);
  if (text) return text;
  try { return JSON.stringify(content ?? result, null, 2); } catch { return String(result ?? ''); }
};

const tokenBudgetFromEntries = (entries: AnyRecord[]): AnyRecord | undefined => {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const entry of entries) {
    const usage = readObjectRecord(readObjectRecord(entry.message)?.usage) ?? readObjectRecord(entry.usage);
    if (!usage) continue;
    input += Number(usage.input ?? 0);
    output += Number(usage.output ?? 0);
    cacheRead += Number(usage.cacheRead ?? 0);
    cacheWrite += Number(usage.cacheWrite ?? 0);
  }
  const used = input + output + cacheRead + cacheWrite;
  return used > 0 ? {
    used,
    inputTokens: input + cacheRead,
    outputTokens: output,
    breakdown: { input: input + cacheRead, output },
  } : undefined;
};

const activeBranch = (entries: AnyRecord[]): AnyRecord[] => {
  const withIds = entries.filter((entry) => readOptionalString(entry.id));
  if (withIds.length === 0 || !withIds.some((entry) => readOptionalString(entry.parentId))) return entries;
  const byId = new Map(withIds.map((entry) => [String(entry.id), entry]));
  const branch: AnyRecord[] = [];
  let current: AnyRecord | undefined = withIds[withIds.length - 1];
  const seen = new Set<string>();
  while (current) {
    const id = readOptionalString(current.id);
    if (!id || seen.has(id)) break;
    seen.add(id);
    branch.push(current);
    const parentId = readOptionalString(current.parentId);
    current = parentId ? byId.get(parentId) : undefined;
  }
  return branch.reverse();
};

/** Normalizes Pi RPC events and JSONL history into WindCli messages. */
export class PiSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) return [];
    const type = readOptionalString(raw.type);
    const base = { provider: 'pi' as const, sessionId, timestamp: normalizeProviderTimestamp(raw.timestamp) };
    if (type === 'message_update') {
      const update = readObjectRecord(raw.assistantMessageEvent) ?? readObjectRecord(raw.event);
      const delta = readOptionalString(update?.delta);
      if (!delta) return [];
      if (update?.type === 'text_delta') return [createNormalizedMessage({ ...base, kind: 'stream_delta', content: delta })];
      if (update?.type === 'thinking_delta') return [createNormalizedMessage({ ...base, kind: 'thinking', content: delta })];
    }
    if (type === 'tool_execution_start') {
      return [createNormalizedMessage({
        ...base,
        kind: 'tool_use',
        toolId: readOptionalString(raw.toolCallId) ?? generateMessageId('pi-tool'),
        toolName: readOptionalString(raw.toolName) ?? 'Tool',
        toolInput: raw.args ?? {},
      })];
    }
    if (type === 'tool_execution_end') {
      const toolId = readOptionalString(raw.toolCallId) ?? generateMessageId('pi-tool');
      return [createNormalizedMessage({
        ...base,
        kind: 'tool_result',
        toolId,
        toolName: readOptionalString(raw.toolName) ?? 'Tool',
        toolResult: { content: formatToolResult(raw.result), isError: Boolean(raw.isError) },
      })];
    }
    if (type === 'agent_end' && raw.willRetry !== true) {
      return [createNormalizedMessage({ ...base, kind: 'stream_end' })];
    }
    if (type === 'error' || type === 'fault') {
      return [createNormalizedMessage({
        ...base,
        kind: 'error',
        content: readOptionalString(raw.message) ?? readOptionalString(raw.error) ?? 'Unknown Pi error',
      })];
    }
    return [];
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const row = sessionsDb.getSessionById(sessionId);
    if (!row?.jsonl_path) return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    try {
      const entries = (await readFile(row.jsonl_path, 'utf8')).split(/\r?\n/).flatMap((line) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as AnyRecord]; } catch { return []; }
      });
      const branch = activeBranch(entries.filter((entry) => entry.type !== 'session'));
      const messages = this.normalizeHistory(branch, sessionId);
      const offset = Math.max(0, options.offset ?? 0);
      const limit = options.limit === undefined ? null : options.limit === null ? null : Math.max(0, options.limit);
      const { page, hasMore } = sliceTailPage(messages, limit, offset);
      return {
        messages: page,
        total: messages.length,
        hasMore,
        offset,
        limit,
        tokenUsage: tokenBudgetFromEntries(branch),
      };
    } catch {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  private normalizeHistory(entries: AnyRecord[], sessionId: string): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];
    const tools = new Map<string, NormalizedMessage>();
    for (const entry of entries) {
      const id = readOptionalString(entry.id) ?? generateMessageId('pi-history');
      const timestamp = normalizeProviderTimestamp(entry.timestamp);
      if (entry.type === 'message') {
        const message = readObjectRecord(entry.message);
        const role = readOptionalString(message?.role);
        if (role === 'user') {
          const parsed = parseFilesInputTag(textFromContent(message?.content));
          messages.push(createNormalizedMessage({
            id, provider: 'pi', sessionId, timestamp, kind: 'text', role: 'user',
            content: parsed.text, ...(parsed.attachments.length ? { files: parsed.attachments } : {}),
          }));
        } else if (role === 'assistant') {
          const content = Array.isArray(message?.content) ? message.content : [];
          content.forEach((part, index) => {
            const block = readObjectRecord(part);
            if (!block) return;
            const blockId = `${id}:${index}`;
            if (block.type === 'text' || block.type === 'thinking') {
              const text = readOptionalString(block.text);
              if (text) messages.push(createNormalizedMessage({
                id: blockId, provider: 'pi', sessionId, timestamp,
                kind: block.type === 'thinking' ? 'thinking' : 'text', role: 'assistant', content: text,
              }));
            } else if (block.type === 'toolCall' || block.type === 'tool_use') {
              const toolId = readOptionalString(block.id) ?? blockId;
              const normalized = createNormalizedMessage({
                id: blockId, provider: 'pi', sessionId, timestamp, kind: 'tool_use',
                toolId, toolName: readOptionalString(block.name) ?? 'Tool', toolInput: block.arguments ?? block.input ?? {},
              });
              tools.set(toolId, normalized);
              messages.push(normalized);
            }
          });
        } else if (role === 'toolResult' || role === 'tool_result') {
          const toolId = readOptionalString(message?.toolCallId) ?? readOptionalString(message?.tool_use_id);
          const result = { content: formatToolResult(message), isError: Boolean(message?.isError ?? message?.is_error) };
          const tool = toolId ? tools.get(toolId) : undefined;
          if (tool) tool.toolResult = result;
          else messages.push(createNormalizedMessage({
            id, provider: 'pi', sessionId, timestamp, kind: 'tool_result', toolId, toolResult: result,
          }));
        }
      } else if (entry.type === 'compaction') {
        const content = readOptionalString(entry.summary);
        if (content) messages.push(createNormalizedMessage({
          id, provider: 'pi', sessionId, timestamp, kind: 'text', role: 'assistant', content, isCompactSummary: true,
        }));
      } else if (entry.type === 'custom_message' && entry.display !== false) {
        const content = textFromContent(entry.content);
        if (content) messages.push(createNormalizedMessage({
          id, provider: 'pi', sessionId, timestamp, kind: 'text', role: 'assistant', content,
        }));
      }
    }
    return messages;
  }
}
