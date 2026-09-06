import { Injectable, computed, signal, type Provider } from '@angular/core';
import type { UIMessage } from 'ai';
import { ConversationStore } from './conversation-store';
import type { Conversation } from './types';

/**
 * Angular service that wraps ConversationStore with signals.
 *
 * Provided per chat surface, not in the root injector — see provideChatHistory() below.
 * Add it to the providers of the component hosting the chat, call init() once in that
 * component's ngOnInit, then bind:
 *
 *   <ng-chat
 *     [messages]="history.activeMessages()"
 *     [conversationId]="history.activeId() ?? undefined"
 *     (finish)="history.saveConversation($event)" />
 */
@Injectable()
export class ChatHistoryService {
  private readonly store = new ConversationStore();

  readonly conversations = signal<Conversation[]>([]);
  readonly activeId = signal<string | null>(null);

  readonly activeMessages = computed<UIMessage[]>(() => {
    const id = this.activeId();
    return this.conversations().find(c => c.id === id)?.messages ?? [];
  });

  async init(): Promise<void> {
    if (this.activeId() !== null) return;
    const all = await this.store.loadAll();
    this.conversations.set(all);
    if (all.length > 0) {
      this.activeId.set(all[0].id);
    } else {
      await this.newConversation();
    }
  }

  async newConversation(model?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: 'New conversation',
      model,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(conv);
    this.conversations.update(list => [conv, ...list]);
    this.activeId.set(id);
    return id;
  }

  selectConversation(id: string): void {
    this.activeId.set(id);
  }

  async saveConversation({ id, messages }: { id: string; messages: UIMessage[] }): Promise<void> {
    const now = Date.now();
    const existing = this.conversations().find(c => c.id === id);
    // Upsert: create a record if this id was never explicitly created (e.g. NgChat auto-generated it).
    const base: Conversation = existing ?? { id, title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
    const updated: Conversation = {
      ...base,
      title: deriveTitle(messages, base.title),
      messages,
      updatedAt: now,
    };
    await this.store.save(updated);
    this.conversations.update(list => {
      const next = existing ? list.map(c => (c.id === id ? updated : c)) : [updated, ...list];
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    if (!existing) this.activeId.set(id);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.store.delete(id);
    this.conversations.update(list => list.filter(c => c.id !== id));
    if (this.activeId() === id) {
      this.activeId.set(this.conversations()[0]?.id ?? null);
    }
    if (this.conversations().length === 0) {
      await this.newConversation();
    }
  }

  async importConversation(conv: Conversation): Promise<void> {
    const now = Date.now();
    const imported: Conversation = {
      ...conv,
      id: conv.id ?? crypto.randomUUID(),
      updatedAt: now,
    };
    await this.store.save(imported);
    this.conversations.update(list => [imported, ...list].sort((a, b) => b.updatedAt - a.updatedAt));
    this.activeId.set(imported.id);
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
    this.conversations.set([]);
    this.activeId.set(null);
  }
}

function deriveTitle(messages: UIMessage[], fallback: string): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return fallback;
  const textPart = first.parts?.find(
    (p): p is { type: 'text'; text: string } => p.type === 'text',
  );
  return textPart?.text.slice(0, 60).trim() || fallback;
}

/**
 * Provide one ChatHistoryService for the component hosting a chat.
 *
 * Deliberately not `providedIn: 'root'`: a root-scoped history is a single conversation
 * list and a single activeId shared by every chat on the page, so a second chat surface —
 * a docked panel beside a full chat page, two chats in a split view — silently switches
 * the first one's conversation and writes its messages into it. There is nothing to see in
 * the DOM and nothing in the console; it looks like the store losing messages.
 *
 * Scoping it to the host makes each surface its own history, and makes a *missing*
 * provider a loud NullInjectorError at construction rather than a quiet data merge.
 * Consumers that genuinely want one shared history put this in their app config instead.
 *
 *   @Component({ providers: [provideChatHistory()] })
 */
export function provideChatHistory(): Provider[] {
  return [ChatHistoryService];
}
