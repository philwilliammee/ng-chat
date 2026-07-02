import { Hono } from 'hono';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { encode } from 'gpt-tokenizer';
import { ToolRegistry } from './tools/registry.js';

function countTokens(text: string): number {
  try { return encode(text).length; }
  catch { return Math.ceil(text.length / 4); }
}

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
  /**
   * Allowlist of model ids the client may request. Defaults to [defaultModel].
   * The client receives this list via GET /config for UI model switching.
   */
  allowedModels?: string[];
  /**
   * Per-IP sliding-window rate limit for POST /. Defaults to 60 req/min.
   * Set to 0 to disable.
   */
  rateLimit?: { maxRequests: number; windowMs: number };
}

interface ChatRequestBody {
  messages: UIMessage[];
  model?: string;
  /** Thinking level requested by the client: 'disabled' | 'low' | 'medium' | 'high' */
  thinkingLevel?: string;
}

/** Per-IP sliding-window rate limiter (in-memory, single-instance). */
function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, number[]>();
  return function limit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (buckets.get(ip) ?? []).filter(t => t > cutoff);
    if (hits.length >= maxRequests) return false;
    hits.push(now);
    buckets.set(ip, hits);
    return true;
  };
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
  const allowedModels = config.allowedModels?.length
    ? config.allowedModels
    : [config.defaultModel];

  const rl = config.rateLimit;
  const rateLimitEnabled = rl ? rl.maxRequests > 0 : true;
  const checkRate = rateLimitEnabled
    ? createRateLimiter(rl?.maxRequests ?? 60, rl?.windowMs ?? 60_000)
    : null;

  const app = new Hono();

  // Client bootstrap info (model, limits, available tools).
  app.get('/config', (c) =>
    c.json({
      model: config.defaultModel,
      contextLimit: config.contextLimit ?? 128_000,
      allowedModels,
      tools: registry.names(),
    }),
  );

  // Main streaming endpoint — returns a UI Message Stream (SSE).
  app.post('/', async (c) => {
    // Rate limiting
    if (checkRate) {
      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
        ?? c.req.header('x-real-ip')
        ?? 'unknown';
      if (!checkRate(ip)) {
        return c.json({ error: 'Too many requests. Please wait before sending another message.' }, 429);
      }
    }

    try {
      const body = await c.req.json<ChatRequestBody>();
      const messages = Array.isArray(body.messages) ? body.messages : [];

      // Validate model against allowlist
      const requestedModel = body.model;
      if (requestedModel && !allowedModels.includes(requestedModel)) {
        return c.json({ error: `Model '${requestedModel}' is not available.` }, 400);
      }

      const thinkingLevel = body.thinkingLevel ?? config.defaultThinkingLevel;
      const budgetTokens = thinkingBudgetFor(thinkingLevel);
      const provider = getProvider(budgetTokens);

      // Count input tokens from the full conversation (messages + system prompt).
      let inputTokens = 0;
      if (config.systemPrompt) inputTokens += countTokens(config.systemPrompt);
      for (const msg of messages) {
        for (const part of (msg.parts ?? []) as Array<{ type: string; text?: string; reasoning?: string }>) {
          if (part.type === 'text' && part.text) inputTokens += countTokens(part.text);
          else if (part.type === 'reasoning' && part.reasoning) inputTokens += countTokens(part.reasoning);
        }
      }

      // Accumulate output tokens across all agentic steps.
      let outputTokens = 0;

      const result = streamText({
        model: provider(requestedModel ?? config.defaultModel),
        system: config.systemPrompt,
        messages: await convertToModelMessages(messages),
        tools: registry.toAiTools(),
        stopWhen: stepCountIs(maxRounds),
        abortSignal: c.req.raw.signal,
        onStepFinish: ({ text }) => {
          if (text) outputTokens += countTokens(text);
        },
      });

      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        messageMetadata: ({ part }) =>
          part.type === 'finish'
            ? { totalUsage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens } }
            : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
