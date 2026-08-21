import { encode } from 'gpt-tokenizer';
import type { UIMessage } from 'ai';

/**
 * Classify a model ID into a tokenizer family so we can apply the right
 * character-to-token ratio when the gpt-tokenizer is inappropriate.
 *
 * - 'gpt'     — OpenAI GPT family; use gpt-tokenizer (cl100k_base / o200k_base)
 * - 'claude'  — Anthropic Claude; ~3.5 chars/token (BPE, slightly denser than GPT)
 * - 'generic' — Llama, Mistral, Gemma, etc.; ~4 chars/token conservative estimate
 */
export type TokenModel = 'gpt' | 'claude' | 'generic';

export function classifyModel(modelId?: string): TokenModel {
  if (!modelId) return 'gpt';
  const l = modelId.toLowerCase();
  if (l.includes('claude') || l.startsWith('anthropic') || l.includes('us.anthropic')) return 'claude';
  if (
    l.includes('gpt') ||
    l.startsWith('o1') || l.startsWith('o3') || l.startsWith('o4') ||
    l.includes('-o1') || l.includes('-o3') || l.includes('-o4')
  ) return 'gpt';
  return 'generic';
}

export function countTokens(text: string, modelId?: string): number {
  const kind = classifyModel(modelId);
  if (kind === 'gpt') {
    try { return encode(text).length; }
    catch { /* fall through to char ratio */ }
  }
  const ratio = kind === 'claude' ? 3.5 : 4;
  return Math.ceil(text.length / ratio);
}

/**
 * Estimate total tokens for a UIMessage array.
 * Handles AI SDK v6 part shapes:
 *   - reasoning: { type: 'reasoning', text: '...' }
 *   - tool: { type: 'tool-<name>' | 'dynamic-tool', input: {...}, output: {...} }
 *
 * Pass modelId for a model-appropriate estimate; defaults to GPT tokenizer.
 */
export function estimateMessagesTokens(messages: UIMessage[], modelId?: string): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of (msg.parts ?? []) as Array<Record<string, unknown>>) {
      const type = part['type'] as string;
      if (type === 'text' && typeof part['text'] === 'string') {
        total += countTokens(part['text'], modelId);
      } else if (type === 'reasoning' && typeof part['text'] === 'string') {
        // v6: reasoning parts carry the text in .text (not .reasoning)
        total += countTokens(part['text'], modelId);
      } else if (type === 'file') {
        // Inline base64 images are expensive; count ~1000 tokens each
        total += 1_000;
      } else if (type === 'dynamic-tool' || type.startsWith('tool-')) {
        // v6 tool parts: { type: 'tool-<name>', input: {...}, output: {...} }
        if (part['input'] !== undefined) total += countTokens(JSON.stringify(part['input']), modelId);
        if (part['output'] !== undefined) total += countTokens(JSON.stringify(part['output']), modelId);
      }
    }
  }
  return total;
}
