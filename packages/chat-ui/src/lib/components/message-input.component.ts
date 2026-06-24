import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'ng-chat-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="composer">
      <textarea
        #box
        class="field"
        rows="1"
        [placeholder]="placeholder()"
        [value]="draft()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"></textarea>

      @if (busy()) {
        <button mat-fab class="action stop" matTooltip="Stop" (click)="stop.emit()">
          <mat-icon>stop</mat-icon>
        </button>
      } @else {
        <button
          mat-fab
          class="action send"
          matTooltip="Send"
          [disabled]="!draft().trim()"
          (click)="submit()">
          <mat-icon>arrow_upward</mat-icon>
        </button>
      }
    </div>
    <div class="hint">Enter to send · Shift+Enter for a new line</div>
  `,
  styles: [`
    :host { display: block; }
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--mat-sys-outline-variant, #cac4d0);
      border-radius: 18px;
      background: var(--mat-sys-surface, #fff);
    }
    .composer:focus-within { border-color: var(--mat-sys-primary, #6750a4); }
    .field {
      flex: 1;
      align-self: stretch;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      font: inherit;
      font-size: 14px;
      line-height: 1.5;
      max-height: 200px;
      overflow-y: auto;
      color: var(--mat-sys-on-surface, #1c1b1f);
      padding: 6px 4px;
    }
    .action { box-shadow: none; flex: 0 0 auto; }
    .action.send { --mdc-fab-container-color: var(--mat-sys-primary, #6750a4); color: var(--mat-sys-on-primary, #fff); }
    .hint { font-size: 11px; opacity: 0.5; text-align: center; margin-top: 6px; }
  `],
})
export class MessageInputComponent {
  readonly placeholder = input('Message the assistant…');
  readonly busy = input(false);

  readonly send = output<string>();
  readonly stop = output<void>();

  protected readonly draft = signal('');
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    this.autoGrow(el);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(): void {
    const text = this.draft().trim();
    if (!text || this.busy()) return;
    this.send.emit(text);
    this.draft.set('');
    const el = this.box().nativeElement;
    el.value = '';
    this.autoGrow(el);
  }

  private autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.minHeight = 'auto';
    el.style.minHeight = `${Math.min(el.scrollHeight, 200)}px`;
  }
}
