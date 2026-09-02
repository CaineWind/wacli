#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sdkEntryPath = path.join(
  scriptDirectory,
  '..',
  'node_modules',
  '@openai',
  'codex-sdk',
  'dist',
  'index.js',
);

const spawnPattern = /(const child = spawn\(this\.executablePath, commandArgs, \{\r?\n\s*env,\r?\n)(\s*signal: args\.signal)/;
const patchedSpawnPattern = /const child = spawn\(this\.executablePath, commandArgs, \{[\s\S]*?windowsHide:\s*true/;

export function addWindowsHideToCodexSdk(source) {
  if (patchedSpawnPattern.test(source)) {
    return { source, status: 'already-patched' };
  }

  if (!spawnPattern.test(source)) {
    return { source, status: 'unsupported' };
  }

  return {
    source: source.replace(spawnPattern, '$1      windowsHide: true,\n$2'),
    status: 'patched',
  };
}

export async function fixCodexSdkWindowsHide({
  platform = process.platform,
  entryPath = sdkEntryPath,
} = {}) {
  if (platform !== 'win32') {
    return 'skipped';
  }

  try {
    const originalSource = await fs.readFile(entryPath, 'utf8');
    const result = addWindowsHideToCodexSdk(originalSource);

    if (result.status === 'patched') {
      await fs.writeFile(entryPath, result.source, 'utf8');
      console.log('[postinstall] Hid the Codex SDK subprocess console on Windows');
    } else if (result.status === 'unsupported') {
      console.warn('[postinstall] Codex SDK spawn layout changed; Windows console fix was not applied');
    }

    return result.status;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[postinstall] Could not patch Codex SDK: ${error.message}`);
    }
    return 'missing';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fixCodexSdkWindowsHide();
}
