import type { UIMessage } from 'ai';
import { estimateMessagesTokens } from './tokens.js';
import { buildTranscript } from './transcript.js';

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

export function splitForCompaction(
  messages: UIMessage[],
  keepTurns: number,
): { toSummarize: UIMessage[]; toKeep: UIMessage[] } {
  const userIndices = messages
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter(i => i >= 0);

  if (userIndices.length <= keepTurns) {
    return { toSummarize: [], toKeep: messages };
  }

  const splitIdx = userIndices[userIndices.length - keepTurns];
  return {
    toSummarize: messages.slice(0, splitIdx),
    toKeep: messages.slice(splitIdx),
  };
}

export function buildSummaryMessages(summary: string): UIMessage[] {
  return [
    {
      id: 'compaction-context',
      role: 'user',
      content: '',
      parts: [{ type: 'text', text: `[Context from earlier in this conversation]\n${summary}` }],
    } as unknown as UIMessage,
    {
      id: 'compaction-ack',
      role: 'assistant',
      content: '',
      parts: [{ type: 'text', text: 'Context noted. Continuing from here.' }],
    } as unknown as UIMessage,
  ];
}

export async function slidingCompact(
  messages: UIMessage[],
  budget: number,
  keepTurns: number,
  summarizeFn: (transcript: string) => Promise<string>,
  modelId?: string,
): Promise<UIMessage[]> {
  if (estimateMessagesTokens(messages, modelId) <= budget) return messages;

  const { toSummarize, toKeep } = splitForCompaction(messages, keepTurns);
  if (toSummarize.length === 0) {
    return clipHistory(messages, budget);
  }

  const transcript = buildTranscript(toSummarize, { includeTools: true });
  const summary = await summarizeFn(transcript);
  const compacted = [...buildSummaryMessages(summary), ...toKeep];

  return estimateMessagesTokens(compacted, modelId) <= budget
    ? compacted
    : clipHistory(compacted, budget);
}
