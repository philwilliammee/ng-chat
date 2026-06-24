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
}

interface ChatRequestBody {
  messages: UIMessage[];
  model?: string;
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
  const provider = createOpenAICompatible({
    name: config.providerName ?? 'gateway',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

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
    const body = await c.req.json<ChatRequestBody>();
    const messages = Array.isArray(body.messages) ? body.messages : [];

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
      headers: {
        // Disable proxy buffering so SSE chunks flush immediately behind
        // nginx / AWS ALB. Required for smooth streaming on Fargate.
        'X-Accel-Buffering': 'no',
      },
    });
  });

  return app;
}
