import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  signal,
} from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';

interface ReasoningPart {
  type: 'reasoning';
  text?: string;
  state?: 'streaming' | 'done' | string;
}

@Component({
  selector: 'ng-chat-reasoning-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, MatIconModule],
  template: `
    <mat-expansion-panel class="reasoning" [expanded]="part().state === 'streaming'">
      <mat-expansion-panel-header>
        <mat-panel-title class="reasoning-title">
          <mat-icon [class.spinning]="part().state === 'streaming'">lightbulb</mat-icon>
          <span>{{ label() }}</span>
        </mat-panel-title>
      </mat-expansion-panel-header>
      <div class="reasoning-body">{{ part().text }}</div>
    </mat-expansion-panel>
  `,
  styles: [`
    .reasoning { box-shadow: none; background: transparent; margin: 4px 0; }
    .reasoning-title { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.7; }
    .reasoning-title mat-icon { font-size: 16px; height: 16px; width: 16px; }
    .reasoning-body { font-size: 13px; opacity: 0.75; white-space: pre-wrap; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { animation: spin 1.4s linear infinite; }
  `],
})
export class ReasoningPanelComponent {
  readonly part = input.required<ReasoningPart>();

  protected readonly durationSecs = signal<number | null>(null);
  private startMs: number | null = null;

  constructor() {
    effect(() => {
      const state = this.part().state;
      // Reset on every new streaming start so a reused component instance
      // (same @index in the parts loop) gets a fresh clock for each turn.
      if (state === 'streaming') {
        this.startMs = Date.now();
        this.durationSecs.set(null);
      } else if (state === 'done' && this.startMs !== null) {
        this.durationSecs.set(Math.round((Date.now() - this.startMs) / 1000));
        this.startMs = null;
      }
    });
  }

  protected label(): string {
    if (this.part().state === 'streaming') return 'Thinking…';
    const secs = this.durationSecs();
    if (secs === null) return 'Reasoning';
    if (secs < 1) return 'Thought for a moment';
    return `Thought for ${secs}s`;
  }
}
