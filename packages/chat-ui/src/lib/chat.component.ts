import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterEveryRender,
  computed,
  effect,
  input,
  output,
  signal,
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
        <div class="status-row">
          @if (thinkingLevel() && thinkingLevel() !== 'disabled') {
            <span class="thinking-badge">
              <mat-icon class="thinking-badge-icon">lightbulb</mat-icon>
              <span>Thinking: {{ thinkingLevel() | titlecase }}</span>
            </span>
          }
          @if (tokenUsage() > 0) {
            <span class="token-badge" [matTooltip]="tokenUsageLabel()" matTooltipPosition="above">
              <svg class="token-ring" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="token-ring-bg" cx="12" cy="12" r="9" />
                <circle class="token-ring-fill" cx="12" cy="12" r="9"
                  [style.stroke-dashoffset]="tokenRingOffset()"
                  [style.stroke]="tokenRingStroke()" />
              </svg>
            </span>
          }
        </div>
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
    .status-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 4px; min-height: 20px;
    }
    .thinking-badge {
      display: flex; align-items: center; gap: 3px; font-size: 11px;
      color: var(--mat-sys-on-surface-variant, #49454f); opacity: 0.6;
    }
    .thinking-badge-icon { font-size: 12px; height: 12px; width: 12px; }
    .token-badge {
      display: flex; align-items: center; cursor: default; opacity: 0.55;
      transition: opacity 0.15s;
    }
    .token-badge:hover { opacity: 0.85; }
    .token-ring {
      width: 16px; height: 16px; flex-shrink: 0;
      transform: rotate(-90deg);
    }
    .token-ring-bg {
      fill: none; stroke: var(--mat-sys-on-surface-variant, #49454f);
      stroke-width: 2.5; opacity: 0.25;
    }
    .token-ring-fill {
      fill: none; stroke: var(--mat-sys-on-surface-variant, #49454f);
      stroke-width: 2.5; stroke-dasharray: 56.55; stroke-linecap: round;
      transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;
    }
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
  /** Context window size in tokens (used to scale the usage ring). Default: 200 000. */
  readonly contextLimit = input<number>(200_000);

  private readonly _chat = signal<AbstractChat<UIMessage> | null>(null);
  protected get chat(): AbstractChat<UIMessage> { return this._chat()!; }

  // Updated with real token counts from the server after each assistant turn.
  protected readonly tokenUsage = signal(0);

  // 2 * π * 9 (radius) ≈ 56.55
  private static readonly RING_CIRCUMFERENCE = 56.55;

  protected readonly tokenRingOffset = computed(() => {
    const progress = Math.min(this.tokenUsage() / this.contextLimit(), 1);
    return ChatComponent.RING_CIRCUMFERENCE * (1 - progress);
  });

  protected readonly tokenRingStroke = computed(() => {
    const ratio = this.tokenUsage() / this.contextLimit();
    if (ratio > 0.9) return 'var(--mat-sys-error, #b3261e)';
    if (ratio > 0.75) return 'var(--mat-sys-tertiary, #7d5260)';
    return null; // inherit from CSS
  });

  protected readonly tokenUsageLabel = computed(() => {
    const used = this.tokenUsage();
    const limit = this.contextLimit();
    const pct = Math.round((used / limit) * 100);
    return `${(used / 1000).toFixed(1)}k / ${(limit / 1000).toFixed(0)}k tokens (${pct}%)`;
  });

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
      untracked(() => this.tokenUsage.set(0));
    });
  }

  ngOnInit(): void {
    this._chat.set(new NgChat<UIMessage>({
      id: this.conversationId(),
      messages: this.messages(),
      transport: new DefaultChatTransport({ api: this.api() }),
      onFinish: ({ message, messages }) => {
        const meta = (message as { metadata?: { totalUsage?: { totalTokens?: number } } }).metadata;
        const tokens = meta?.totalUsage?.totalTokens;
        if (tokens) this.tokenUsage.set(tokens);
        this.finish.emit({ messages, id: this.conversationId() ?? this.chat.id });
      },
    }));
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
