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
  const defaultProvider = createOpenAICompatible(providerBase);

  return function getProvider(budgetTokens: number | undefined) {
    if (!budgetTokens) return defaultProvider;
    return createOpenAICompatible({
      ...providerBase,
      transformRequestBody: (body) => ({
        ...body,
        thinking: { type: 'enabled', budget_tokens: budgetTokens },
      }),
    });
  };
}
