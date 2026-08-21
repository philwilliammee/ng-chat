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
- **Token usage ring** — a subtle circular indicator next to the thinking badge shows context fill (empty → full circle = 0 → context limit); colour shifts amber at 75% and red at 90%.
- **Conversation history** — IndexedDB-backed multi-conversation storage via `@ng-chat/storage`; collapsible sidebar included.
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
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `60` / `60000` | Per-IP sliding window on the chat endpoints. `0` disables. |
| `TRUSTED_PROXY_HOPS` | `1` | Reverse proxies you control in front of this server. The limiter counts back this many entries from the end of `X-Forwarded-For`, since only proxy-appended entries are trustworthy. `0` = no proxy (every caller shares one bucket). |
| `CHAT_ENABLED` | `true` | `false` / `0` / `no` / `off` mounts a stub router that explains the feature is off instead of failing mid-stream. |
| `CHAT_MAX_MESSAGE_CHARS` / `CHAT_MAX_TOTAL_CHARS` / `CHAT_MAX_MESSAGES` | `100000` / `1000000` / `500` | Request size caps, checked before any model call. Sized as abuse backstops so pasting a source file still works — tighten by ~10× for anonymous callers. |

## Embedding in your own app

Frontend — drop the component into any standalone Angular app:

```ts
import { ChatComponent } from '@ng-chat/ui';
```

```html
<!-- minimal -->
<ng-chat api="/api/chat" />

<!-- with conversation history (see @ng-chat/storage below) -->
<ng-chat
  api="/api/chat"
  [messages]="history.activeMessages()"
  [conversationId]="history.activeId() ?? undefined"
  (finish)="history.saveConversation($event)" />
```

**`<ng-chat>` inputs / outputs**

| Name | Type | Description |
|------|------|-------------|
| `api` | `string` | Streaming endpoint URL (default `/api/chat`) |
| `model` | `string` | Model id forwarded in the POST body |
| `thinkingLevel` | `string` | `disabled \| low \| medium \| high` |
| `messages` | `UIMessage[]` | Seed or replace the message list (e.g. loading a stored conversation) |
| `conversationId` | `string` | Stable conversation ID passed through to `(finish)` |
| `placeholder` | `string` | Textarea placeholder text |
| `emptyTitle` | `string` | Heading shown when no messages exist |
| `emptyHint` | `string` | Sub-text shown when no messages exist |
| `contextLimit` | `number` | Context window size in tokens — scales the token-usage ring (default `200000`) |
| `(finish)` | `{ messages, id }` | Fires after each complete assistant turn — use to persist the conversation |

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

## Adding conversation history

`@ng-chat/storage` provides IndexedDB-backed multi-conversation storage with no server required.

```ts
import { ChatHistoryService, ChatSidebarComponent } from '@ng-chat/storage';
import { ChatComponent } from '@ng-chat/ui';

@Component({
  imports: [ChatComponent, ChatSidebarComponent],
  template: `
    <ng-chat-sidebar
      [conversations]="history.conversations()"
      [activeId]="history.activeId()"
      [collapsed]="sidebarCollapsed()"
      (newConversation)="history.newConversation()"
      (selectConversation)="history.selectConversation($event)"
      (deleteConversation)="history.deleteConversation($event)"
      (toggleCollapse)="sidebarCollapsed.update(v => !v)" />

    <ng-chat
      api="/api/chat"
      [messages]="history.activeMessages()"
      [conversationId]="history.activeId() ?? undefined"
      (finish)="history.saveConversation($event)" />
  `,
})
export class ChatPageComponent implements OnInit {
  readonly history = inject(ChatHistoryService);
  readonly sidebarCollapsed = signal(false);

  async ngOnInit() { await this.history.init(); }
}
```

`ChatHistoryService` stores `Conversation` records (id, title, messages, timestamps) in the browser's IndexedDB (`ng-chat-db`). It exposes Angular signals — `conversations`, `activeId`, `activeMessages` — so templates bind reactively with no boilerplate.

To use a different backend (server REST, localStorage, etc.) skip `@ng-chat/storage` entirely and wire `[messages]` and `(finish)` directly to your own service. See [`docs/conversation-history-strategies.md`](docs/conversation-history-strategies.md) for a full comparison of storage approaches.

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

This is a starter template, not a hardened production service. Some abuse controls ship in the
box; the ones that need a decision about *your* deployment do not.

Already here:

- **Per-IP rate limiting** on all three chat endpoints (`RATE_LIMIT_MAX`), keyed on a
  proxy-appended `X-Forwarded-For` entry — set `TRUSTED_PROXY_HOPS` to match your deployment,
  or the key is either client-forgeable or shared by every visitor
- **Request size caps** before any model call (`CHAT_MAX_*`), defaulted generously; tighten
  them by roughly an order of magnitude for anonymous callers. These bound what reaches the
  *model* — they count visible text on an already-parsed body, so they are not a byte limit
- **Model allowlist** — clients may only request a model in `ALLOWED_MODELS`
- **Content sandbox** — `read_file` / `search_files` reject paths outside `CONTENT_DIR`
- **Usage accounting** — per-turn token counts go to stdout, or to your own `onUsage` hook

Still yours to add before exposing it to the internet:

- **Authentication** — there is no auth on `/api/chat`. This is the big one: the caps above
  bound what one anonymous caller costs you, they do not stop them calling.
- **A body size limit** — add Hono's `bodyLimit()` to the POST routes, or cap the body at your
  proxy. The `CHAT_MAX_*` caps above do not do this.
- **CSRF protection** — no token check on the POST endpoints. Relevant as soon as the
  endpoints sit behind a cookie session. Note that `hono/csrf` will *not* do it: it only
  inspects form-like content types, so a JSON chat POST gets nothing.
- **CORS** — use Hono's `cors()` middleware if serving from a different origin
- **`sendReasoning: false`** — reasoning routinely narrates the system prompt and the tool
  surface. The default suits a trusted operator; switch it off for anyone else.
- **Alarming** — usage is reported, not watched

Each of these, plus the reasoning behind the shipped defaults, is written up in
[`docs/chat-hardening.md`](docs/chat-hardening.md).

## License

MIT
