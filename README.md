# ng-chat

An open-source **Angular + Hono agent chat** base template, built on the
[Vercel AI SDK **UI Message Stream Protocol**](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol).

The frontend and backend are fully decoupled — they communicate only through the
standard UI Message Stream Protocol, so either side can be swapped, embedded into
an existing app, or pointed at any compatible endpoint.

## Highlights

- **Standard protocol** — no bespoke wire format. Uses the AI SDK data stream (SSE).
- **Agentic tool loop** — the model can call tools to take actions and fetch data.
- **Reasoning** — streamed chain-of-thought is rendered in a collapsible panel.
- **Pluggable tools** — register AI SDK `tool()`s; ships with a default `use_skill`
  (document-based memory) and a `get_time` demo tool.
- **Cornell AI Gateway** — talks to any OpenAI-compatible endpoint (LiteLLM).
- **Signals + standalone components** — Angular 21, OnPush, zero legacy modules.
- **Runs in Docker** — single container serving the Angular client and Hono API.

## Monorepo layout

| Path | Package | Role |
|------|---------|------|
| `packages/chat-ui` | `@ng-chat/ui` | Angular components: `<ng-chat>`, message/tool/input UI |
| `packages/chat-server` | `@ng-chat/server` | Hono `createChatRouter()` + tool registry + gateway provider |
| `client/` | — | Demo Angular app (uses `@ng-chat/ui` in the admin layout) |
| `server/` | — | Demo Hono server (mounts `@ng-chat/server`) |
| `skills/` | — | Markdown skills loaded on demand by the `use_skill` tool |

Packages are consumed as TypeScript source via tsconfig path aliases — the Angular
compiler builds `@ng-chat/ui`, and `tsx` runs `@ng-chat/server`. No separate
library build step.

## Quick start

```bash
cp .env.example .env      # set GATEWAY_API_KEY
npm install
npm run dev               # Angular :4200 (proxied) + Hono :4315
```

Production / local mode (single server serving the built client):

```bash
npm run run:local         # builds the client, then runs the server via tsx
```

## Configuration (`.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4315` | Server port |
| `GATEWAY_BASE_URL` | `https://api.ai.it.cornell.edu/v1` | OpenAI-compatible base URL |
| `GATEWAY_API_KEY` | — | Bearer key for the gateway |
| `CHAT_MODEL` | `anthropic.claude-3-7-sonnet` | Default model id |
| `MAX_TOOL_ROUNDS` | `8` | Max agentic tool-calling rounds per turn |
| `SKILLS_DIR` | `./skills` | Directory of `<skill>.md` files |

## Embedding in your own app

Frontend — drop the component into any standalone Angular app:

```ts
import { ChatComponent } from '@ng-chat/ui';
// <ng-chat api="/api/chat" />
```

Backend — mount the router into any Hono app:

```ts
import { createChatRouter, ToolRegistry, getTimeTool } from '@ng-chat/server';

app.route('/api/chat', createChatRouter({
  baseURL: process.env.GATEWAY_BASE_URL!,
  apiKey: process.env.GATEWAY_API_KEY,
  defaultModel: 'anthropic.claude-3-7-sonnet',
  tools: new ToolRegistry().register('get_time', getTimeTool),
}));
```

Because both sides speak the standard protocol, the client also works directly
against any other AI-SDK-compatible endpoint.

## Adding a tool

```ts
import { tool } from 'ai';
import { z } from 'zod';

registry.register('search_docs', tool({
  description: 'Search the knowledge base.',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => searchDocs(query),
}));
```

## License

MIT
