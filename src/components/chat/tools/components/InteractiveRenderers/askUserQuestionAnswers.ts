import type { Question } from '../../../types/types';

type CodexQuestionAnswer = { answers: string[] };

export function buildQuestionAnswerPayload(
  questions: Question[],
  valuesByQuestion: string[][],
  provider?: string,
): Record<string, string | CodexQuestionAnswer> {
  const payload: Record<string, string | CodexQuestionAnswer> = {};
  questions.forEach((question, index) => {
    const values = valuesByQuestion[index] || [];
    if (values.length === 0) {
      if (provider === 'codex' && question.id) {
        payload[question.id] = { answers: [] };
      }
      return;
    }

    if (provider === 'codex') {
      payload[question.id || question.question] = { answers: values };
      return;
    }
    payload[question.question] = values.join(', ');
  });
  return payload;
}
