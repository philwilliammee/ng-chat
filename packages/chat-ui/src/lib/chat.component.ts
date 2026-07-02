import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterEveryRender,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { AbstractChat, DefaultChatTransport, type UIMessage } from 'ai';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MessageComponent, type ChatMessageLike } from './components/message.component';
import { MessageInputComponent, type SendPayload } from './components/message-input.component';
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
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TitleCasePipe, MessageComponent, MessageInputComponent],
  template: `
    <div class="chat">
      <div #scroller class="scroll" role="log" aria-live="polite" aria-label="Chat messages" aria-atomic="false">
        @if (chat && chat.messages.length > 0) {
          <div class="chat-toolbar">
            <button
              mat-icon-button
              class="download-btn"
              matTooltip="Download conversation"
              aria-label="Download conversation as JSON"
              (click)="downloadConversation()">
              <mat-icon>download</mat-icon>
            </button>
          </div>
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
        @if (thinkingLevel() && thinkingLevel() !== 'disabled') {
          <div class="thinking-badge">
            <mat-icon class="thinking-badge-icon">lightbulb</mat-icon>
            <span>Thinking: {{ thinkingLevel() | titlecase }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .scroll { flex: 1; overflow-y: auto; padding: 12px 16px; scroll-behavior: smooth; position: relative; }
    .chat-toolbar {
      display: flex; justify-content: flex-end;
      position: sticky; top: 0; z-index: 1;
      padding: 0 0 4px;
      background: transparent;
    }
    .download-btn { opacity: 0.4; transition: opacity 0.15s; }
    .download-btn:hover { opacity: 0.85; }
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
    .thinking-badge {
      display: flex; align-items: center; justify-content: center; gap: 3px;
      margin-top: 4px; font-size: 11px;
      color: var(--mat-sys-on-surface-variant, #49454f); opacity: 0.6;
    }
    .thinking-badge-icon { font-size: 12px; height: 12px; width: 12px; }
  `],
})
export class ChatComponent implements OnInit {
  /** Endpoint emitting the UI Message Stream Protocol. */
  readonly api = input('/api/chat');
  /** Optional model id sent in the request body for in-UI model switching. */
  readonly model = input<string | undefined>(undefined);
  /** Thinking level forwarded to the server: 'disabled' | 'low' | 'medium' | 'high' */
  readonly thinkingLevel = input<string | undefined>(undefined);
  /** Seed or replace the message list (e.g. loading a stored conversation). */
  readonly messages = input<UIMessage[]>([]);
  /** Stable ID for the active conversation — passed through to onFinish. */
  readonly conversationId = input<string | undefined>(undefined);
  readonly placeholder = input('Message the assistant…');
  readonly emptyTitle = input('Start a conversation');
  readonly emptyHint = input('Ask a question or give the assistant a task.');

  /** Emits after each complete assistant turn with the full message array and conversation id. */
  readonly finish = output<{ messages: UIMessage[]; id: string }>();

  protected chat!: AbstractChat<UIMessage>;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    afterEveryRender(() => {
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    });

    // Reload messages only when the conversation ID changes (i.e. the host switches
    // conversations). Reading messages via untracked() prevents the post-save signal
    // update from triggering this effect and resetting the live chat mid-session.
    effect(() => {
      this.conversationId(); // tracked — fires when conversation switches
      const msgs = untracked(() => this.messages());
      if (this.chat) this.chat.messages = msgs;
    });
  }

  ngOnInit(): void {
    this.chat = new NgChat<UIMessage>({
      id: this.conversationId(),
      messages: this.messages(),
      transport: new DefaultChatTransport({ api: this.api() }),
      onFinish: ({ messages }) => {
        this.finish.emit({ messages, id: this.conversationId() ?? this.chat.id });
      },
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

  protected onSend(payload: SendPayload): void {
    const extra: Record<string, unknown> = {};
    const model = this.model();
    if (model) extra['model'] = model;
    const thinkingLevel = this.thinkingLevel();
    if (thinkingLevel) extra['thinkingLevel'] = thinkingLevel;
    this.chat.sendMessage(
      { text: payload.text, files: payload.files.length ? payload.files : undefined },
      Object.keys(extra).length ? { body: extra } : undefined,
    );
  }

  protected onStop(): void {
    this.chat.stop();
  }

  protected asLike(message: UIMessage): ChatMessageLike {
    return message as unknown as ChatMessageLike;
  }

  protected downloadConversation(): void {
    const messages = this.chat?.messages;
    if (!messages?.length) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const payload = JSON.stringify(messages, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${ts}.json`;
    a.click();
    // Defer revoke — the browser fetches the blob asynchronously after click().
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
