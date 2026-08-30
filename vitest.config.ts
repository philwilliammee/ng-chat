import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// One config for the whole repo — the package, the service and the client.
// Five choices here are deliberate; each prevents a specific failure seen
// elsewhere in aii-workspace.
//
// 1. `include` covers server/ and client/ as well as packages/. Before this it
//    was `packages/chat-server/**` only, so `npm test` reported green while the
//    two directories a project actually edits had no tests at all.
//
// 2. `dist/**` is excluded. `npm run build:server` compiles server/ to
//    dist/server/; Vitest's default globs are **/*.test.?s, so a compiled test
//    would run twice — once as .ts, once as .js — passing both times. The
//    tsconfig.build.json files keep tests out of dist in the first place; this
//    is the second line of defence, and the one that still holds if someone
//    runs plain `tsc`.
//
// 3. `environment: 'node'` — no jsdom, no happy-dom, no @analogjs/vitest-angular.
//    Components are therefore NOT renderable. That is a dependency decision, not
//    an oversight: see README → Testing for what is reachable instead. Every
//    project in aii-workspace that tests today made the same call.
//
// 4. `globals` is left at its default (false) — import describe/it/expect from
//    'vitest' explicitly. Keeps test files honest ESM, no ambient types needed.
//
// 5. Coverage thresholds are per-glob and set at MEASURED coverage. The floors
//    that were here before were a flat aspirational 70% on
//    packages/chat-server/src/lib/**, and they were RED: functions 65%,
//    branches 66.66%. Nobody saw it, because `check` ran `vitest run` rather
//    than `vitest run --coverage`, so the gate existed without ever being
//    consulted. A floor above where the code sits is not a target, it is a
//    broken build waiting to be deleted — measure, then set, then ratchet.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'client/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'packages/*/dist/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // What this list does and does not do, because it surprised us:
      //
      // Under `client/` it is a real filter — the route tests invoke every
      // `loadComponent`, so three components ARE executed, and they stay out of
      // the report because they are not listed here. That is intended: with no
      // DOM a component's class body runs and its template never does, so its
      // coverage number would be noise, and averaging it into `client/app/**`
      // would bury the services that are genuinely covered.
      //
      // Under `packages/` it is not a filter at all. v8 reports every file the
      // suite executes there whatever this list says (narrowing it to
      // `lib/**` still produced rows for chat-router.ts and all of tools/), so
      // the whole tree is listed explicitly to keep the report honest about what
      // is being measured. The `thresholds` globs below, not this list, are what
      // actually constrain anything.
      //
      // Note `server/**/*.ts`, NOT `server/**`. A bare `**` hands the v8
      // provider the JSONC tsconfigs to parse as JavaScript; it fails with a
      // PARSE_ERROR naming neither the file nor the reason.
      include: [
        'server/**/*.ts',
        'client/app/*.routes.ts',
        'client/app/services/**/*.ts',
        'packages/chat-server/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        // Entry point — binds a port and calls serve(). Nothing to assert that
        // app.test.ts does not already cover against the exported app.
        'server/index.ts',
      ],
      // Measured 2026-08-24 across 280 tests in 11 files. Every floor is at or
      // one point below the real number, so each is a ratchet: new code without
      // a test fails the gate.
      //
      // The two directories a project built on this template edits — server/ and
      // client/ — are at 100% on all four metrics and are pinned there. That is
      // the point of the template: the copy you start from has no untested lines
      // in the code you are about to change.
      //
      // The package is a different case. It is the upstream copy of chat-server
      // (see docs/ on the four divergent copies), it is large, and it was
      // already partly tested. Floors are set where it actually sits so the
      // numbers stay visible rather than aspirational:
      //
      //   lib/**            ~97% — gaps are rate-limit.ts's setInterval sweep
      //                     (needs a timer the suite would have to own) and one
      //                     tokens.ts fallback.
      //   src/*.ts          ~78% — chat-router.ts's streaming paths, which need
      //                     a fake provider; the stub router is at 100%.
      //   tools/*.ts        ~61% — write-file.ts is at 0%.
      //   tools/file-editor ~5%  — four services, ~520 statements, essentially
      //                     untested. The largest single gap in the repo and the
      //                     obvious next piece of work; these tools can write to
      //                     disk, so the floor is recorded here rather than left
      //                     implicit.
      thresholds: {
        'server/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'client/app/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'packages/chat-server/src/lib/**': {
          lines: 97, functions: 95, branches: 87, statements: 96,
        },
        'packages/chat-server/src/*.ts': {
          lines: 77, functions: 75, branches: 62, statements: 78,
        },
        'packages/chat-server/src/tools/*.ts': {
          lines: 60, functions: 69, branches: 45, statements: 60,
        },
        'packages/chat-server/src/tools/file-editor/**': {
          lines: 5, functions: 8, branches: 0, statements: 5,
        },
      },
    },
  },
  resolve: {
    alias: {
      // Point at the package SOURCE, not its built dist, so a failing assertion
      // lands on an editable line and no build step sits between a change and
      // the test that covers it.
      '@ng-chat/server': resolve(__dirname, 'packages/chat-server/src/index.ts'),
    },
  },
});
