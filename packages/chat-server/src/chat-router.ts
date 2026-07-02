import { Hono } from 'hono';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ToolRegistry } from './tools/registry.js';

export interface ChatRouterConfig {
  /** OpenAI-compatible base URL (e.g. Cornell gateway `.../v1`). */
  baseURL: string;
  /** Bearer API key for the gateway. */
  apiKey?: string;
  /** Default model id when the request does not specify one. */
  defaultModel: string;
  /** Context window (tokens) reported to the client. */
  contextLimit?: number;
  /** Max agentic tool-calling rounds per turn. */
  maxToolRounds?: number;
  /** System prompt prepended to every conversation. */
  systemPrompt?: string;
  /** Tool registry exposed to the model. Defaults to an empty registry. */
  tools?: ToolRegistry;
  /** Provider label (cosmetic). */
  providerName?: string;
  /**
   * Default thinking level when the request body doesn't specify one.
   * 'disabled' (default) | 'low' | 'medium' | 'high'
   */
  defaultThinkingLevel?: string;
}

interface ChatRequestBody {
  messages: UIMessage[];
  model?: string;
  /** Thinking level requested by the client: 'disabled' | 'low' | 'medium' | 'high' */
  thinkingLevel?: string;
}

const THINKING_BUDGETS: Record<string, number> = {
  low: 2_000,
  medium: 8_000,
  high: 16_000,
};

function thinkingBudgetFor(level: string | undefined): number | undefined {
  return level ? THINKING_BUDGETS[level] : undefined;
}

/**
 * Build a Hono sub-app exposing the ng-chat endpoints. Mount it anywhere:
 *
 *   app.route('/api/chat', createChatRouter({ ... }))
 *
 * Responses use the Vercel AI SDK **UI Message Stream Protocol** (SSE), so any
 * AI-SDK-compatible client — including `@ng-chat/ui` — can consume it unchanged.
 */
export function createChatRouter(config: ChatRouterConfig): Hono {
  const providerBase = {
    name: config.providerName ?? 'gateway',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  };

  // Default provider (no thinking). For requests that need thinking we create a
  // fresh provider with transformRequestBody so the budget_tokens reach the gateway.
  const defaultProvider = createOpenAICompatible(providerBase);

  function getProvider(budgetTokens: number | undefined) {
    if (!budgetTokens) return defaultProvider;
    return createOpenAICompatible({
      ...providerBase,
      transformRequestBody: (body) => ({
        ...body,
        thinking: { type: 'enabled', budget_tokens: budgetTokens },
      }),
    });
  }

  const registry = config.tools ?? new ToolRegistry();
  const maxRounds = config.maxToolRounds ?? 8;
  const app = new Hono();

  // Client bootstrap info (model, limits, available tools).
  app.get('/config', (c) =>
    c.json({
      model: config.defaultModel,
      contextLimit: config.contextLimit ?? 128_000,
      tools: registry.names(),
    }),
  );

  // Main streaming endpoint — returns a UI Message Stream (SSE).
  app.post('/', async (c) => {
    try {
      const body = await c.req.json<ChatRequestBody>();
      const messages = Array.isArray(body.messages) ? body.messages : [];

      const thinkingLevel = body.thinkingLevel ?? config.defaultThinkingLevel;
      const budgetTokens = thinkingBudgetFor(thinkingLevel);
      const provider = getProvider(budgetTokens);

      const result = streamText({
        model: provider(body.model ?? config.defaultModel),
        system: config.systemPrompt,
        messages: await convertToModelMessages(messages),
        tools: registry.toAiTools(),
        stopWhen: stepCountIs(maxRounds),
        abortSignal: c.req.raw.signal,
      });

      return result.toUIMessageStreamResponse({
        sendReasoning: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
