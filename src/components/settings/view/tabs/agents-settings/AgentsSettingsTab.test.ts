import assert from 'node:assert/strict';
import test from 'node:test';

import { getVisibleAgentCategories } from './agentCategories';

test('Pi settings expose account and skills without MCP or permissions', () => {
  assert.deepEqual(getVisibleAgentCategories({
    supportsMcp: false,
    supportsSkills: true,
    supportsPermissionSettings: false,
  }), ['account', 'skills']);
});

test('settings categories follow provider capabilities', () => {
  assert.deepEqual(getVisibleAgentCategories({
    supportsMcp: true,
    supportsSkills: false,
    supportsPermissionSettings: true,
  }), ['account', 'permissions', 'mcp']);
});
