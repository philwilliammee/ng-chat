---
name: chat-streaming
description: >
  NgChatState and NgChat — Angular signals-based chat state that fixes OnPush streaming.
  TRIGGER when: modifying chat state, streaming behavior, message rendering, or Angular change
  detection in the chat UI. DO NOT TRIGGER when: editing unrelated components or server code.
---

# Chat Streaming — NgChatState / NgChat

**Problem:** The AI SDK's `AbstractChat` mutates a single `activeResponse.state.message` object in
place on every SSE chunk and passes the same reference to `replaceMessage`. The upstream
`AngularChatState` stores that reference directly, so Angular's `===` equality check on signal
inputs sees no change — `MessageComponent` and `ToolCallComponent` (both `OnPush`) never re-render
mid-stream.

**Fix:** `NgChatState.replaceMessage` shallow-clones the message AND each part, producing new
references at every level.

## Location

```
packages/chat-ui/src/lib/ng-chat-state.ts
```

## Migration path (do not switch yet)

We intentionally keep `NgChat`/`NgChatState` rather than using `Chat` from `@ai-sdk/angular`.
The upstream `AngularChatState.replaceMessage` does `copy[index] = message` — same object
reference — so OnPush signal inputs never fire. Switching to Default CD is not an acceptable
workaround: it traverses the entire component tree on every SSE chunk (O(components × bindings)),
which is more expensive at scale than our O(messages + parts) shallow clone.

When `@ai-sdk/angular` fixes their `replaceMessage` to clone parts (a one-line change upstream),
the migration is:

```typescript
// chat.component.ts — remove:
import { NgChat } from './ng-chat-state';
this.chat = new NgChat({ transport: new DefaultChatTransport({ api: this.api() }) });

// replace with:
import { Chat } from '@ai-sdk/angular';
this.chat = new Chat({ api: this.api() });
```

`ng-chat-state.ts` can then be deleted.

## replaceMessage — critical implementation

```typescript
replaceMessage = (index: number, message: M): void => {
  this.#messages.update(msgs => {
    const copy = [...msgs];
    copy[index] = {
      ...message,
      parts: (message.parts ?? []).map(p => ({ ...p })),
    };
    return copy;
  });
};
```

Both levels of cloning are required:
- Cloning only the message (not parts) → `ToolCallComponent` misses tool-state transitions
- Cloning only the parts array (not the message) → `MessageComponent` misses text-chunk updates

## Usage

```typescript
// chat.component.ts
import { NgChat } from './ng-chat-state';
import { DefaultChatTransport } from 'ai';

this.chat = new NgChat({ transport: new DefaultChatTransport({ api: this.api() }) });
```

`NgChat` extends `AbstractChat` and wires in `NgChatState` automatically — no other setup needed.

## Streaming data flow

```
User → NgChat.sendMessage() → POST /api/chat (SSE)
  ↓ each chunk
  NgChatState.replaceMessage(i, shallowClone(message))
  → signal.update([...msgs, { ...msg, parts: parts.map(p => ({...p})) }])
  → MessageComponent / ToolCallComponent signal input receives new ref
  → OnPush re-render fires
```
