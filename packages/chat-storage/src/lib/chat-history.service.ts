import { Injectable, computed, signal } from '@angular/core';
import type { UIMessage } from 'ai';
import { ConversationStore } from './conversation-store';
import type { Conversation } from './types';

/**
 * Angular service that wraps ConversationStore with signals.
 * Inject this, call init() once on app startup, then bind:
 *
 *   <ng-chat
 *     [messages]="history.activeMessages()"
 *     [conversationId]="history.activeId() ?? undefined"
 *     (finish)="history.saveConversation($event)" />
 */
@Injectable({ providedIn: 'root' })
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
