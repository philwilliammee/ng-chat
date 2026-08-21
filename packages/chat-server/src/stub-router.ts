import { Hono } from 'hono';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';

export interface StubChatRouterConfig {
  /** Text streamed back for every turn. Keep it actionable — a visitor or a new contributor reads it. */
  message: string;
  /**
   * Reported to the client via `GET /config`. `false` means "the feature is
   * switched off, hide the chat surface entirely"; `true` means "it should work
   * but is not configured yet, show it and let the message explain".
   */
  enabled?: boolean;
  /** Echoed in `GET /config` so a client that reads these fields still gets its expected shape. */
  contextLimit?: number;
  tools?: string[];
}

/**
 * A drop-in replacement for `createChatRouter` that answers the same endpoints
 * without a model provider.
 *
 * Mount this instead of the real router when the gateway credentials are absent
 * or the feature is switched off. Without it, a missing `GATEWAY_API_KEY` is not
 * caught anywhere: the router constructs fine, the client opens a stream, and the
 * failure surfaces as a provider auth error mid-stream — which reads like a bug
 * in the app rather than a missing line in `.env`. The reply here is a real UI
 * Message Stream, so it renders as an ordinary assistant message in any
 * AI-SDK-compatible client with no special-casing.
 */
export function createStubChatRouter(config: StubChatRouterConfig): Hono {
  const app = new Hono();
  const enabled = config.enabled ?? true;
  const tools = config.tools ?? [];

  app.get('/config', c =>
    c.json({
      enabled,
      model: null,
      contextLimit: config.contextLimit ?? 0,
      allowedModels: [],
      tools,
    }),
  );

  app.post('/', () => {
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: 'text-start', id });
        writer.write({ type: 'text-delta', id, delta: config.message });
        writer.write({ type: 'text-end', id });
      },
    });
    return createUIMessageStreamResponse({ stream });
  });

  // Both of these need a model call to do anything, so there is nothing to
  // degrade gracefully into — answer with the reason rather than a fake result.
  app.post('/compact', c => c.json({ error: config.message }, 503));
  app.post('/close', c => c.json({ error: config.message }, 503));

  return app;
}
