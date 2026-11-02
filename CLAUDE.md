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

# Tests (vitest, 285 tests in 11 files)
npm run test
npm run test:watch
npm run test:coverage

# check + coverage — the gate before a PR
npm run verify
```

Run `npm run verify` before committing, not just `npm run check`. `check` is the
type-check plus production build; `verify` adds the coverage-gated suite. They are
separate so the fast one stays fast.

## Testing

Full detail is in [README.md → Testing](README.md#testing). The parts that change how you
write code here:

- **One config**, `vitest.config.ts`, covering server, client and the package.
  `environment: 'node'` — **components cannot be rendered**, deliberately. Services,
  guards, route tables and pure functions are what is reachable; see the README table.
- **`import '@angular/compiler';` must be the first import** of any client test that
  touches Angular DI or loads a component. Angular ships partially compiled and falls back
  to JIT here.
- **Server tests use `app.request()`** — a real `Response` through the whole middleware
  chain, no port, no supertest. For anything environment-dependent, `vi.stubEnv` +
  `vi.resetModules()` + dynamic `import()`: both `server/app.ts` and `server/app.config.ts`
  do their work at import time.
- **Assert `app.routes`, not status codes**, when the point is that a route is absent.
  `serveStatic` on `/*` answers 200 with the SPA shell once `dist/` exists.
- **Coverage floors are measured, not aspirational**, and per-glob. `server/**` and
  `client/app/**` are pinned at 100% on all four metrics — new code there needs a test in
  the same commit. The package's floors sit where the package actually is; the largest gap
  is `tools/file-editor/**` at ~5%, which is the obvious next piece of work.
- **One known defect is pinned by a test rather than fixed** — two `history.ts` edge
  cases in the package (`clipHistory` with no user messages; `splitForCompaction(msgs, 0)`).
  The test names the fix; flip its assertion in the same change. The other two found by
  this suite (rate-limit config `NaN`, `ChatConfigService`'s no-retry latch) are fixed.

## Architecture

This is a monorepo with three internal packages consumed as TypeScript source (no separate build step) via tsconfig path aliases:

| Alias | Source | Role |
|---|---|---|
| `@ng-chat/server` | `packages/chat-server/src/index.ts` | Hono router factory + tool registry |
| `@ng-chat/ui` | `packages/chat-ui/src/public-api.ts` | Angular signals chat components |
| `@ng-chat/storage` | `packages/chat-storage/src/public-api.ts` | IndexedDB conversation history (`ChatHistoryService` — provide per chat surface with `provideChatHistory()`, not in the root injector; `ChatSidebarComponent`) |

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
- `<ng-chat-markdown [text]="…">` — sanitized HTML from markdown text parts. `marked` and
  `dompurify` are loaded through `import()` on first render (`lib/markdown/markdown-renderer.ts`),
  so embedding chat in an app shell does not put ~70 kB of them in the initial bundle.
  `MarkdownPipe` is still exported and deprecated — a pipe cannot be async, so it can only
  import them statically

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

## Backfills from downstream forks

Two projects hold hand-ported forks of this template's chat stack and harden them in place.
When they do, the fixes come back here. Both directions are recorded so a future reader can
tell a deliberate divergence from an oversight.

**aisei-agent — backfilled 2026-07-04.** The lib/ split, F1 token fix, rate-limiter sweep,
buildTranscript, production build configs, and vitest suite. Nothing further pending.

**aisei-site — Tier 1 & 2 backfilled 2026-08-19.** XFF read from the trusted end,
`search_files` sandbox boundary, request size caps, `includeUsage`, usage logging, a stub
router for the unconfigured case, configurable `sendReasoning`. Three of those are
deliberately *not* verbatim ports — aisei-site is a public marketing site and this is a
template, so the hop count, the cap sizes, and the `sendReasoning` default all differ, with
the reasoning recorded inline. **CSRF and Tier 3 are still open** — CSRF because its token
plumbing crosses the `@ng-chat/server` ↔ `@ng-chat/ui` boundary and is a contract decision
rather than a bug fix. [docs/chat-hardening.md](docs/chat-hardening.md) has both halves — what
shipped in Part 1, what is still open in Part 2.

Two things to know before touching either:

- **CSRF.** `hono/csrf` only inspects form-like content types, so it provides **zero**
  protection on an `application/json` chat POST, and Angular's `HttpClient` XSRF interceptor
  never sees the streaming request because the AI SDK transport uses raw `fetch`.
- **The size caps are not a byte bound.** `checkRequestLimits` runs on an already-parsed body
  and counts visible text only; `file` and `tool-*` parts pass unmeasured. Bounding bytes needs
  `bodyLimit`, which is Part 2 §1 and deliberately not done.
