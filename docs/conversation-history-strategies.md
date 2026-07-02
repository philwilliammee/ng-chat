# Conversation History — Current State & Storage Strategies

## Current State

### What exists today

ng-chat is **fully stateless**. Messages live only in an Angular `signal<UIMessage[]>([])` inside `NgChatState`. The server receives the full message array on every POST and stores nothing between requests. On page reload every conversation is gone.

**Message lifecycle:**

```
User sends → NgChatState.pushMessage() → POST /api/chat with full messages[]
           ← SSE stream chunks → NgChatState.replaceMessage() (shallow-clone, OnPush safe)
           ← onFinish fires with final UIMessage[]
```

**Shape of a stored message** (`UIMessage` from the `ai` SDK):

```ts
interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: unknown;
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string; state?: string }
    | { type: 'tool-<name>'; toolCallId?: string; state?: string; input?: unknown; output?: unknown }
    | { type: 'dynamic-tool'; toolName?: string; state?: string; input?: unknown; output?: unknown }
    | { type: 'step-start' }
    // … SourceUrl, SourceDocument, File, Data
  >;
}
```

### Integration points that already exist

`NgChat` (the `AbstractChat` subclass) accepts a `ChatInit<UIMessage>` config object with four hooks that matter for storage:

| Hook | How to use it |
|---|---|
| `messages?: UIMessage[]` | Seed a conversation with pre-loaded messages at construction time |
| `id?: string` | Assign a stable conversation ID (used to key into storage) |
| `onFinish` | Fires after every complete assistant turn — ideal save trigger |
| `onError` | Fires on transport failure — useful to flag dirty/unsaved state |

**Gap:** `ChatComponent` currently constructs `NgChat` with only a `transport` option; `messages`, `id`, and `onFinish` are never wired up. `NgChat` is also not exported from `packages/chat-ui/src/public-api.ts`. Both need to be addressed before any storage integration can be done from outside the package.

---

## Why Storage Belongs Outside the Library

ng-chat is a reusable component package. Baking in a specific storage backend would:

- Force a dependency on every consumer (IndexedDB, HTTP client, etc.)
- Dictate a schema that may not fit the host app's data model
- Prevent multi-device sync, SSO-gated servers, compliance requirements, or custom retention policies

The right boundary: **ng-chat exposes clean hooks, consumers own the storage adapter**.

---

## Storage Strategies

### Strategy 1 — No Persistence (current)

Messages are ephemeral; each page load starts fresh.

**Appropriate when:** The chat is a one-off assistant panel (help widget, code explainer) where session continuity is not expected.

**Nothing to implement.** This is the default.

---

### Strategy 2 — localStorage / sessionStorage

The simplest client-side option. Store the active conversation as JSON under a fixed key.

```ts
// Minimal adapter
const STORAGE_KEY = 'ng-chat:messages';

export function loadMessages(): UIMessage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch { return []; }
}

export function saveMessages(messages: UIMessage[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}
```

Wire into `ChatComponent`:

```ts
this.chat = new NgChat({
  id: 'default',
  messages: loadMessages(),
  transport: new DefaultChatTransport({ api: this.api() }),
  onFinish: ({ messages }) => saveMessages(messages),
});
```

**Pros:** Zero dependencies, synchronous, works offline.

**Cons:**
- 5–10 MB quota; base64 images or long conversations will hit it quickly.
- Only one conversation at a time (or requires manual key namespacing).
- No search, no listing, no cross-tab sync.
- `sessionStorage` variant clears on tab close — useful for security-sensitive contexts.

**Use when:** Single active conversation, no history browser needed, quick integration.

---

### Strategy 3 — IndexedDB (client-side, multi-conversation)

Modeled after the `ChatHistoryService` in `ssit/ssit-tool-kit`. Handles hundreds of conversations with no server required.

**Recommended schema:**

```ts
interface Conversation {
  id: string;              // crypto.randomUUID()
  title: string;           // first 60 chars of first user message
  model: string;           // from GET /api/chat/config
  createdAt: number;       // Date.now()
  updatedAt: number;       // Date.now() — indexed for sorted retrieval
  messages: UIMessage[];   // full ai-sdk UIMessage array (serialisable as-is)
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
}
```

**Minimal service** (zero external dependencies, plain IDB Promises):

```ts
const DB_NAME = 'ng-chat-db';
const DB_VERSION = 1;
const STORE = 'conversations';

class ConversationStore {
  private db: IDBDatabase | null = null;

  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_updated', 'updatedAt');
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }

  async save(conv: Conversation): Promise<void> {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(conv);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  async loadAll(): Promise<Conversation[]> { /* index('by_updated').getAll() + reverse */ }
  async load(id: string): Promise<Conversation | null> { /* objectStore.get(id) */ }
  async delete(id: string): Promise<void> { /* objectStore.delete(id) */ }
  async clear(): Promise<void> { /* objectStore.clear() */ }
}

export const conversationStore = new ConversationStore();
```

**Wire-in pattern** (host app Angular component):

```ts
import { signal, computed } from '@angular/core';

export class ChatPageComponent {
  conversations = signal<Conversation[]>([]);
  activeId = signal<string | null>(null);

  async newConversation() {
    const id = crypto.randomUUID();
    const conv: Conversation = { id, title: 'New chat', messages: [], ... };
    await conversationStore.save(conv);
    this.conversations.update(list => [conv, ...list]);
    this.activeId.set(id);
  }

  async selectConversation(id: string) {
    const conv = await conversationStore.load(id);
    if (conv) { this.activeId.set(id); /* pass conv.messages as initial messages */ }
  }
}
```

**ngChat integration:**

```html
<ng-chat
  [api]="'/api/chat'"
  [messages]="activeConversation()?.messages ?? []"
  [conversationId]="activeId()"
  (finish)="onFinish($event)"
/>
```

> This requires `ChatComponent` to accept `messages` and `conversationId` as inputs and wire `onFinish` through to `NgChat`. See [Required Library Changes](#required-library-changes).

**Pros:** Works offline, large capacity (~GBs, quota-managed by browser), no server, multi-conversation, fast reads.

**Cons:** Browser-local only — no cross-device sync. Cleared by "clear site data" or private browsing. No full-text search without a client-side index.

**ssit-tool-kit reference:** `client/app/features/admin/ai-tool-kit/chat-history.service.ts` — directly portable, minimal adaptation needed to swap `ChatMessage` for `UIMessage`.

---

### Strategy 4 — Server-Side REST API

The pattern used by open-webui. Full conversations are persisted server-side; the browser is stateless.

**Minimal server contract:**

```
GET    /api/conversations           → list (id, title, updatedAt, model)
POST   /api/conversations           → create → { id }
GET    /api/conversations/:id       → full Conversation with messages
PUT    /api/conversations/:id       → upsert (title + messages after each turn)
DELETE /api/conversations/:id
```

**Server schema (SQL — PostgreSQL / SQLite via Drizzle / Prisma):**

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  model       TEXT NOT NULL,
  messages    JSONB NOT NULL DEFAULT '[]',
  pinned      BOOLEAN DEFAULT FALSE,
  archived    BOOLEAN DEFAULT FALSE,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX conversations_user_updated ON conversations(user_id, updated_at DESC);
```

**`onFinish` save trigger** (Angular service):

```ts
async onTurnFinish(convId: string, messages: UIMessage[]) {
  const title = deriveTitle(messages);
  await fetch(`/api/conversations/${convId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, messages, updatedAt: Date.now() }),
  });
}
```

**Pros:** Cross-device sync, full-text search, admin oversight, audit trails, backup/restore, multi-user. `messages` is just a JSON column — works with ng-chat's `UIMessage` schema directly.

**Cons:** Requires auth infrastructure. Server maintains state (more ops burden). Network required.

**open-webui reference:** `src/lib/apis/chats/index.ts` + `backend/open_webui/models/chats.py`. Their message tree format (keyed dict + `parentId`/`childrenIds`) is more complex than necessary for a linear conversation; ng-chat's flat `UIMessage[]` array is simpler and maps directly to a JSON column.

---

### Strategy 5 — Hybrid (IndexedDB + Server Sync)

Start with IndexedDB for offline-first UX; sync to server in the background.

```
Write:  save locally (IndexedDB) → respond immediately
        then sync to server (best-effort, retry on failure)

Read:   load from local cache
        background-refresh from server if stale

Conflict: last-write-wins on `updatedAt` (sufficient for single-user chats)
```

A `SyncService` wraps `ConversationStore` and adds:
- A `pendingSync: Set<string>` for conversations that haven't been pushed
- On `onFinish`: save to IDB, add to `pendingSync`, fire `syncToServer(id)`
- On app init: `syncAllPending()` to flush anything queued offline
- On `loadAll()`: return local data immediately, then refresh from server

**Pros:** Offline-capable with cross-device sync. Best UX.
**Cons:** Most complex to implement. Eventual consistency — two devices editing the same conversation simultaneously will overwrite each other (acceptable for personal chat assistants).

---

## Comparison Matrix

| | localStorage | IndexedDB | Server REST | Hybrid |
|---|:---:|:---:|:---:|:---:|
| Setup effort | Low | Medium | High | High |
| Works offline | Yes | Yes | No | Yes |
| Multi-conversation | Possible | Yes | Yes | Yes |
| Cross-device | No | No | Yes | Yes |
| Storage limit | ~5 MB | ~GBs | Unlimited | ~GBs |
| Full-text search | No | No | Yes | Possible |
| Multi-user / auth | No | No | Yes | Yes |
| Audit / compliance | No | No | Yes | Yes |
| Dependency added | None | None | HTTP + Auth | IDB + HTTP |

---

## Required Library Changes

Before any storage strategy can be wired in from outside the package, three changes are needed in `packages/chat-ui`:

### 1. Export `NgChat` and `NgChatState`

`packages/chat-ui/src/public-api.ts` currently only exports components. Add:

```ts
export { NgChat } from './lib/ng-chat-state';
export { NgChatState } from './lib/ng-chat-state';
```

### 2. Add `messages`, `conversationId`, and `(finish)` to `ChatComponent`

```ts
@Component({ ... })
export class ChatComponent {
  api = input.required<string>();
  messages = input<UIMessage[]>([]);
  conversationId = input<string | undefined>(undefined);
  finish = output<{ messages: UIMessage[]; id: string }>();

  ngOnInit() {
    this.chat = new NgChat({
      id: this.conversationId() ?? crypto.randomUUID(),
      messages: this.messages(),
      transport: new DefaultChatTransport({ api: this.api() }),
      onFinish: ({ messages }) =>
        this.finish.emit({ messages, id: this.chat.id }),
    });
  }
}
```

### 3. React to `messages` input changes (conversation switch)

When the host app loads a different conversation, `ChatComponent` must reinitialise `NgChat` with the new messages. Use an `effect()`:

```ts
effect(() => {
  const msgs = this.messages();
  if (this.chat) this.chat.setMessages(msgs);
});
```

---

## Recommended Path

For a flexible library default, implement **Strategy 3 (IndexedDB)** as an optional, tree-shakeable adapter package:

```
packages/
  chat-ui/        ← core (no storage dep)
  chat-storage/   ← optional: ConversationStore + Angular service + sidebar component
    src/
      lib/
        conversation-store.ts   ← raw IDB CRUD
        chat-history.service.ts ← @Injectable wrapper with signals
        chat-sidebar.component.ts
      public-api.ts
```

This way:
- Zero-dependency core stays zero-dependency
- Consumers who want history `import { ChatHistoryService } from '@ng-chat/storage'`
- Consumers with their own backend skip the package entirely and wire `onFinish` directly
- The `ConversationStore` interface can be mocked or replaced (e.g., swap IDB for a REST adapter) without touching the core library

**Server-side storage** is left entirely to the host application; ng-chat's role is to fire `onFinish` with the final message array and stay out of the way.

---

## References

- `ssit/ssit-tool-kit` — `ChatHistoryService` (IndexedDB, zero-deps, portable pattern)
- `open-webui` — `backend/open_webui/models/chats.py` (server-side SQL schema + dual-write)
- `open-webui` — `src/lib/apis/chats/index.ts` (REST client pattern)
- `ai` SDK — `AbstractChat.ChatInit` (hook signatures: `onFinish`, `messages`, `id`)
- `packages/chat-ui/src/lib/ng-chat-state.ts` — current signals implementation
