import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatComponent } from '@ng-chat/ui';
import { ChatHistoryService, ChatSidebarComponent } from '@ng-chat/storage';
import { ThinkingPreferenceService } from '../../services/thinking-preference.service';
import { ModelPreferenceService } from '../../services/model-preference.service';
import { ChatConfigService } from '../../services/chat-config.service';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatComponent, ChatSidebarComponent],
  template: `
    <div class="chat-page">
      <div class="history-panel" [class.collapsed]="sidebarCollapsed()">
        <ng-chat-sidebar
          [conversations]="history.conversations()"
          [activeId]="history.activeId()"
          [collapsed]="sidebarCollapsed()"
          (newConversation)="history.newConversation()"
          (selectConversation)="history.selectConversation($event)"
          (deleteConversation)="history.deleteConversation($event)"
          (closeConversation)="onCloseConversation($event)"
          (importConversation)="history.importConversation($event)"
          (toggleCollapse)="sidebarCollapsed.update(v => !v)"
          [closingConversationId]="closingConversationId()" />
      </div>
      <div class="chat-panel">
        <ng-chat
          api="/api/chat"
          emptyTitle="ng-chat"
          emptyHint="An open-source Angular + Hono agent chat. Ask a question or give the assistant a task."
          [thinkingLevel]="thinkingPreference.level()"
          [model]="modelPreference.selected()"
          [messages]="history.activeMessages()"
          [conversationId]="history.activeId() ?? undefined"
          [contextLimit]="contextLimit()"
          (finish)="history.saveConversation($event)" />
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: calc(100vh - 64px); overflow: hidden; }
    .chat-page { display: flex; height: 100%; }
    .history-panel {
      width: 260px;
      flex-shrink: 0;
      border-right: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      transition: width 0.22s ease;
      overflow: hidden;
    }
    .history-panel.collapsed { width: 48px; }
    .chat-panel { flex: 1; min-width: 0; }
  `],
})
export class ChatPageComponent implements OnInit {
  protected readonly thinkingPreference = inject(ThinkingPreferenceService);
  protected readonly modelPreference = inject(ModelPreferenceService);
  protected readonly chatConfig = inject(ChatConfigService);
  protected readonly history = inject(ChatHistoryService);
  protected readonly sidebarCollapsed = signal(false);
  protected readonly contextLimit = signal(200_000);
  protected readonly closingConversationId = signal<string | null>(null);

  private readonly chatComp = viewChild(ChatComponent);

  private readonly http = inject(HttpClient);

  async onCloseConversation(id: string): Promise<void> {
    const conv = this.history.conversations().find(c => c.id === id);
    if (!conv?.messages.length || this.closingConversationId()) return;
    this.closingConversationId.set(id);
    try {
      const result = await firstValueFrom(
        this.http.post<{ filesWritten: string[] }>('/api/chat/close', { messages: conv.messages }),
      );
      if (id === this.history.activeId() && result.filesWritten?.length) {
        const files = result.filesWritten.join(', ');
        this.chatComp()?.injectUserMessage(
          `[Memories saved: ${files}. You can load them with the memory skill.]`,
        );
      }
    } catch (e) {
      console.error('Memory save failed', e);
    } finally {
      this.closingConversationId.set(null);
    }
  }

  async ngOnInit(): Promise<void> {
    await this.history.init();
    this.chatConfig.load('/api/chat');
    this.http.get<{ contextLimit?: number }>('/api/chat/config').subscribe({
      next: cfg => { if (cfg.contextLimit) this.contextLimit.set(cfg.contextLimit); },
    });
  }
}
