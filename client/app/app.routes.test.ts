// The two route tables.
//
// These are plain data, so they are the cheapest useful client tests in the repo
// and the ones that catch the most. The nav sidebar is generated from
// `data.menu` and `data.path`, so a typo there is a menu entry that renders and
// then 404s — invisible to `ng build` and to `tsc --noEmit` alike.
//
// The lazy loaders matter more than they look. `loadChildren` and `loadComponent`
// are arrow functions holding a dynamic `import()`; neither the compiler nor the
// type-checker ever calls them, so a renamed or moved export type-checks, builds,
// ships, and fails at runtime the first time someone clicks the link. Invoking
// them here is the only cheap way to catch that.
// This import must stay first and must not be dropped as unused. Angular ships
// its packages partially compiled and falls back to JIT in this environment, so
// without it the `loadComponent` cases below fail with "the injectable
// 'PlatformLocation' needs to be compiled using the JIT compiler".
import '@angular/compiler';
import { describe, it, expect } from 'vitest';
import type { Route } from '@angular/router';
import { routes, type AppRoute } from './app.routes';
import { AdminRoutes } from './admin.routes';

/** Every route in both tables, flattened. */
const all: AppRoute[] = [...routes, ...AdminRoutes];

describe('shape', () => {
  it('gives every route a data object with a menu array', () => {
    // The `AppRoute` interface requires `data`, but `data.menu` being an array is
    // a runtime contract the sidebar depends on — it iterates it unguarded.
    for (const route of all) {
      expect(route.data, `${route.path} has no data`).toBeDefined();
      expect(Array.isArray(route.data.menu), `${route.path}.data.menu`).toBe(true);
    }
  });

  it('has no duplicate paths within a table', () => {
    for (const table of [routes, AdminRoutes]) {
      const paths = table.map((r) => r.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});

describe('top-level routes', () => {
  it('redirects the site root to admin', () => {
    const root = routes.find((r) => r.path === '');

    expect(root).toMatchObject({ pathMatch: 'full', redirectTo: 'admin' });
  });

  it('puts the wildcard last', () => {
    // Angular matches in order, so a `**` route anywhere but the end swallows
    // every route below it. This one assertion is worth the whole file.
    expect(routes.at(-1)?.path).toBe('**');
    expect(routes.filter((r) => r.path === '**')).toHaveLength(1);
  });

  it('sends unknown paths to admin rather than to a 404 page', () => {
    // A deliberate choice for a single-surface app: there is no 404 component to
    // route to. Change this when a public surface is added.
    expect(routes.at(-1)).toMatchObject({ redirectTo: 'admin', pathMatch: 'full' });
  });

  it('keeps the admin route free of guards, matching the commented-out auth', () => {
    // ng-chat ships unauthenticated. `canActivate` and `data.roles` are both
    // present as comments in app.routes.ts, and this test is the reminder that
    // enabling one without the other is the failure mode: `multiRoleGuard` with
    // an absent-or-empty `data.roles` reads as "public", so a route can carry a
    // guard and still be wide open. If you uncomment the guard, uncomment the
    // roles and change this test in the same commit.
    const admin = routes.find((r) => r.path === 'admin')!;

    expect(admin.canActivate).toBeUndefined();
    expect(admin.data.roles).toBeUndefined();
  });
});

describe('admin routes', () => {
  it('redirects the admin index to chat', () => {
    expect(AdminRoutes.find((r) => r.path === '')).toMatchObject({
      redirectTo: 'chat',
      pathMatch: 'full',
    });
  });

  it('shows exactly chat, docs and settings in the sidebar', () => {
    const menu = AdminRoutes.filter((r) => r.data.menu.includes('admin'));

    expect(menu.map((r) => r.path)).toEqual(['chat', 'docs', 'settings']);
  });

  it('gives every menu entry a title and an icon', () => {
    // Both are read by the sidebar template. A missing icon renders as the
    // literal ligature text, a missing title renders as blank.
    for (const route of AdminRoutes.filter((r) => r.data.menu.length > 0)) {
      expect(route.data.title, `${route.path}.data.title`).toBeTruthy();
      expect(route.data.icon, `${route.path}.data.icon`).toBeTruthy();
    }
  });

  it('prefixes every data.path with the parent segment', () => {
    // `data.path` is what the sidebar links to, and it is absolute while `path`
    // is relative to the lazy-loaded parent. Writing `chat` instead of
    // `admin/chat` produces a link that resolves against the current URL and
    // works from exactly one page.
    for (const route of AdminRoutes.filter((r) => r.data.menu.length > 0)) {
      expect(route.data.path).toBe(`admin/${route.path}`);
    }
  });

  it('keeps the route title in sync with the menu title', () => {
    // `title` sets the browser tab, `data.title` the sidebar label. They drift.
    for (const route of AdminRoutes.filter((r) => r.data.menu.length > 0)) {
      expect(route.title, `${route.path}`).toBe(route.data.title);
    }
  });
});

describe('lazy loaders resolve', () => {
  it("loads the admin children and exports them as 'AdminRoutes'", async () => {
    const admin = routes.find((r) => r.path === 'admin')!;
    expect(admin.loadChildren).toBeTypeOf('function');

    const loaded = await (admin.loadChildren as () => Promise<unknown>)();

    // Identity, not just truthiness: this asserts the loader reaches the same
    // table the rest of this file is asserting against.
    expect(loaded).toBe(AdminRoutes);
  });

  const lazy = AdminRoutes.filter((r): r is AppRoute & { loadComponent: NonNullable<Route['loadComponent']> } =>
    typeof r.loadComponent === 'function',
  );

  it('has a loadComponent on all three leaf routes', () => {
    // Guards the `it.each` below: an empty list would make it vacuously green.
    expect(lazy).toHaveLength(3);
  });

  it.each(lazy.map((r) => [r.path, r] as const))(
    'resolves the component for %s',
    async (_path, route) => {
      // The only test in the client suite that actually executes an app module.
      // It catches a renamed export, a moved file, and a module-level throw in
      // anything the component imports.
      const component = await (route.loadComponent as () => Promise<unknown>)();

      expect(component).toBeTypeOf('function');
      expect((component as { name: string }).name).toBeTruthy();
    },
  );
});
