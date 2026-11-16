import type { MiddlewareHandler } from 'hono';

/**
 * Request log, ported from the factory's `quietRequestLog` (factory/app/server/shared/request-log.ts).
 * Replaces `hono/logger`, which wrote an entry *and* an exit line for every request — the ALB target
 * group and the container healthcheck hit `/health` every few seconds, so CloudWatch was almost
 * entirely `<-- GET /health` / `--> GET /health 200 0ms` pairs.
 *
 *  - `QUIET_PATHS` (exact match) are never logged. `/health` answers the load balancer; a failing
 *    health check shows up as an unhealthy target, not as a log line nobody reads.
 *  - `QUIET_PREFIXES_ON_SUCCESS` are skipped only on 2xx/304: one page load fetches a couple of dozen
 *    hashed bundles, but a 404 on one (a stale client after a deploy) is still worth a line.
 *  - Everything else gets one exit line. Production writes JSON with `method`, `path`, `status` and
 *    `ms` as fields so CloudWatch Logs Insights can filter on them; elsewhere it stays readable.
 */
export const QUIET_PATHS: readonly string[] = ['/health'];
export const QUIET_PREFIXES_ON_SUCCESS: readonly string[] = ['/chunk-', '/main-', '/polyfills-', '/styles-', '/media/', '/assets/'];

export type RequestLogOptions = {
  quietPaths?: readonly string[];
  quietPrefixesOnSuccess?: readonly string[];
  /** Defaults to `NODE_ENV === 'production'`, read per line so tests can flip it. */
  json?: boolean;
  /** Defaults to `console.log`, looked up at call time so `vi.spyOn(console, 'log')` sees it. */
  write?: (line: string) => void;
};

export function requestLog(options: RequestLogOptions = {}): MiddlewareHandler {
  const skip = new Set(options.quietPaths ?? QUIET_PATHS);
  const prefixes = options.quietPrefixesOnSuccess ?? QUIET_PREFIXES_ON_SUCCESS;
  return async (c, next) => {
    if (skip.has(c.req.path)) return next();
    const started = performance.now();
    await next();
    const { method, path } = c.req;
    const status = c.res.status;
    if ((status < 300 || status === 304) && prefixes.some((p) => path.startsWith(p))) return;
    const ms = Math.round(performance.now() - started);
    const json = options.json ?? process.env.NODE_ENV === 'production';
    const line = json
      ? JSON.stringify({ time: new Date().toISOString(), level: status >= 500 ? 'error' : 'info', type: 'http', method, path, status, ms })
      : `${method} ${path} ${status} ${ms}ms`;
    (options.write ?? console.log)(line);
  };
}
