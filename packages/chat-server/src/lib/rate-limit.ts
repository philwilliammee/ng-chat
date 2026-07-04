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

export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? 'unknown';
}
