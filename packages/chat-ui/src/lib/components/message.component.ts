import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MarkdownPipe } from '../pipes/markdown.pipe';
import { ToolCallComponent, type ToolPart } from './tool-call.component';

interface MessagePart {
  type: string;
  text?: string;
  state?: string;
  [key: string]: unknown;
}

export interface ChatMessageLike {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: MessagePart[];
}

@Component({
  selector: 'ng-chat-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, MatIconModule, MarkdownPipe, ToolCallComponent],
  template: `
    <div class="row" [class.user]="isUser()" [class.assistant]="!isUser()">
      <div class="bubble">
        @for (part of message().parts; track $index) {
          @switch (kind(part)) {
            @case ('text') {
              @if (isUser()) {
                <div class="text user-text">{{ part.text }}</div>
              } @else {
                <div class="text" [innerHTML]="part.text | ngChatMarkdown"></div>
              }
            }
            @case ('reasoning') {
              <mat-expansion-panel class="reasoning" [expanded]="part.state === 'streaming'">
                <mat-expansion-panel-header>
                  <mat-panel-title class="reasoning-title">
                    <mat-icon>lightbulb</mat-icon>
                    <span>Reasoning</span>
                  </mat-panel-title>
                </mat-expansion-panel-header>
                <div class="reasoning-body">{{ part.text }}</div>
              </mat-expansion-panel>
            }
            @case ('tool') {
              <ng-chat-tool-call [part]="asTool(part)" />
            }
          }
        }
        @if (streaming()) {
          <span class="cursor">▋</span>
        }
      </div>
    </div>
  `,
  styles: [`
    .row { display: flex; margin: 10px 0; }
    .row.user { justify-content: flex-end; }
    .row.assistant { justify-content: flex-start; }
    .bubble {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.6;
    }
    .row.user .bubble {
      background: var(--mat-sys-primary-container, #e8def8);
      color: var(--mat-sys-on-primary-container, #1d192b);
      border-bottom-right-radius: 4px;
    }
    .row.assistant .bubble {
      background: var(--mat-sys-surface-container, #f3edf7);
      color: var(--mat-sys-on-surface, #1c1b1f);
      max-width: 92%;
      border-bottom-left-radius: 4px;
    }
    .user-text { white-space: pre-wrap; word-break: break-word; }
    .reasoning { box-shadow: none; background: transparent; margin: 4px 0; }
    .reasoning-title { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.7; }
    .reasoning-title mat-icon { font-size: 16px; height: 16px; width: 16px; }
    .reasoning-body { font-size: 13px; opacity: 0.75; white-space: pre-wrap; }
    .cursor { display: inline-block; margin-left: 1px; animation: ngc-blink 1s step-end infinite; }
    @keyframes ngc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
    .text :first-child { margin-top: 0; }
    .text :last-child { margin-bottom: 0; }
    ::ng-deep .text p { margin: 0 0 8px; }
    ::ng-deep .text pre { background: rgba(0,0,0,0.06); padding: 10px 12px; border-radius: 8px; overflow-x: auto; margin: 6px 0; }
    ::ng-deep .text code { font-family: 'Roboto Mono', monospace; font-size: 12.5px; background: rgba(0,0,0,0.07); padding: 1px 5px; border-radius: 4px; }
    ::ng-deep .text pre code { background: none; padding: 0; }
    ::ng-deep .text ul { margin: 4px 0 8px; padding-left: 20px; }
    ::ng-deep .text a { color: var(--mat-sys-primary, #6750a4); }
  `],
})
export class MessageComponent {
  readonly message = input.required<ChatMessageLike>();
  readonly streaming = input(false);

  protected readonly isUser = computed(() => this.message().role === 'user');

  protected kind(part: MessagePart): 'text' | 'reasoning' | 'tool' | 'other' {
    if (part.type === 'text') return 'text';
    if (part.type === 'reasoning') return 'reasoning';
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) return 'tool';
    return 'other';
  }

  protected asTool(part: MessagePart): ToolPart {
    return part as unknown as ToolPart;
  }
}
