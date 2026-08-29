/** Commands the Codex native runtime intercepts before its legacy SDK fallback. */
type CodexNativeCommand =
  | { kind: 'plan'; prompt: string }
  | { kind: 'review'; prompt: string }
  | { kind: 'compact' };

/**
 * Parses commands that require Codex app-server semantics.
 *
 * The Codex runtime wrapper consumes this result before delegating ordinary
 * prompts and project-defined slash commands to the existing SDK runtime.
 */
export function parseCodexNativeCommand(input: string): CodexNativeCommand | null {
  const match = input.trim().match(/^\/(plan|review|compact)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }

  const commandName = match[1]?.toLowerCase();
  const prompt = match[2]?.trim() || '';

  if (commandName === 'compact') {
    return prompt ? null : { kind: 'compact' };
  }

  if (commandName === 'plan' || commandName === 'review') {
    return { kind: commandName, prompt };
  }

  return null;
}
