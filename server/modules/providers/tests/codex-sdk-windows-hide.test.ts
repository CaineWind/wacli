import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('installed Codex SDK hides its CLI console on Windows', {
  skip: process.platform !== 'win32',
}, async () => {
  const sdkEntryPath = new URL(import.meta.resolve('@openai/codex-sdk'));
  const sdkSource = await readFile(sdkEntryPath, 'utf8');
  const spawnCall = sdkSource.match(
    /spawn\(this\.executablePath, commandArgs, \{[\s\S]*?\n\s*\}\);/,
  )?.[0];

  assert.ok(spawnCall, 'Could not locate the Codex SDK CLI spawn call');
  assert.match(
    spawnCall,
    /windowsHide:\s*true/,
    'Codex SDK must hide the subprocess console to prevent MCP terminal popups',
  );
});
