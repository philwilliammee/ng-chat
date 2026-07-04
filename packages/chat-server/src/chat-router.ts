import { Hono } from 'hono';
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ToolRegistry } from './tools/registry.js';
import { countTokens, estimateMessagesTokens } from './lib/tokens.js';
import { clipHistory } from './lib/history.js';
import { createRateLimiter, getClientIp } from './lib/rate-limit.js';
import { thinkingBudgetFor, createProviderFactory } from './lib/thinking.js';
import { buildTranscript } from './lib/transcript.js';

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
  systemPrompt?: string | (() => string);
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

  const getProvider = createProviderFactory(providerBase);

  const resolveSystemPrompt: () => string | undefined =
    typeof config.systemPrompt === 'function'
      ? config.systemPrompt
      : () => config.systemPrompt as string | undefined;

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
    // Rate limiting
    if (checkRate) {
      const ip = getClientIp(c);
      if (!checkRate(ip)) {
        return c.json({ error: 'Too many requests. Please wait before sending another message.' }, 429);
      }
    }

    try {
      const body = await c.req.json<{ messages: UIMessage[] }>();
      const messages = Array.isArray(body.messages) ? body.messages : [];

      // Build a plain-text transcript (text parts only; skip tool calls and files).
      const transcript = buildTranscript(messages);

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

  // Close endpoint — runs the close skill to extract and persist memories from a conversation.
  app.post('/close', async (c) => {
    // Rate limiting
    if (checkRate) {
      const ip = getClientIp(c);
      if (!checkRate(ip)) {
        return c.json({ error: 'Too many requests. Please wait before sending another message.' }, 429);
      }
    }

    try {
      const body = await c.req.json<{ messages: UIMessage[] }>();
      const messages = Array.isArray(body.messages) ? body.messages : [];

      // Load close.md from the content directory (falls back to a built-in prompt if missing).
      let closeInstruction = 'Extract the key facts, preferences, and decisions from this conversation. Save each distinct topic as a markdown file under memories/ using write_file. Update memories/_index.md with one-line entries for any new files.';
      try {
        const closePath = resolve(config.contentDir ?? './skills', 'close.md');
        closeInstruction = readFileSync(closePath, 'utf-8');
      } catch { /* no close.md — use built-in fallback */ }

      const transcript = buildTranscript(messages, { includeTools: true });

      const provider = getProvider(undefined);
      const result = await generateText({
        model: provider(config.defaultModel),
        messages: [
          {
            role: 'user',
            content: `${closeInstruction}\n\n## Conversation\n\n${transcript}`,
          },
        ],
        tools: registry.toAiTools(),
        stopWhen: stepCountIs(maxRounds),
      });

      const filesWritten: string[] = [];
      for (const step of result.steps) {
        for (const tr of (step.toolResults as unknown as Array<{ toolName: string; output: unknown }>) ?? []) {
          if (tr.toolName === 'write_file') {
            const out = tr.output as { path?: string };
            if (out?.path) filesWritten.push(out.path);
          }
        }
      }

      return c.json({ filesWritten });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message }, 500);
    }
  });

  // Main streaming endpoint — returns a UI Message Stream (SSE).
  app.post('/', async (c) => {
    // Rate limiting
    if (checkRate) {
      const ip = getClientIp(c);
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
      const systemPrompt = resolveSystemPrompt();
      let inputTokens = systemPrompt ? countTokens(systemPrompt) : 0;
      inputTokens += estimateMessagesTokens(messages);

      // Accumulate output tokens across all agentic steps.
      let outputTokens = 0;

      const result = streamText({
        model: provider(requestedModel ?? config.defaultModel),
        system: systemPrompt,
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

// Re-export lib symbols for backward compat and direct imports.
export { countTokens, estimateMessagesTokens } from './lib/tokens.js';
export { clipHistory } from './lib/history.js';
export { createRateLimiter, getClientIp } from './lib/rate-limit.js';
export { THINKING_BUDGETS, thinkingBudgetFor, createProviderFactory } from './lib/thinking.js';
export { buildTranscript } from './lib/transcript.js';
