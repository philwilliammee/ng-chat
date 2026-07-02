import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AdminLayoutComponent } from './shared/layout/admin-layout/admin-layout.component';
import { AppRoute } from './app.routes';
import { AdminRoutes } from './admin.routes';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    AdminLayoutComponent,
  ],
  template: `
    <lib-admin-layout
      [routes]="adminRoutes"
      [toolbarTitle]="title"
    >
      <span toolbar>{{ title }}</span>
    </lib-admin-layout>
  `,
  styles: `
    :host { display: block; min-height: 100vh; }
  `,
})
export class AppComponent {
  title = 'NG Chat';

  adminRoutes: AppRoute[] = AdminRoutes.filter((r) =>
    r.data.menu.includes('admin'),
  );
}
