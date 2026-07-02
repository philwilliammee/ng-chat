import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import {
  ThinkingPreferenceService,
  type ThinkingLevel,
} from '../../../services/thinking-preference.service';

const LEVELS: { value: ThinkingLevel; label: string; hint: string }[] = [
  { value: 'disabled', label: 'Off', hint: 'No extended thinking' },
  { value: 'low', label: 'Low', hint: '~2k token budget' },
  { value: 'medium', label: 'Medium', hint: '~8k token budget' },
  { value: 'high', label: 'High', hint: '~16k token budget' },
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-settings',
  imports: [MatButtonToggleModule, MatCardModule, MatIconModule],
  template: `
    <div class="settings-page">
      <h1>Settings</h1>

      <mat-card class="setting-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>lightbulb</mat-icon>
          <mat-card-title>Thinking mode</mat-card-title>
          <mat-card-subtitle>Extended reasoning before the response (Claude 3.7+ only)</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <mat-button-toggle-group
            [value]="thinking.level()"
            (change)="thinking.setLevel($event.value)"
            aria-label="Thinking level">
            @for (opt of levels; track opt.value) {
              <mat-button-toggle [value]="opt.value">
                <span class="toggle-label">{{ opt.label }}</span>
                <span class="toggle-hint">{{ opt.hint }}</span>
              </mat-button-toggle>
            }
          </mat-button-toggle-group>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .settings-page { padding: 24px; max-width: 640px; }
    .setting-card { margin-bottom: 20px; }
    mat-card-content { padding-top: 16px; }
    mat-button-toggle-group { width: 100%; }
    mat-button-toggle { flex: 1; }
    .toggle-label { display: block; font-weight: 500; font-size: 13px; }
    .toggle-hint { display: block; font-size: 11px; opacity: 0.6; }
  `],
})
export class SettingsComponent {
  protected readonly thinking = inject(ThinkingPreferenceService);
  protected readonly levels = LEVELS;
}
