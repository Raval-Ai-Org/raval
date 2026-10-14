// Emergency per-process protection. Postgres remains the shared authority;
// this bounded mirror prevents unlimited calls if that query stops working.
type Bucket = { count: number; resetAt: number };

export class RateLimitFallback {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxBuckets = 10_000) {}

  consume(key: string, windowSeconds: number, limit: number, cost: number) {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxBuckets) {
        for (const [oldKey, old] of this.buckets) {
          if (old.resetAt <= now) this.buckets.delete(oldKey);
        }
        // Never evict live buckets: rotating identities must not reset limits.
        if (this.buckets.size >= this.maxBuckets) {
          return {
            ok: false,
            limit,
            remaining: 0,
            retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
            resetAt: new Date(resetAt).toISOString(),
          };
        }
      }
      bucket = { count: 0, resetAt };
      this.buckets.set(key, bucket);
    }
    bucket.count = Math.min(limit + 1, bucket.count + cost);
    return {
      ok: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      resetAt: new Date(bucket.resetAt).toISOString(),
    };
  }

  /** Retain counts observed on other instances, without lowering a live count. */
  observe(key: string, count: number, resetAt: number, limit: number) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt === resetAt) {
      bucket.count = Math.min(limit + 1, Math.max(bucket.count, count));
    }
  }
}
