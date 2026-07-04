import type { UIMessage } from 'ai';
import { estimateMessagesTokens } from './tokens.js';

export function clipHistory(messages: UIMessage[], budget: number): UIMessage[] {
  if (estimateMessagesTokens(messages) <= budget) return messages;

  const userIndices = messages
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter(i => i >= 0);

  let result = messages;
  for (let drop = 0; drop < userIndices.length - 1; drop++) {
    const nextUserIdx = userIndices[drop + 1];
    result = messages.slice(nextUserIdx);
    if (estimateMessagesTokens(result) <= budget) break;
  }
  return result;
}
