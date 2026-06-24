import { AppRoute } from './app.routes';

export const AdminRoutes: AppRoute[] = [
  {
    path: '',
    redirectTo: 'chat',
    pathMatch: 'full',
    data: { menu: [] },
  },
  {
    path: 'chat',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/chat/chat-page.component').then(
        (m) => m.ChatPageComponent,
      ),
    data: {
      menu: ['admin'],
      icon: 'forum',
      title: 'Chat',
      path: 'admin/chat',
    },
    title: 'Chat',
  },
  {
    path: 'docs',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/admin/documentation/documentation.component').then(
        (m) => m.DocumentationComponent,
      ),
    data: {
      menu: ['admin'],
      icon: 'description',
      title: 'Documentation',
      path: 'admin/docs',
    },
    title: 'Documentation',
  },
  {
    path: 'settings',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/admin/settings/settings.component').then(
        (m) => m.SettingsComponent,
      ),
    data: {
      menu: ['admin'],
      icon: 'settings',
      title: 'Settings',
      path: 'admin/settings',
    },
    title: 'Settings',
  },
];
