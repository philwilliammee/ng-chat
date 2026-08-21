/** Per-IP sliding-window rate limiter (in-memory, single-instance). */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, number[]>();

  // Sweep stale buckets every 5 min so IPs that stop requesting don't leak memory.
  const sweepInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, hits] of buckets) {
      if (hits.every(t => t <= cutoff)) buckets.delete(ip);
    }
  }, 5 * 60 * 1_000);
  sweepInterval.unref();

  return function limit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const existing = buckets.get(ip) ?? [];
    const hits = existing.filter(t => t > cutoff);
    if (hits.length === 0 && existing.length > 0) buckets.delete(ip);
    if (hits.length >= maxRequests) return false;
    hits.push(now);
    buckets.set(ip, hits);
    return true;
  };
}

/**
 * Best-effort client IP for rate-limit keying.
 *
 * `X-Forwarded-For` is append-only: each proxy adds the address it saw. So the
 * entries on the RIGHT were written by the proxies closest to us, and everything
 * to the LEFT of those is ultimately client-supplied — a caller can open a
 * request with `X-Forwarded-For: 1.2.3.4` and every proxy will preserve it.
 * Reading the leftmost entry therefore lets anyone rotate their own limiter key
 * at will, which is exactly the abuse the limiter exists to stop.
 *
 * `trustedProxyHops` is how many proxies you control sit in front of this
 * server, counting from the outside in:
 *
 * - `1` (default) — one trusted hop, e.g. an ALB or a single nginx. The last
 *   XFF entry was appended by it and reflects the real TCP peer.
 * - `2+` — a chain you control (CDN → ALB → app); take that many from the end.
 * - `0` — no proxy. No forwarding header can be trusted at all, so none is
 *   read and every caller shares the `'unknown'` bucket. Correct but blunt:
 *   the per-IP limit becomes a global one. Prefer running behind a proxy, or
 *   key the limiter on an authenticated session instead.
 *
 * Set this to match the deployment. Too high and the limiter keys on a value
 * the client picked; too low and it keys on your own proxy's address, throttling
 * every visitor as one.
 */
export function getClientIp(
  c: { req: { header: (name: string) => string | undefined } },
  trustedProxyHops = 1,
): string {
  const hops = Math.floor(trustedProxyHops);
  if (hops <= 0) return 'unknown';

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map(p => p.trim()).filter(Boolean);
    const index = parts.length - hops;
    // A chain shorter than the configured hop count means no entry is provably
    // proxy-appended — fall through rather than trust one that might be forged.
    if (index >= 0 && parts[index]) return parts[index]!;
  }

  return c.req.header('x-real-ip') ?? 'unknown';
}
