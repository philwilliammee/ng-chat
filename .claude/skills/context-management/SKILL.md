---
name: context-management
description: >
  Server-side context clipping, compact endpoint, close endpoint, and client compact UI.
  TRIGGER when: modifying context window handling, token counting, /compact or /close endpoints,
  the compact button, stripInlineFiles, or the memory save flow.
---

# Context Management

## Server-side clipping (`clipHistory`)

Every `POST /api/chat` call runs `clipHistory(messages, historyBudget)` before passing messages
to `streamText`. It drops the oldest user-turn boundaries until the estimated token count fits
within `historyBudget = contextLimit - 8000`.

```typescript
// packages/chat-server/src/chat-router.ts
function clipHistory(messages: UIMessage[], budget: number): UIMessage[]
function estimateMessagesTokens(messages: UIMessage[]): number
// uses gpt-tokenizer (cl100k_base BPE); +1000 per inline image
```

`contextLimit` comes from `ChatRouterConfig.contextLimit` (env: `CHAT_CONTEXT_LIMIT`, default 200 000).

## POST /compact

Summarises the full conversation into 3–6 sentences. No tools involved.

```
POST /api/chat/compact
Body: { messages: UIMessage[] }
Returns: { summary: string }
```

Client replaces `chat.messages` with a single assistant message containing the summary, then
resets `tokenUsage` to 0 and emits `finish` so the host saves the compacted conversation.

## POST /close

Runs the close skill to extract and persist memories from a conversation. Uses a `generateText`
tool loop — the model calls `write_file` to save facts to `skills/memories/`.

```
POST /api/chat/close
Body: { messages: UIMessage[] }
Returns: { filesWritten: string[] }
```

Loads `close.md` from `CONTENT_DIR`; falls back to a built-in instruction if the file is missing.
Uses `stopWhen: stepCountIs(maxRounds)` for the tool loop.

## Client compact button (`ChatComponent`)

```typescript
// packages/chat-ui/src/lib/chat.component.ts
protected readonly compacting = signal(false);
protected readonly tokenUsagePct = computed(() => this.tokenUsage() / this.contextLimit() * 100);
protected readonly canCompact = computed(
  () => this.tokenUsagePct() > 70 && (this._chat()?.messages.length ?? 0) > 2,
);
protected async compactConversation(): Promise<void>
```

Button appears in the sticky chat toolbar when `canCompact()` is true. Disabled while `busy()`.

## stripInlineFiles

Removes base64 `data:` URL file parts from user messages before the `finish` event is emitted
(and before IDB persistence). In-session display uses the live `chat.messages` signal and is unaffected.

```typescript
// called in onFinish:
this.finish.emit({ messages: stripInlineFiles(messages), id: ... });
```

## Archive button flow (sidebar → /close → chat notification)

1. User clicks archive icon on a sidebar conversation item
2. `ChatSidebarComponent` emits `closeConversation(id)`
3. `ChatPageComponent.onCloseConversation(id)` POSTs to `/api/chat/close`
4. On success, if the closed conversation is active, calls `chatComp().injectUserMessage(...)` with the saved file list
5. `ChatComponent.injectUserMessage(text)` calls `this.chat.sendMessage({ text })` — triggers a live AI turn acknowledging the save

## Token ring

Real token counts come from `messageMetadata` on the SSE finish event:

```typescript
// server: chat-router.ts — onStepFinish accumulates outputTokens
messageMetadata: ({ part }) =>
  part.type === 'finish'
    ? { totalUsage: { promptTokens, completionTokens, totalTokens } }
    : undefined
// client: chat.component.ts onFinish
const tokens = meta?.totalUsage?.totalTokens;
if (tokens) this.tokenUsage.set(tokens);
```
