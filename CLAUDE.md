# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (Angular :4200 + Hono :4315 with hot reload)
npm run dev

# Type-check everything (server TS + Angular build)
npm run check

# Production build (Angular client into dist/client/browser)
npm run build

# Run server only (requires built client for static serving)
npm run start

# Build client then serve via the Hono server
npm run run:local
```

No test suite is configured. Type-check with `npm run check` before committing.

## Architecture

This is a monorepo with three internal packages consumed as TypeScript source (no separate build step) via tsconfig path aliases:

| Alias | Source | Role |
|---|---|---|
| `@ng-chat/server` | `packages/chat-server/src/index.ts` | Hono router factory + tool registry |
| `@ng-chat/ui` | `packages/chat-ui/src/public-api.ts` | Angular signals chat components |
| `@ng-chat/storage` | `packages/chat-storage/src/public-api.ts` | IndexedDB conversation history (`ChatHistoryService`, `ChatSidebarComponent`) |

The `server/` and `client/` directories are the demo app wiring these packages together. The two sides communicate exclusively via the **Vercel AI SDK UI Message Stream Protocol** (SSE), so either can be replaced independently.

### Server (`packages/chat-server`)

- `createChatRouter(config)` — builds a Hono sub-app with two endpoints:
  - `GET /config` — returns model, context limit, and registered tool names to the client
  - `POST /` — streaming endpoint; calls `streamText` with an agentic tool loop (`stopWhen: stepCountIs(maxRounds)`) and returns a UI Message Stream via SSE
- `ChatRouterConfig.defaultThinkingLevel` — server-side fallback thinking level (`'disabled' | 'low' | 'medium' | 'high'`); the client overrides it per-request via the `thinkingLevel` body field. Uses `transformRequestBody` to inject `thinking: { type: 'enabled', budget_tokens: N }` directly into the raw gateway request (required because `createOpenAICompatible` does not forward `providerOptions.anthropic`).
- `ToolRegistry` — a `Map<string, Tool>` wrapper; chain `.register(name, tool)` calls; pass to `createChatRouter` as `tools`
- Built-in tools: `getTimeTool` (demo) and `createUseSkillTool` (async — pre-reads skill names at startup and embeds them in the tool description to prevent speculative listing calls)

The demo server (`server/app.ts`) mounts the chat router at `/api/chat` and serves the built Angular client from `dist/client/browser`.

### Client (`packages/chat-ui`)

All components are standalone, OnPush, signals-based (Angular 21). No NgModules anywhere.

- `<ng-chat api="/api/chat">` — the top-level chat surface; backed by `NgChat` (see below)
  - `[thinkingLevel]` input — `'disabled' | 'low' | 'medium' | 'high'`; forwarded in the POST body so the server can activate extended thinking per-turn
  - Download button (sticky toolbar) — exports the current conversation as a JSON file
- `<ng-chat-message>` — renders message parts: `text` (user plain / assistant markdown), `reasoning` (delegated to `<ng-chat-reasoning-panel>`), `tool-*` / `dynamic-tool` (delegated to `<ng-chat-tool-call>`)
- `<ng-chat-reasoning-panel>` — collapsible panel for reasoning parts; shows "Thinking…" with a spinner during streaming and "Thought for Ns" when done
- `<ng-chat-input>` — textarea with send/stop controls
- `MarkdownPipe` — sanitized HTML from markdown text parts

**`NgChatState` / `NgChat`** (`ng-chat-state.ts`) — we do not use `Chat` from `@ai-sdk/angular`. The SDK's `AngularChatState.replaceMessage` stores the same mutated `activeResponse.state.message` reference on every streaming chunk; `MessageComponent`'s `input.required` signal sees no reference change and OnPush never re-renders mid-stream. `NgChatState` fixes this with a shallow-clone in `replaceMessage`. `NgChat` is a concrete `AbstractChat` subclass that wires `NgChatState` in.

The demo Angular app (`client/`) consumes `<ng-chat>` inside an admin layout at the `/admin/chat` route.

### Skills system

Skills are plain `.md` files in `skills/`. The `use_skill` tool (registered by default in the demo server) lets the model load skill instructions on demand. Add a new skill by dropping `skills/<name>.md`; no code changes needed.

### Environment

Copy `.env.example` to `.env` and set `GATEWAY_API_KEY`. Key vars:

| Var | Default |
|---|---|
| `GATEWAY_BASE_URL` | `https://api.openai.com/v1` |
| `GATEWAY_API_KEY` | — (required) |
| `CHAT_MODEL` | `gpt-4o-mini` |
| `MAX_TOOL_ROUNDS` | `8` |
| `SKILLS_DIR` | `./skills` |
| `THINKING_DEFAULT_LEVEL` | `disabled` |

Dev mode proxies Angular's `/api/*` to `localhost:4315` via `proxy.conf.json`.
