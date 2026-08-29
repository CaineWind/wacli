import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';
import { createHerdrShellProps, getHerdrClientSessionId } from '../utils/herdrShell';

test('launches Herdr directly in a project-scoped terminal', () => {
  const project: Project = {
    projectId: 'project-1',
    displayName: 'Project One',
    fullPath: 'C:\\workspace\\project-one',
  };

  const shellProps = createHerdrShellProps(project, true, 'herdr-client-id');

  assert.equal(shellProps.project, project);
  assert.equal(shellProps.command, 'herdr');
  assert.equal(shellProps.isPlainShell, true);
  assert.equal(shellProps.autoConnect, true);
  assert.equal(shellProps.minimal, true);
  assert.equal(shellProps.isActive, true);
  assert.equal(shellProps.shellSessionId, 'herdr-client-id');
  assert.equal(shellProps.shellMode, 'herdr');
});

test('reuses one Herdr client id per project and browser tab', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  const firstId = getHerdrClientSessionId('project-1', storage);
  const repeatedId = getHerdrClientSessionId('project-1', storage);
  const otherProjectId = getHerdrClientSessionId('project-2', storage);

  assert.equal(repeatedId, firstId);
  assert.notEqual(otherProjectId, firstId);
  assert.match(firstId, /^herdr-[a-zA-Z0-9-]+$/);
});
