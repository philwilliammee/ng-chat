import { encode } from 'gpt-tokenizer';
import type { UIMessage } from 'ai';

export function countTokens(text: string): number {
  try { return encode(text).length; }
  catch { return Math.ceil(text.length / 4); }
}

/**
 * Estimate total tokens for a UIMessage array.
 * Handles AI SDK v6 part shapes:
 *   - reasoning: { type: 'reasoning', text: '...' }
 *   - tool: { type: 'tool-<name>' | 'dynamic-tool', input: {...}, output: {...} }
 */
export function estimateMessagesTokens(messages: UIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of (msg.parts ?? []) as Array<Record<string, unknown>>) {
      const type = part['type'] as string;
      if (type === 'text' && typeof part['text'] === 'string') {
        total += countTokens(part['text']);
      } else if (type === 'reasoning' && typeof part['text'] === 'string') {
        // v6: reasoning parts carry the text in .text (not .reasoning)
        total += countTokens(part['text']);
      } else if (type === 'file') {
        // Inline base64 images are expensive; count ~1000 tokens each
        total += 1_000;
      } else if (type === 'dynamic-tool' || type.startsWith('tool-')) {
        // v6 tool parts: { type: 'tool-<name>', input: {...}, output: {...} }
        if (part['input'] !== undefined) total += countTokens(JSON.stringify(part['input']));
        if (part['output'] !== undefined) total += countTokens(JSON.stringify(part['output']));
      }
    }
  }
  return total;
}
