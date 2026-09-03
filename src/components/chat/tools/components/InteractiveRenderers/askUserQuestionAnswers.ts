import type { Provider, Question } from '../../../types/types';

type CodexQuestionAnswer = { answers: string[] };
export type QuestionAnswerSelection = { question: Question; values: string[] };

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  pi: 'Pi',
};

export function getUserInputProviderLabel(provider?: Provider): string {
  return PROVIDER_LABELS[provider || 'claude'];
}

export function buildQuestionAnswerPayload(
  selections: QuestionAnswerSelection[],
  provider?: Provider,
): Record<string, string | CodexQuestionAnswer> {
  const payload: Record<string, string | CodexQuestionAnswer> = {};
  selections.forEach(({ question, values }) => {
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
