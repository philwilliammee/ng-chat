import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'lib-admin-toolbar',
  imports: [MatToolbarModule, MatIconModule, MatButtonModule],
  template: `
    <mat-toolbar>
      @if (showToggle()) {
        <button mat-icon-button aria-label="Toggle navigation" (click)="toggleSidenav.emit()">
          <mat-icon>menu</mat-icon>
        </button>
      }
      <div class="full-width center">
        <ng-content />
      </div>
    </mat-toolbar>
  `,
  styles: `
    mat-toolbar {
      background-color: var(--primary, #2d668e);
      color: white;
    }
    mat-icon {
      color: white;
    }
  `,
})
export class AdminToolbarComponent {
  readonly showToggle = input(true);
  readonly toggleSidenav = output<void>();
  readonly toggleSidenavNotice = output<void>();
}
