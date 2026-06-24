import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterEveryRender,
  input,
  viewChild,
} from '@angular/core';
import { AbstractChat, DefaultChatTransport, type UIMessage } from 'ai';
import { MatIconModule } from '@angular/material/icon';
import { MessageComponent, type ChatMessageLike } from './components/message.component';
import { MessageInputComponent } from './components/message-input.component';
import { NgChat } from './ng-chat-state';

/**
 * `<ng-chat>` — a self-contained, signals-based chat surface.
 *
 * Backed by `NgChat` (an `AbstractChat` subclass with Angular signal state), it
 * speaks the UI Message Stream Protocol and works against any compatible
 * endpoint. Drop it into any standalone Angular app:
 *
 *   <ng-chat api="/api/chat" />
 */
@Component({
  selector: 'ng-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MessageComponent, MessageInputComponent],
  template: `
    <div class="chat">
      <div #scroller class="scroll">
        @if (chat && chat.messages.length > 0) {
          @for (message of chat.messages; track message.id) {
            <ng-chat-message
              [message]="asLike(message)"
              [streaming]="isStreaming(message.id)" />
          }
        } @else {
          <div class="empty">
            <mat-icon class="empty-icon">forum</mat-icon>
            <h2>{{ emptyTitle() }}</h2>
            <p>{{ emptyHint() }}</p>
          </div>
        }
      </div>

      <div class="composer-wrap">
        <ng-chat-input
          [placeholder]="placeholder()"
          [busy]="busy()"
          (send)="onSend($event)"
          (stop)="onStop()" />
        @if (errorText()) {
          <div class="error-banner">
            <mat-icon>error</mat-icon>
            <span>{{ errorText() }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .scroll { flex: 1; overflow-y: auto; padding: 12px 16px; scroll-behavior: smooth; }
    .composer-wrap { padding: 12px 16px 16px; }
    .empty {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--mat-sys-on-surface-variant, #49454f);
      gap: 4px;
    }
    .empty-icon { font-size: 48px; height: 48px; width: 48px; opacity: 0.7; }
    .empty h2 { margin: 8px 0 0; font-weight: 500; }
    .empty p { margin: 0; opacity: 0.7; }
    .error-banner {
      display: flex; align-items: center; gap: 8px;
      margin-top: 8px; padding: 8px 12px; border-radius: 8px;
      background: var(--mat-sys-error-container, #f9dedc);
      color: var(--mat-sys-on-error-container, #410e0b);
      font-size: 13px;
    }
    .error-banner mat-icon { font-size: 18px; height: 18px; width: 18px; }
  `],
})
export class ChatComponent implements OnInit {
  /** Endpoint emitting the UI Message Stream Protocol. */
  readonly api = input('/api/chat');
  /** Optional model id sent in the request body for in-UI model switching. */
  readonly model = input<string | undefined>(undefined);
  readonly placeholder = input('Message the assistant…');
  readonly emptyTitle = input('Start a conversation');
  readonly emptyHint = input('Ask a question or give the assistant a task.');

  protected chat!: AbstractChat<UIMessage>;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    afterEveryRender(() => {
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    });
  }

  ngOnInit(): void {
    this.chat = new NgChat<UIMessage>({
      transport: new DefaultChatTransport({ api: this.api() }),
    });
  }

  protected busy(): boolean {
    const s = this.chat?.status;
    return s === 'submitted' || s === 'streaming';
  }

  protected errorText(): string | undefined {
    return this.chat?.error?.message;
  }

  protected isStreaming(id: string): boolean {
    if (this.chat?.status !== 'streaming') return false;
    const msgs = this.chat.messages;
    const last = msgs[msgs.length - 1];
    return !!last && last.id === id && last.role === 'assistant';
  }

  protected onSend(text: string): void {
    const model = this.model();
    this.chat.sendMessage({ text }, model ? { body: { model } } : undefined);
  }

  protected onStop(): void {
    this.chat.stop();
  }

  protected asLike(message: UIMessage): ChatMessageLike {
    return message as unknown as ChatMessageLike;
  }
}
