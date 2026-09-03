import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderCurrentActiveModel, ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

type PiCommandResult = { status: number | null; stdout: string; stderr: string; error?: Error };

/** Used by Pi auth and model facets so both execute the CLI without a shell. */
export function runPiCommand(args: string[]): PiCommandResult {
  const result = spawn.sync('pi', args, {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error,
  };
}

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, '');

/** Parses Pi's fixed-column `--list-models` table; exported for focused provider tests. */
export function parsePiModelsTable(output: string): ProviderModelOption[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /provider/i.test(line) && /model/i.test(line));
  if (headerIndex < 0) return [];

  const header = lines[headerIndex];
  const matches = [...header.matchAll(/\S+/g)];
  const columns = matches.map((match, index) => ({
    name: normalizeHeader(match[0]),
    start: match.index ?? 0,
    end: matches[index + 1]?.index ?? Number.POSITIVE_INFINITY,
  }));
  const providerColumn = columns.find((column) => column.name === 'provider');
  const modelColumn = columns.find((column) => column.name === 'model' || column.name === 'modelid');
  const thinkingColumn = columns.find((column) => column.name === 'thinking');
  const imageColumn = columns.find((column) => column.name === 'images' || column.name === 'image');
  if (!providerColumn || !modelColumn) return [];

  const readColumn = (line: string, column: typeof columns[number]): string => (
    line.slice(column.start, Number.isFinite(column.end) ? column.end : undefined).trim()
  );

  return lines.slice(headerIndex + 1).flatMap((line) => {
    if (/^-+$/.test(line.replace(/\s/g, ''))) return [];
    const provider = readColumn(line, providerColumn);
    const model = readColumn(line, modelColumn);
    if (!provider || !model) return [];
    const value = `${provider}/${model}`;
    const supportsThinking = thinkingColumn
      ? /^(yes|true|supported)$/i.test(readColumn(line, thinkingColumn))
      : false;
    const supportsImages = imageColumn
      ? /^(yes|true|supported)$/i.test(readColumn(line, imageColumn))
      : false;
    return [{
      value,
      label: model,
      description: `${provider}${supportsImages ? ' · Images' : ''}`,
      ...(supportsThinking ? {
        effort: {
          default: 'medium',
          values: THINKING_LEVELS.map((level) => ({ value: level })),
        },
      } : {}),
    }];
  });
}

async function readPiDefaultModel(): Promise<string | null> {
  try {
    const settings = readObjectRecord(JSON.parse(await readFile(
      path.join(os.homedir(), '.pi', 'agent', 'settings.json'),
      'utf8',
    )));
    const provider = readOptionalString(settings?.defaultProvider);
    const model = readOptionalString(settings?.defaultModel);
    return provider && model ? `${provider}/${model}` : null;
  } catch {
    return null;
  }
}

/** Dynamic Pi catalog adapter. Discovery is intentionally uncached because auth changes alter the list. */
export class PiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const result = runPiCommand(['--list-models']);
    const options = result.status === 0 && !result.error ? parsePiModelsTable(result.stdout) : [];
    const configuredDefault = await readPiDefaultModel();
    const fallback = options[0]?.value ?? configuredDefault ?? '';
    return {
      OPTIONS: options,
      DEFAULT: configuredDefault && options.some((option) => option.value === configuredDefault)
        ? configuredDefault
        : fallback,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const models = await this.getSupportedModels();
    return { model: models.DEFAULT };
  }
}
