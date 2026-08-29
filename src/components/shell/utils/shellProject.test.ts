import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import { resolveShellProjectPath } from './shellProject';

test('resolves a project-independent path for global Herdr', () => {
  assert.equal(resolveShellProjectPath(null, 'herdr'), '');
});

test('rejects a project-independent path for regular shells', () => {
  assert.equal(resolveShellProjectPath(null, 'default'), null);
});

test('preserves the selected project path for project-scoped shells', () => {
  const project: Project = {
    projectId: 'project-1',
    displayName: 'Project One',
    fullPath: 'C:\\workspace\\project-one',
  };

  assert.equal(resolveShellProjectPath(project, 'default'), project.fullPath);
  assert.equal(resolveShellProjectPath(project, 'herdr'), project.fullPath);
});
