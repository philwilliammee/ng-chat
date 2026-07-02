# ng-chat

An open-source **Angular + Hono agent chat** base template, built on the
[Vercel AI SDK **UI Message Stream Protocol**](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol).

The frontend and backend are fully decoupled — they communicate only through the
standard UI Message Stream Protocol, so either side can be swapped, embedded into
an existing app, or pointed at any compatible endpoint.

## Highlights

- **Standard protocol** — no bespoke wire format. Uses the AI SDK data stream (SSE).
- **Agentic tool loop** — the model can call tools to take actions and fetch data.
- **Reasoning** — streamed chain-of-thought rendered in a collapsible "Thought for Ns" panel; thinking level (off / low / medium / high) is configurable per-user in Settings.
- **Conversation download** — export any chat session as a JSON file for persistence or debugging.
- **Pluggable tools** — register AI SDK `tool()`s; ships with a default `use_skill`
  (document-based memory) and a `get_time` demo tool.
- **Cornell AI Gateway** — talks to any OpenAI-compatible endpoint (LiteLLM).
- **Signals + standalone components** — Angular 21, OnPush, zero legacy modules.
- **Runs in Docker** — single container serving the Angular client and Hono API.

## Monorepo layout

| Path | Package | Role |
|------|---------|------|
| `packages/chat-ui` | `@ng-chat/ui` | Angular components: `<ng-chat>`, message/tool/input/reasoning UI |
| `packages/chat-server` | `@ng-chat/server` | Hono `createChatRouter()` + tool registry + gateway provider |
| `packages/chat-storage` | `@ng-chat/storage` | IndexedDB conversation history: `ChatHistoryService`, sidebar |
| `client/` | — | Demo Angular app (uses `@ng-chat/ui` + `@ng-chat/storage` in the admin layout) |
| `server/` | — | Demo Hono server (mounts `@ng-chat/server`) |
| `skills/` | — | Markdown skills loaded on demand by the `use_skill` tool |

Packages are consumed as TypeScript source via tsconfig path aliases — the Angular
compiler builds `@ng-chat/ui`, and `tsx` runs `@ng-chat/server`. No separate
library build step.

## Prerequisites

- [Node.js 24+](https://nodejs.org/) — `node --version` to check
- An OpenAI-compatible API endpoint and key (OpenAI, Ollama, LiteLLM, Anthropic, etc.)

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
| `GATEWAY_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `GATEWAY_API_KEY` | — | Bearer key for the gateway |
| `CHAT_MODEL` | `gpt-4o-mini` | Default model id |
| `MAX_TOOL_ROUNDS` | `8` | Max agentic tool-calling rounds per turn |
| `CHAT_CONTEXT_LIMIT` | `200000` | Max context tokens passed to the model |
| `SKILLS_DIR` | `./skills` | Directory of `<skill>.md` files |
| `THINKING_DEFAULT_LEVEL` | `disabled` | Server-side default thinking level (`disabled \| low \| medium \| high`). Clients override per-turn via Settings. Only effective with Claude 3.7+ on an Anthropic-compatible gateway. |

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
  defaultModel: 'gpt-4o-mini',
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

## Adding a skill

Skills are plain Markdown files that the model loads on demand — no code changes needed.

Drop a `.md` file in the `skills/` directory:

```bash
echo "# My Skill\n\nInstructions for the assistant..." > skills/my-skill.md
```

The `use_skill` tool discovers it automatically. The model calls `use_skill({ name: 'my-skill' })` to load the instructions mid-conversation.

## Security & production hardening

This is a starter template, not a hardened production service. Before exposing it to the internet:

- **Add authentication** — there is no auth on `/api/chat` by default
- **Add rate limiting** — the chat endpoint accepts unlimited requests
- **Restrict model selection** — clients can pass any `model` in the request body; add an allowlist if needed
- **Add CORS** — use Hono's `cors()` middleware if serving from a different origin

These are intentionally omitted to keep the template simple.

## License

MIT
