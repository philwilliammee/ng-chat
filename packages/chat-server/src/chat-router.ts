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
import { clipHistory, slidingCompact } from './lib/history.js';
import { createRateLimiter, getClientIp } from './lib/rate-limit.js';
import { THINKING_BUDGETS, thinkingBudgetFor, createProviderFactory } from './lib/thinking.js';
import { buildTranscript } from './lib/transcript.js';
import { suggestSkills, extractLastUserText } from './lib/skill-suggest.js';

export interface ChatRouterConfig {
  /** OpenAI-compatible base URL (e.g. Cornell gateway `.../v1`). */
  baseURL: string;
  /** Bearer API key for the gateway. */
  apiKey?: string;
  /** Default model id when the request does not specify one. */
  defaultModel: string;
  /** Context window (tokens) reported to the client. */
  contextLimit?: number;
  /** Default max agentic tool-calling rounds per turn. */
  maxToolRounds?: number;
  /**
   * Hard ceiling on per-request maxToolRounds override. Clients may request
   * up to this many rounds via the request body. Defaults to 30.
   */
  maxToolRoundsLimit?: number;
  /**
   * System prompt prepended to every conversation.
   * A function is evaluated on every request so memory indexes and other
   * dynamic content stay fresh without restarting the server.
   */
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
  /**
   * Max output tokens per model call. Prevents the stream from terminating
   * mid-JSON on large tool-call arguments. Defaults to 16000.
   */
  maxOutputTokens?: number;
  /**
   * Skill names the server knows about at startup. When provided, the router
   * appends a one-line hint to the per-request system prompt if any skill name
   * keywords match the last user message — nudging the model toward the right
   * skill without loading its content.
   */
  skillSuggestList?: string[];
  /**
   * Sliding-window compaction: when the message history exceeds `historyBudget`,
   * summarize the oldest turns and keep the last `keepTurns` verbatim instead of
   * hard-dropping them. Disabled by default; enable by providing this object.
   */
  slidingCompaction?: { keepTurns?: number };
}

interface ChatRequestBody {
  messages: UIMessage[];
  model?: string;
  /** Thinking level requested by the client: 'disabled' | 'low' | 'medium' | 'high' */
  thinkingLevel?: string;
  /** Per-request tool-round override. Capped server-side at maxToolRoundsLimit. */
  maxToolRounds?: number;
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
  const roundsLimit = config.maxToolRoundsLimit ?? 30;
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
      const raw = Array.isArray(body.messages) ? body.messages : [];

      if (raw.some(m => !Array.isArray((m as Record<string, unknown>).parts))) {
        return c.json({
          error: 'Messages must use the AI SDK v5+ UIMessage shape with a `parts` array (e.g. {id, role, parts: [{type:"text", text:"…"}]}). The legacy {role, content: string} format is not supported.',
        }, 400);
      }

      // Validate model against allowlist
      const requestedModel = body.model;
      if (requestedModel && !allowedModels.includes(requestedModel)) {
        return c.json({ error: `Model '${requestedModel}' is not available.` }, 400);
      }

      const thinkingLevel = body.thinkingLevel ?? config.defaultThinkingLevel;
      const budgetTokens = thinkingBudgetFor(thinkingLevel);
      const provider = getProvider(budgetTokens);

      const modelId = requestedModel ?? config.defaultModel;

      let messages: UIMessage[];
      if (config.slidingCompaction && estimateMessagesTokens(raw, modelId) > historyBudget) {
        const keepTurns = config.slidingCompaction.keepTurns ?? 6;
        try {
          const summaryProvider = getProvider(undefined);
          messages = await slidingCompact(raw, historyBudget, keepTurns, async (transcript) => {
            const { text } = await generateText({
              model: summaryProvider(config.defaultModel),
              messages: [{
                role: 'user',
                content: `Summarise the following conversation concisely in 4–8 sentences, preserving all key facts, decisions, and outcomes:\n\n${transcript}`,
              }],
            });
            return text;
          }, modelId);
        } catch (err) {
          console.error('[chat] sliding compaction failed, falling back to clipHistory:', err instanceof Error ? err.message : err);
          messages = clipHistory(raw, historyBudget);
        }
      } else {
        messages = clipHistory(raw, historyBudget);
      }

      // Per-request rounds override, capped at server-side limit.
      const rounds = body.maxToolRounds
        ? Math.min(Math.max(1, body.maxToolRounds), roundsLimit)
        : maxRounds;

      const baseSystemPrompt = resolveSystemPrompt();
      let systemPrompt = baseSystemPrompt;
      if (config.skillSuggestList?.length) {
        const userText = extractLastUserText(messages);
        const suggestions = suggestSkills(userText, config.skillSuggestList);
        if (suggestions.length > 0) {
          const hint = `[Skill hint] This message may be relevant to: ${suggestions.map(s => `use_skill("${s}")`).join(', ')}.`;
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${hint}` : hint;
        }
      }

      let lastPromptTokens = systemPrompt ? countTokens(systemPrompt, modelId) : 0;
      lastPromptTokens += estimateMessagesTokens(messages, modelId);
      let totalCompletionTokens = 0;

      const result = streamText({
        model: provider(modelId),
        system: systemPrompt,
        messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
        tools: registry.toAiTools(),
        stopWhen: stepCountIs(rounds),
        maxOutputTokens: config.maxOutputTokens ?? 16_000,
        abortSignal: c.req.raw.signal,
        onStepFinish: ({ text, usage }) => {
          if (usage?.inputTokens) lastPromptTokens = usage.inputTokens;
          totalCompletionTokens += usage?.outputTokens ?? (text ? countTokens(text, modelId) : 0);
        },
      });

      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        onError: (err) => {
          if (err && typeof err === 'object' && 'toolInput' in err) {
            const e = err as { toolName?: string; toolInput?: string };
            console.error('[chat] invalid tool input for', e.toolName, '— raw input (first 1000 chars):', String(e.toolInput ?? '').slice(0, 1000));
          }
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[chat] stream error:', msg);
          return msg;
        },
        messageMetadata: ({ part }) =>
          part.type === 'finish'
            ? { totalUsage: { promptTokens: lastPromptTokens, completionTokens: totalCompletionTokens, totalTokens: lastPromptTokens + totalCompletionTokens } }
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
export { countTokens, estimateMessagesTokens, classifyModel } from './lib/tokens.js';
export { clipHistory, slidingCompact, splitForCompaction, buildSummaryMessages } from './lib/history.js';
export { createRateLimiter, getClientIp } from './lib/rate-limit.js';
export { THINKING_BUDGETS, thinkingBudgetFor, createProviderFactory } from './lib/thinking.js';
export { buildTranscript } from './lib/transcript.js';
export { suggestSkills, extractLastUserText } from './lib/skill-suggest.js';
