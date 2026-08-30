// server/app.ts — the assembled app.
//
// Every case goes through `app.request()`. Hono's dispatcher returns a real
// `Response` with the whole middleware chain applied, so there is no port to
// bind, no supertest, and no teardown.
//
// app.ts does its work at import time — a top-level `await createUseSkillTool`,
// a ToolRegistry, and a three-way choice of chat router driven by `config`. So
// anything that depends on the environment has to be tested by re-importing the
// module with the environment stubbed, which is what `loadApp()` does. The plain
// cases share the module-level import.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from './app.js';

// Hono's logger() writes every request to console.log, and app.ts warns on
// import when it falls back to a stub router. Silence both, but keep the spies
// so the warnings themselves can be asserted — a stub router that mounts without
// saying why is the failure mode the warning exists to prevent.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/**
 * `Response.json()` is typed `Promise<any>`-free here — it resolves to `unknown`
 * under this tsconfig — so every body read goes through this. Naming the shape at
 * the read site is better than an `as any`: it type-checks the assertions below.
 */
async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ChatConfigBody {
  enabled: boolean;
  model: string | null;
  contextLimit: number;
  allowedModels: string[];
  tools: string[];
}

/** Re-import app.ts (and its config) with `env` applied. */
async function loadApp(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import('./app.js')).app;
}

describe('GET /health', () => {
  it('answers 200 with the service name', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 200,
      data: { name: 'ng-chat', uptime: expect.any(Number) },
    });
  });

  it('is reachable without a body, a key or any header', async () => {
    // This is the ECS/ALB target-group check. If it ever starts requiring
    // anything, containers go unhealthy on deploy with no other symptom.
    const res = await app.request('/health');

    expect(res.status).toBe(200);
  });
});

describe('security headers', () => {
  it('sets the secureHeaders defaults on every response', async () => {
    const res = await app.request('/health');

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('does NOT set x-frame-options', async () => {
    // `secureHeaders({ xFrameOptions: false })` is deliberate: the chat UI is
    // meant to be embeddable in an iframe. Restoring the default would break
    // every embedding host at once, and nothing else in the repo says so.
    const res = await app.request('/health');

    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});

describe('chat router selection', () => {
  // The three-way ternary in app.ts is the piece most likely to be edited by a
  // project built on this template, and the two stub branches exist so that a
  // misconfiguration says so on the first turn instead of surfacing as a
  // provider auth error mid-stream. Each branch is pinned by the observable a
  // client actually reads: GET /api/chat/config, plus the 503 on /compact.

  it('mounts the real router when chat is on and a key is present', async () => {
    const configured = await loadApp({ CHAT_ENABLED: 'true', GATEWAY_API_KEY: 'sk-test' });

    const body = await json<ChatConfigBody>(await configured.request('/api/chat/config'));

    expect(body.enabled).toBe(true);
    // The stub reports `model: null` and `allowedModels: []`; the real router
    // reports both. That difference is the assertion.
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.allowedModels).toEqual(['gpt-4o-mini']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('mounts the stub with enabled=false when CHAT_ENABLED is off', async () => {
    const off = await loadApp({ CHAT_ENABLED: 'false', GATEWAY_API_KEY: 'sk-test' });

    const body = await json<ChatConfigBody>(await off.request('/api/chat/config'));

    // `enabled: false` is the client's signal to hide the chat surface entirely,
    // as opposed to showing it with an explanatory message.
    expect(body.enabled).toBe(false);
    expect(body.model).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CHAT_ENABLED=false'));
  });

  it('CHAT_ENABLED=false wins over a present key', async () => {
    // Order matters in the ternary: an operator switching chat off must not be
    // overridden by credentials that happen to still be in the environment.
    const off = await loadApp({ CHAT_ENABLED: 'false', GATEWAY_API_KEY: 'sk-test' });

    const res = await off.request('/api/chat/compact', { method: 'POST' });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining('switched off'),
    });
  });

  it('mounts the stub with enabled=true when the key is missing', async () => {
    const unconfigured = await loadApp({ CHAT_ENABLED: 'true', GATEWAY_API_KEY: '' });

    const body = await json<ChatConfigBody>(await unconfigured.request('/api/chat/config'));

    // enabled stays true here — the feature is supposed to work, it just is not
    // configured, so the client shows the surface and the message explains.
    expect(body.enabled).toBe(true);
    expect(body.model).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GATEWAY_API_KEY is not set'));
  });

  it('tells the reader how to fix a missing key', async () => {
    // The wording is load-bearing: it is the entire error message a new
    // contributor gets on their first `npm run dev`.
    const unconfigured = await loadApp({ CHAT_ENABLED: 'true', GATEWAY_API_KEY: '' });

    const { error } = await json<{ error: string }>(
      await unconfigured.request('/api/chat/close', { method: 'POST' }),
    );

    expect(error).toContain('GATEWAY_API_KEY');
    expect(error).toContain('.env');
  });

  it('streams a real UI message from the stub rather than erroring', async () => {
    // The stub answers POST / with an actual UI Message Stream, so the reason
    // renders as an ordinary assistant message in any AI-SDK client with no
    // special-casing. A 500 or a bare JSON error would need client changes.
    const unconfigured = await loadApp({ CHAT_ENABLED: 'true', GATEWAY_API_KEY: '' });

    const res = await unconfigured.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('not configured yet');
  });
});

describe('tool registry', () => {
  it('exposes all nine tools to the client', async () => {
    // /config's `tools` array is how the UI lists capabilities, and it is the
    // same registry the model is given. Pinning the list catches a tool dropped
    // from the chain in app.ts — which otherwise fails only as the model
    // declining to do something it used to do.
    const { tools } = await json<ChatConfigBody>(await app.request('/api/chat/config'));

    expect(tools).toEqual([
      'use_skill',
      'get_time',
      'read_file',
      'search_files',
      'write_file',
      'search_code_context',
      'edit_file',
      'batch_edit',
      'rollback_changes',
    ]);
  });

  it('registers the same tools on the stub router', async () => {
    // Worth its own case: the stub takes `tools: tools.names()`, so an
    // unconfigured server still advertises an accurate capability list and the
    // UI does not change shape when the key lands.
    const unconfigured = await loadApp({ CHAT_ENABLED: 'true', GATEWAY_API_KEY: '' });

    const { tools } = await json<ChatConfigBody>(await unconfigured.request('/api/chat/config'));

    expect(tools).toHaveLength(9);
    expect(tools).toContain('use_skill');
  });
});

describe('route registration', () => {
  // Assert the registration table, not response status.
  //
  // `serveStatic` is mounted on `/*` and `app.get('*')` falls back to
  // index.html, so after `npm run build` an unregistered path answers 200 with
  // the SPA shell. Status-based assertions here pass on a clean checkout and
  // fail on a built tree. `app.routes` is the table Hono matches against and is
  // immune to build state.
  const paths = () => app.routes.map((r) => `${r.method} ${r.path}`);

  it('registers /health and the four chat endpoints', () => {
    expect(paths()).toEqual(
      expect.arrayContaining([
        'GET /health',
        'GET /api/chat/config',
        'POST /api/chat',
        'POST /api/chat/compact',
        'POST /api/chat/close',
      ]),
    );
  });

  it('mounts the chat router under /api/chat, not at the root', () => {
    // `app.route('/api/chat', chatRouter)` — if the prefix is dropped the
    // sub-router's `POST /` would claim the site root.
    expect(paths()).not.toContain('POST /');
  });

  it('registers the static handlers last, after every API route', () => {
    // Hono matches in registration order, so a static mount registered before
    // the chat router would shadow it. This is the ordering constraint that
    // `app.route(...)` sitting above the two serveStatic lines encodes, and the
    // one an editor is most likely to break by appending a new route.
    // `findLastIndex` is ES2023 and server/tsconfig.json targets ES2022, so scan
    // by hand rather than widen the lib for a test.
    const lastIndexWhere = (pred: (path: string) => boolean) => {
      let found = -1;
      app.routes.forEach((r, i) => {
        if (pred(r.path)) found = i;
      });
      return found;
    };

    const lastApi = lastIndexWhere((p) => p.startsWith('/api/'));
    const lastCatchAll = lastIndexWhere((p) => p === '/*');

    expect(lastApi).toBeGreaterThan(-1);
    expect(lastCatchAll).toBeGreaterThan(lastApi);
  });

  it('does not let the static fallback shadow /api/chat', async () => {
    // The behavioural counterpart to the ordering assertion above, and it holds
    // in both build states: a real chat route answers with JSON, never with the
    // SPA shell.
    const res = await app.request('/api/chat/config');

    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('applies logger and secureHeaders to everything', () => {
    // Both are `app.use('*', ...)` registered before any route, so they are the
    // first two entries. If a route were registered above them it would answer
    // without security headers.
    const first = app.routes.slice(0, 2);

    expect(first.every((r) => r.path === '/*')).toBe(true);
  });
});
