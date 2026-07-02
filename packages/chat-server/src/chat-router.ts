import { Hono } from 'hono';
import {
  streamText,
  generateText,
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

/** Estimate total tokens for a UIMessage array (text parts only; +1000 per inline image). */
function estimateMessagesTokens(messages: UIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of (msg.parts ?? []) as Array<Record<string, unknown>>) {
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        total += countTokens(part['text']);
      } else if (part['type'] === 'reasoning' && typeof part['reasoning'] === 'string') {
        total += countTokens(part['reasoning']);
      } else if (part['type'] === 'file') {
        // Inline base64 images are expensive; count ~1000 tokens each rather than the raw bytes
        total += 1_000;
      } else if (part['type'] === 'tool-invocation') {
        const inv = part['toolInvocation'] as Record<string, unknown> | undefined;
        if (inv?.['args']) total += countTokens(JSON.stringify(inv['args']));
        if (inv?.['result']) total += countTokens(JSON.stringify(inv['result']));
      }
    }
  }
  return total;
}

/**
 * Trim `messages` to fit within `budget` tokens by dropping the oldest complete
 * user-turn boundaries (user message + following assistant message(s)) until the
 * total estimated token count is within budget.  Always retains at least the last
 * complete turn so the model still has something to respond to.
 */
function clipHistory(messages: UIMessage[], budget: number): UIMessage[] {
  if (estimateMessagesTokens(messages) <= budget) return messages;

  // Collect the index of each user message — these are turn boundaries.
  const userIndices = messages
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter(i => i >= 0);

  // We need at least the last user turn, so we can drop everything before the
  // second-to-last user boundary at most.
  let result = messages;
  for (let drop = 0; drop < userIndices.length - 1; drop++) {
    const nextUserIdx = userIndices[drop + 1];
    result = messages.slice(nextUserIdx);
    if (estimateMessagesTokens(result) <= budget) break;
  }
  return result;
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
  /**
   * Root directory for the read_file / search_files tools.
   * Files outside this directory are rejected. Defaults to `./skills`.
   */
  contentDir?: string;
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

  const contextLimit = config.contextLimit ?? 128_000;
  // Reserve headroom for the model's response + tool-call overhead.
  const historyBudget = contextLimit - 8_000;

  // Client bootstrap info (model, limits, available tools).
  app.get('/config', (c) =>
    c.json({
      model: config.defaultModel,
      contextLimit,
      allowedModels,
      tools: registry.names(),
    }),
  );

  // Compact endpoint — summarises a conversation into a single paragraph so the
  // client can replace its history and reclaim context budget.
  app.post('/compact', async (c) => {
    try {
      const body = await c.req.json<{ messages: UIMessage[] }>();
      const messages = Array.isArray(body.messages) ? body.messages : [];

      // Build a plain-text transcript (text parts only; skip tool calls and files).
      const transcript = messages
        .map(m => {
          const textParts = (m.parts ?? []) as Array<Record<string, unknown>>;
          const text = textParts
            .filter(p => p['type'] === 'text' && typeof p['text'] === 'string')
            .map(p => p['text'] as string)
            .join(' ');
          return text ? `${m.role}: ${text}` : null;
        })
        .filter(Boolean)
        .join('\n');

      const provider = getProvider(undefined);
      const { text: summary } = await generateText({
        model: provider(config.defaultModel),
        messages: [
          {
            role: 'user',
            content: `Summarise the following conversation in 3–6 sentences. Preserve all key facts, decisions, and outcomes. Write in past tense as a neutral observer.\n\n${transcript}`,
          },
        ],
      });

      return c.json({ summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message }, 500);
    }
  });

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
      const messages = clipHistory(
        Array.isArray(body.messages) ? body.messages : [],
        historyBudget,
      );

      // Validate model against allowlist
      const requestedModel = body.model;
      if (requestedModel && !allowedModels.includes(requestedModel)) {
        return c.json({ error: `Model '${requestedModel}' is not available.` }, 400);
      }

      const thinkingLevel = body.thinkingLevel ?? config.defaultThinkingLevel;
      const budgetTokens = thinkingBudgetFor(thinkingLevel);
      const provider = getProvider(budgetTokens);

      // Count input tokens from the clipped conversation (messages + system prompt).
      let inputTokens = config.systemPrompt ? countTokens(config.systemPrompt) : 0;
      inputTokens += estimateMessagesTokens(messages);

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
