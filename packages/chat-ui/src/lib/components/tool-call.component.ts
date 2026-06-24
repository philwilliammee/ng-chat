import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/** A tool-related UI message part (`tool-<name>` or `dynamic-tool`). */
export interface ToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

@Component({
  selector: 'ng-chat-tool-call',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <mat-expansion-panel class="tool-panel" [class.skill]="isSkill()">
      <mat-expansion-panel-header>
        <mat-panel-title class="tool-title">
          @if (running()) {
            <mat-spinner [diameter]="14" />
          } @else if (errored()) {
            <mat-icon class="state-icon error">error</mat-icon>
          } @else {
            <mat-icon class="state-icon ok">{{ isSkill() ? 'psychology' : 'check_circle' }}</mat-icon>
          }
          <span class="tool-name">{{ label() }}</span>
          <span class="tool-state">{{ stateLabel() }}</span>
        </mat-panel-title>
      </mat-expansion-panel-header>

      @if (hasInput()) {
        <div class="section-label">Request</div>
        <pre class="payload">{{ formattedInput() }}</pre>
      }
      @if (errored()) {
        <div class="section-label">Error</div>
        <pre class="payload error-text">{{ part().errorText }}</pre>
      } @else if (hasOutput()) {
        <div class="section-label">Response</div>
        <pre class="payload">{{ formattedOutput() }}</pre>
      }
    </mat-expansion-panel>
  `,
  styles: [`
    .tool-panel { margin: 6px 0; box-shadow: none; border: 1px solid var(--mat-sys-outline-variant, #cac4d0); border-radius: 10px; }
    .tool-panel.skill { border-color: var(--mat-sys-primary, #6750a4); }
    .tool-title { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .tool-name { font-weight: 600; }
    .tool-state { font-size: 11px; opacity: 0.6; text-transform: lowercase; }
    .state-icon { font-size: 16px; height: 16px; width: 16px; }
    .state-icon.ok { color: var(--mat-sys-primary, #4a7c59); }
    .state-icon.error { color: var(--mat-sys-error, #b3261e); }
    .section-label { font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.55; margin: 8px 0 2px; }
    .payload { font-family: 'Roboto Mono', monospace; font-size: 12px; background: var(--mat-sys-surface-container-high, #ece6f0); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 0; white-space: pre-wrap; word-break: break-word; }
    .payload.error-text { color: var(--mat-sys-error, #b3261e); }
  `],
})
export class ToolCallComponent {
  readonly part = input.required<ToolPart>();

  protected readonly isSkill = computed(() => this.label() === 'use_skill');
  protected readonly running = computed(() => {
    const s = this.part().state;
    return s === 'input-streaming' || s === 'input-available';
  });
  protected readonly errored = computed(() => this.part().state === 'output-error');

  protected readonly label = computed(() => {
    const p = this.part();
    if (p.type === 'dynamic-tool') return p.toolName ?? 'tool';
    return p.type.startsWith('tool-') ? p.type.slice('tool-'.length) : p.type;
  });

  protected readonly stateLabel = computed(() => {
    switch (this.part().state) {
      case 'input-streaming': return 'preparing…';
      case 'input-available': return 'running…';
      case 'output-available': return 'done';
      case 'output-error': return 'failed';
      default: return '';
    }
  });

  protected readonly hasInput = computed(() => this.part().input !== undefined);
  protected readonly hasOutput = computed(() => this.part().output !== undefined);
  protected readonly formattedInput = computed(() => format(this.part().input));
  protected readonly formattedOutput = computed(() => format(this.part().output));
}

function format(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
