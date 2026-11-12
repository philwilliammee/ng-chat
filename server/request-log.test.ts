import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestLog } from './request-log.js';

function appWith(options: Parameters<typeof requestLog>[0] = {}) {
  const app = new Hono();
  app.use('*', requestLog(options));
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/thing', (c) => c.json({ ok: true }));
  app.get('/chunk-ABC123.js', (c) => c.text('js'));
  app.get('/api/boom', (c) => c.text('no', 500));
  return app;
}

describe('requestLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('never logs /health', async () => {
    const lines: string[] = [];
    const app = appWith({ json: true, write: (l) => lines.push(l) });
    for (let i = 0; i < 5; i++) await app.request('/health');
    expect(lines).toEqual([]);
  });

  it('is quiet on a successful hashed-asset fetch but logs a 404 on one', async () => {
    const lines: string[] = [];
    const app = appWith({ json: true, write: (l) => lines.push(l) });
    await app.request('/chunk-ABC123.js');
    expect(lines).toEqual([]);
    await app.request('/chunk-GONE.js');
    expect(lines.map((l) => JSON.parse(l).status)).toEqual([404]);
  });

  it('writes one JSON line per request with queryable fields, error level on a 5xx', async () => {
    const lines: string[] = [];
    const app = appWith({ json: true, write: (l) => lines.push(l) });
    await app.request('/api/thing');
    await app.request('/api/boom');
    const [ok, boom] = lines.map((l) => JSON.parse(l));
    expect(ok).toMatchObject({ level: 'info', type: 'http', method: 'GET', path: '/api/thing', status: 200 });
    expect(typeof ok.ms).toBe('number');
    expect(boom).toMatchObject({ level: 'error', status: 500 });
  });

  it('defaults to console.log, JSON in production and a readable line elsewhere', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = appWith();
    vi.stubEnv('NODE_ENV', 'development');
    await app.request('/api/thing');
    vi.stubEnv('NODE_ENV', 'production');
    await app.request('/api/thing');
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toMatch(/^GET \/api\/thing 200 \d+ms$/);
    expect(JSON.parse(log.mock.calls[1]![0] as string)).toMatchObject({ path: '/api/thing', status: 200 });
  });

  it('takes its own quiet lists', async () => {
    const lines: string[] = [];
    const app = appWith({ quietPaths: ['/api/thing'], quietPrefixesOnSuccess: [], write: (l) => lines.push(l), json: false });
    await app.request('/api/thing');
    await app.request('/health');
    await app.request('/chunk-ABC123.js');
    expect(lines).toEqual([expect.stringMatching(/^GET \/health 200/), expect.stringMatching(/^GET \/chunk-ABC123\.js 200/)]);
  });
});
