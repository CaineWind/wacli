import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuestionAnswerPayload,
  getUserInputProviderLabel,
} from './askUserQuestionAnswers';

const questions = [
  {
    id: 'scope',
    header: 'Scope',
    question: 'Which area?',
    options: [{ label: 'Backend', description: 'Server code' }],
  },
  {
    id: 'priority',
    header: 'Priority',
    question: 'What should come first?',
    options: [{ label: 'Correctness' }],
  },
];

test('builds Codex request_user_input answers by stable question id', () => {
  assert.deepEqual(
    buildQuestionAnswerPayload([
      { question: questions[0], values: ['Backend'] },
      { question: questions[1], values: ['Correctness'] },
    ], 'codex'),
    {
      scope: { answers: ['Backend'] },
      priority: { answers: ['Correctness'] },
    },
  );
});

test('preserves commas in Codex custom answers and includes skipped questions', () => {
  assert.deepEqual(
    buildQuestionAnswerPayload([
      { question: questions[0], values: ['API, database'] },
      { question: questions[1], values: [] },
    ], 'codex'),
    {
      scope: { answers: ['API, database'] },
      priority: { answers: [] },
    },
  );
});

test('keeps the existing Claude question-text answer contract', () => {
  assert.deepEqual(
    buildQuestionAnswerPayload([
      { question: questions[0], values: ['Backend'] },
      { question: questions[1], values: [] },
    ], 'claude'),
    { 'Which area?': 'Backend' },
  );
});

test('uses a provider-specific prompt label and keeps legacy requests on Claude', () => {
  assert.equal(getUserInputProviderLabel('codex'), 'Codex');
  assert.equal(getUserInputProviderLabel('cursor'), 'Cursor');
  assert.equal(getUserInputProviderLabel('opencode'), 'OpenCode');
  assert.equal(getUserInputProviderLabel(), 'Claude');
});
