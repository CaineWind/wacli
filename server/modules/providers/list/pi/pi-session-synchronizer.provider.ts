import fsSync from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import {
  normalizeProviderTimestamp,
  normalizeSessionName,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const PI_SETTINGS_PATH = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
const DEFAULT_PI_SESSION_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');

const expandHome = (value: string): string => {
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.isAbsolute(value) ? value : path.resolve(os.homedir(), value);
};

/** Resolves Pi's transcript root for the synchronizer and filesystem watcher. */
export function getPiSessionDirectory(): string {
  const environmentDirectory = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (environmentDirectory) return expandHome(environmentDirectory);
  try {
    const settings = readObjectRecord(JSON.parse(fsSync.readFileSync(PI_SETTINGS_PATH, 'utf8')));
    const configured = readOptionalString(settings?.sessionDir);
    if (configured) return expandHome(configured);
  } catch {
    // Missing or partially-written settings use Pi's standard session root.
  }
  return DEFAULT_PI_SESSION_DIR;
}

const listJsonlFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
    }));
  };
  await visit(root);
  return files;
};

const firstUserText = (entries: AnyRecord[]): string | undefined => {
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = readObjectRecord(entry.message);
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim();
    if (Array.isArray(message.content)) {
      const text = message.content.flatMap((part) => {
        const block = readObjectRecord(part);
        return block?.type === 'text' ? [readOptionalString(block.text) ?? ''] : [];
      }).join('').trim();
      if (text) return text;
    }
  }
  return undefined;
};

/** Indexes Pi's JSONL transcript tree into WindCli's stable sessions table. */
export class PiSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(since?: Date): Promise<number> {
    const files = await listJsonlFiles(getPiSessionDirectory());
    let processed = 0;
    for (const filePath of files) {
      if (since) {
        try {
          if ((await stat(filePath)).mtime < since) continue;
        } catch {
          continue;
        }
      }
      if (await this.synchronizeFile(filePath)) processed += 1;
    }
    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) return null;
    try {
      const entries = (await readFile(filePath, 'utf8')).split(/\r?\n/).flatMap((line) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as AnyRecord]; } catch { return []; }
      });
      const header = entries.find((entry) => entry.type === 'session');
      const sessionId = readOptionalString(header?.id);
      const projectPath = readOptionalString(header?.cwd);
      if (!sessionId || !projectPath) return null;

      const sessionInfo = [...entries].reverse().find((entry) => entry.type === 'session_info');
      const title = readOptionalString(sessionInfo?.name)
        ?? readOptionalString(sessionInfo?.title)
        ?? firstUserText(entries);
      const fileStats = await stat(filePath);
      const createdAt = normalizeProviderTimestamp(header?.timestamp ?? fileStats.birthtime);
      const updatedAt = normalizeProviderTimestamp(
        [...entries].reverse().find((entry) => readOptionalString(entry.timestamp))?.timestamp ?? fileStats.mtime,
      );
      const pending = sessionsDb.getSessionByProviderSessionId(sessionId)
        ?? sessionsDb.getSessionById(sessionId)
        ?? sessionsDb.findLatestPendingAppSession('pi', projectPath);
      if (pending && !pending.provider_session_id) {
        sessionsDb.assignProviderSessionId(pending.session_id, sessionId);
      }
      const existing = sessionsDb.getSessionByProviderSessionId(sessionId) ?? sessionsDb.getSessionById(sessionId);
      const fallback = 'Untitled Pi Session';
      return sessionsDb.createSession(
        sessionId,
        'pi',
        projectPath,
        normalizeSessionName(existing?.custom_name || title, fallback),
        createdAt,
        updatedAt,
        filePath,
      );
    } catch (error) {
      console.warn(`[PiProvider] Failed to synchronize ${filePath}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
