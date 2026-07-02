import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ChatComponent } from '@ng-chat/ui';
import { ChatHistoryService, ChatSidebarComponent } from '@ng-chat/storage';
import { ThinkingPreferenceService } from '../../services/thinking-preference.service';

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
          (toggleCollapse)="sidebarCollapsed.update(v => !v)" />
      </div>
      <div class="chat-panel">
        <ng-chat
          api="/api/chat"
          emptyTitle="ng-chat"
          emptyHint="An open-source Angular + Hono agent chat. Ask a question or give the assistant a task."
          [thinkingLevel]="thinkingPreference.level()"
          [messages]="history.activeMessages()"
          [conversationId]="history.activeId() ?? undefined"
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
  protected readonly history = inject(ChatHistoryService);
  protected readonly sidebarCollapsed = signal(false);

  async ngOnInit(): Promise<void> {
    await this.history.init();
  }
}
