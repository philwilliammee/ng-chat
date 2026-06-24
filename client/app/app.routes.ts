import { Route } from '@angular/router';

export interface RouteData {
  menu: string[];
  title?: string;
  icon?: string;
  path?: string;
  roles?: string[]; // reserved for future auth guard
  [key: string]: any;
}

export interface AppRoute extends Route {
  data: RouteData;
  children?: AppRoute[];
}

export const routes: AppRoute[] = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'admin',
    data: { menu: [] },
  },
  {
    path: 'admin',
    // canActivate: [MultiRoleGuard], // enable when auth is added
    loadChildren: () =>
      import('./admin.routes').then((m) => m.AdminRoutes),
    data: {
      menu: [],
      // roles: ['admin'], // enable when auth is added
    },
    title: 'Admin',
  },
  {
    path: '**',
    redirectTo: 'admin',
    pathMatch: 'full',
    data: { menu: [] },
  },
];
