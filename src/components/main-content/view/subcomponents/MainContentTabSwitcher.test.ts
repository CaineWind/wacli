import assert from 'node:assert/strict';
import test from 'node:test';

import { getBuiltInTabs, shouldShowPluginTabs } from '../../utils/mainContentTabs';

test('shows Herdr in the header without a selected project', () => {
  const tabs = getBuiltInTabs({
    hasSelectedProject: false,
    shouldShowBrowserTab: true,
    shouldShowTasksTab: true,
  });

  assert.deepEqual(tabs.map((tab) => tab.id), ['herdr']);
  assert.equal(shouldShowPluginTabs(false), false);
});

test('keeps all available workspace tabs when a project is selected', () => {
  const tabs = getBuiltInTabs({
    hasSelectedProject: true,
    shouldShowBrowserTab: true,
    shouldShowTasksTab: true,
  });

  assert.deepEqual(tabs.map((tab) => tab.id), [
    'chat',
    'shell',
    'herdr',
    'files',
    'git',
    'browser',
    'tasks',
  ]);
  assert.equal(shouldShowPluginTabs(true), true);
});
