import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQuestionAnswerPayload } from './askUserQuestionAnswers';

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
    buildQuestionAnswerPayload(questions, [['Backend'], ['Correctness']], 'codex'),
    {
      scope: { answers: ['Backend'] },
      priority: { answers: ['Correctness'] },
    },
  );
});

test('preserves commas in Codex custom answers and includes skipped questions', () => {
  assert.deepEqual(
    buildQuestionAnswerPayload(questions, [['API, database'], []], 'codex'),
    {
      scope: { answers: ['API, database'] },
      priority: { answers: [] },
    },
  );
});

test('keeps the existing Claude question-text answer contract', () => {
  assert.deepEqual(
    buildQuestionAnswerPayload(questions, [['Backend'], []], 'claude'),
    { 'Which area?': 'Backend' },
  );
});
