import assert from 'node:assert/strict';
import test from 'node:test';

import { addWindowsHideToCodexSdk } from '../../../../scripts/fix-codex-sdk-windows-hide.js';

const sdkSpawnSource = `
const child = spawn(this.executablePath, commandArgs, {
  env,
  signal: args.signal
});
`;

test('Codex SDK patch adds windowsHide to the CLI spawn options', () => {
  const result = addWindowsHideToCodexSdk(sdkSpawnSource);

  assert.equal(result.status, 'patched');
  assert.match(result.source, /windowsHide:\s*true/);
});

test('Codex SDK patch is idempotent', () => {
  const first = addWindowsHideToCodexSdk(sdkSpawnSource);
  const second = addWindowsHideToCodexSdk(first.source);

  assert.equal(second.status, 'already-patched');
  assert.equal(second.source, first.source);
});

test('Codex SDK patch rejects an unknown SDK layout', () => {
  const result = addWindowsHideToCodexSdk('const child = customSpawn();');

  assert.equal(result.status, 'unsupported');
  assert.equal(result.source, 'const child = customSpawn();');
});
