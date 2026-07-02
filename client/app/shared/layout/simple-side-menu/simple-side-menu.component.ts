import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatDrawerMode, MatSidenavModule } from '@angular/material/sidenav';
import { RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AdminToolbarComponent } from '../admin-toolbar/admin-toolbar.component';
import { AppRoute } from '../../../app.routes';

@Component({
  selector: 'lib-simple-side-menu',
  imports: [
    RouterModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    MatSidenavModule,
    MatListModule,
    MatToolbarModule,
    AdminToolbarComponent,
  ],
  template: `
    <mat-drawer-container>
      <mat-drawer
        #drawer
        [opened]="opened()"
        class="sidenav"
        [mode]="mode()"
        autosize
        [class.mobile]="isMobileLayout()"
      >
        <mat-toolbar class="sidebar-logo">
          <a routerLink="/">
            @if (svgIconUrl()) {
              <img
                alt="Logo"
                [src]="svgIconUrl()"
                [style.height]="imgHeight()"
                [style.width]="'auto'"
              />
            }
            {{ title() }}
          </a>
        </mat-toolbar>

        <mat-nav-list>
          @for (route of routes(); track route) {
            @if (route.data) {
              <a
                mat-list-item
                [routerLink]="route.data['path']"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: false }"
                (click)="handleLinkClick()"
                class="menu-link rounded-none"
              >
                <span class="full-flex align-items-center">
                  <span>
                    @if (route.data['icon']) {
                      <mat-icon matListIcon>
                        {{ route.data['icon'] }}
                      </mat-icon>
                    }
                  </span>
                  <span class="pl font-size-larger">
                    {{
                      route.data && route.data['title']
                        ? route.data['title']
                        : route.data['path'] || route.path
                    }}
                  </span>
                </span>
              </a>
            }
          }
        </mat-nav-list>
      </mat-drawer>

      <mat-drawer-content>
        <lib-admin-toolbar
          (toggleSidenav)="handleToggleClick()"
          (toggleSidenavNotice)="handleToggleClick()"
        >
          <ng-content select="[toolbar]" />
        </lib-admin-toolbar>
        <ng-content />
      </mat-drawer-content>
    </mat-drawer-container>
  `,
  styleUrls: ['./simple-side-menu.component.scss'],
})
export class SimpleSideMenuComponent implements OnInit {
  readonly routes = input.required<AppRoute[]>();
  readonly title = input('');
  readonly showToggle = input(true);
  readonly svgIconUrl = input('');
  readonly imgHeight = input('45px');
  mode = signal<MatDrawerMode>('side');
  opened = signal(true);

  private readonly destroyRef = inject(DestroyRef);
  private readonly windowWidth = signal(window.innerWidth);
  readonly isMobileLayout = computed(() => this.windowWidth() <= 768);

  constructor() {
    const handler = () => this.windowWidth.set(window.innerWidth);
    window.addEventListener('resize', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', handler));
  }

  ngOnInit(): void {
    const savedToggleState = localStorage.getItem('simple-side-menu-toggle');
    if (savedToggleState) {
      this.opened.set(savedToggleState === 'true');
    } else if (this.isMobileLayout()) {
      this.mode.set('over');
      this.opened.set(false);
    } else {
      this.mode.set('side');
      this.opened.set(true);
    }
  }

  handleLinkClick() {
    if (this.isMobileLayout()) {
      this.handleToggleClick();
    }
  }

  handleToggleClick() {
    this.opened.update((current) => !current);
    localStorage.setItem('simple-side-menu-toggle', this.opened().toString());
  }
}
