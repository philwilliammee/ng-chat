import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule, Routes } from '@angular/router';

// This component implements the main menu.
// As outlined in https://www.w3.org/WAI/ARIA/apg/example-index/menubar/menubar-navigation.html
@Component({
  selector: 'lib-main-menu',
  template: `
    <nav
      class="dropdown-menu"
      id="main-navigation"
      aria-label="Main Navigation"
    >
      <div class="container-fluid">
        <ul class="list-menu links">
          @for (route of routes(); track $index) {
            @if (route.data) {
              <li
                class="top-level-item parent top-level-li"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: true }"
              >
                @if (!route.children) {
                  <a
                    mat-button
                    routerLink="{{ route.path }}"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: true }"
                  >
                    <span class="flex gap align-items-center">
                      @if (route.data['icon']) {
                        <mat-icon>{{ route.data['icon'] }}</mat-icon>
                      }
                      {{ route.title ? route.title : route.path }}
                      @if (route.data && route.data['class'] === 'ext-link') {
                        <mat-icon class="ext-link"> launch </mat-icon>
                      }
                    </span>
                  </a>
                } @else {
                  <!-- <a mat-button routerLink="{{route.path}}">{{route.path}}</a> -->
                  <button
                    mat-button
                    [matMenuTriggerFor]="menu"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: true }"
                  >
                    {{ route.title && route.title ? route.title : route.path }}
                    <mat-icon>expand_more</mat-icon>
                  </button>
                  <mat-menu #menu="matMenu" backdropClass="main-menu-backdrop">
                    @for (child of route.children; track child) {
                      <a
                        mat-menu-item
                        routerLink="{{ route.path }}/{{ child.path }}"
                        routerLinkActive="active"
                        [routerLinkActiveOptions]="{ exact: true }"
                      >
                        {{
                          child.title && child.title ? child.title : child.path
                        }}
                      </a>
                    }
                  </mat-menu>
                }
                <ng-template #parent>
                  <!-- <a mat-button routerLink="{{route.path}}">{{route.path}}</a> -->
                  <!-- <button mat-button [matMenuTriggerFor]="menu"
            routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}">
            {{route.title && route.title ? route.title : route.path}}
            <mat-icon>expand_more</mat-icon>
          </button>
          <mat-menu #menu="matMenu" backdropClass="main-menu-backdrop">
            @for (child of route.children; track child) {
            <a mat-menu-item routerLink="{{route.path}}/{{child.path}}"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{exact: true}">
              {{child.title && child.title ? child.title : child.path}}
            </a>
            }
          </mat-menu> -->
                </ng-template>
                <!-- <a routerLink="{{route.path}}" >
              {{route.path}}
            </a>
            <ul *ngIf="route.children" class="list-menu links vertical children" style="min-width: 138px;">
              <ng-container *ngFor="let child of route.children">
                <li
                  *ngIf="child.title && child.title['menu'] == route.path"
                  routerLinkActive="active"
                  [routerLinkActiveOptions]="{exact: true}">
                  <a
                    routerLink="{{child.path}}"
                  >{{child.path}}</a>
                </li>
              </ng-container>
            </ul> -->
              </li>
            }
          }
        </ul>
      </div>
    </nav>
  `,
  styleUrls: ['./main-menu.component.scss'],
  imports: [MatMenuModule, MatIconModule, MatButtonModule, RouterModule],
})
export class MainMenuComponent {
  readonly routes = input.required<Routes>();
}
