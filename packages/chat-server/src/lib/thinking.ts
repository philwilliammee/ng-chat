import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const THINKING_BUDGETS: Record<string, number> = {
  low: 2_000,
  medium: 8_000,
  high: 16_000,
};

export function thinkingBudgetFor(level: string | undefined): number | undefined {
  return level ? THINKING_BUDGETS[level] : undefined;
}

interface ProviderBase {
  name: string;
  baseURL: string;
  apiKey?: string;
}

export function createProviderFactory(providerBase: ProviderBase) {
  // Without includeUsage the gateway's *streaming* responses carry no usage chunk,
  // so streamText's onStepFinish/onFinish report usage as all-undefined and the
  // caller silently falls back to counting tokens locally. That fallback uses a
  // GPT tokenizer, so for a Claude model behind an OpenAI-compatible gateway it is
  // an approximation of the wrong vocabulary — and it drives both the context ring
  // and the compaction threshold. Ask for the real numbers.
  const base = { ...providerBase, includeUsage: true };
  const defaultProvider = createOpenAICompatible(base);

  return function getProvider(budgetTokens: number | undefined) {
    if (!budgetTokens) return defaultProvider;
    return createOpenAICompatible({
      ...base,
      transformRequestBody: (body) => ({
        ...body,
        thinking: { type: 'enabled', budget_tokens: budgetTokens },
      }),
    });
  };
}
