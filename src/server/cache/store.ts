// store.ts — the shared cache every server module uses for response, image and
// dedupe caching (proposal workstream B: "Shared cache — moved to Redis, with
// hit-rate measurement").
//
// Backend selection:
//   REDIS_URL set   → Redis (shared by every app instance, survives deploys)
//   REDIS_URL unset → in-process LRU (single instance / local dev)
// A Redis failure never fails the request: the operation falls back to the
// in-process LRU and the error is logged at most once a minute. Values are
// JSON-serialised; keys are namespaced `mellox:<namespace>:<key>`.
//
// Hit/miss counters are kept per namespace per UTC day (in Redis when
// available), so /api/usage can report the cache hit rate as a real figure.
import "server-only";

export type CacheBackend = "redis" | "memory";

export interface CacheStore {
  readonly backend: () => CacheBackend;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Increment a counter, creating it with `ttlSeconds` expiry. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

// ── In-process LRU ────────────────────────────────────────────────────────
type Entry = { value: string; expires: number; bytes: number };

export class MemoryLru {
  private map = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly maxEntries = 2_000,
    private readonly maxBytes = 96 * 1024 * 1024,
  ) {}

  get(key: string): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, hit); // LRU touch
    return hit.value;
  }

  set(key: string, value: string, ttlSeconds: number): void {
    this.delete(key);
    const bytes = value.length * 2;
    if (bytes > this.maxBytes) return; // never evict everything for one value
    this.map.set(key, { value, expires: Date.now() + ttlSeconds * 1000, bytes });
    this.bytes += bytes;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const hit = this.map.get(key);
    if (!hit) return;
    this.bytes -= hit.bytes;
    this.map.delete(key);
  }

  incr(key: string, ttlSeconds: number): number {
    const current = Number(this.get(key) ?? "0") + 1;
    this.set(key, String(current), ttlSeconds);
    return current;
  }

  get size(): number {
    return this.map.size;
  }
}

// ── Redis (lazy, optional) ────────────────────────────────────────────────
type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

let redisPromise: Promise<RedisLike | null> | null = null;
let redisDownUntil = 0;
let lastRedisErrorLog = 0;

function logRedisError(error: unknown): void {
  const now = Date.now();
  if (now - lastRedisErrorLog < 60_000) return;
  lastRedisErrorLog = now;
  console.error(
    "[cache] Redis unavailable — using in-process cache",
    error instanceof Error ? error.message : error,
  );
}

async function getRedis(): Promise<RedisLike | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (Date.now() < redisDownUntil) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({
          url,
          socket: {
            connectTimeout: 2_000,
            reconnectStrategy: (retries: number) => Math.min(retries * 500, 5_000),
          },
        });
        client.on("error", logRedisError);
        await client.connect();
        return client as unknown as RedisLike;
      } catch (error) {
        logRedisError(error);
        redisDownUntil = Date.now() + 30_000;
        redisPromise = null;
        return null;
      }
    })();
  }
  return redisPromise;
}

const memory = new MemoryLru();
const PREFIX = "mellox:";

async function withRedis<T>(
  op: (redis: RedisLike) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const redis = await getRedis();
  if (!redis) return fallback();
  try {
    return await op(redis);
  } catch (error) {
    logRedisError(error);
    return fallback();
  }
}

export const cache: CacheStore = {
  backend: () => (process.env.REDIS_URL?.trim() && Date.now() >= redisDownUntil ? "redis" : "memory"),

  async get<T>(key: string): Promise<T | null> {
    const k = PREFIX + key;
    const raw = await withRedis(
      (r) => r.get(k),
      () => memory.get(k),
    );
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const k = PREFIX + key;
    const raw = JSON.stringify(value);
    await withRedis(
      async (r) => {
        await r.set(k, raw, { EX: Math.max(1, Math.round(ttlSeconds)) });
      },
      () => memory.set(k, raw, ttlSeconds),
    );
  },

  async del(key: string): Promise<void> {
    const k = PREFIX + key;
    memory.delete(k);
    await withRedis(
      async (r) => {
        await r.del(k);
      },
      () => undefined,
    );
  },

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = PREFIX + key;
    return withRedis(
      async (r) => {
        const n = await r.incr(k);
        if (n === 1) await r.expire(k, ttlSeconds);
        return n;
      },
      () => memory.incr(k, ttlSeconds),
    );
  },
};

// ── Hit-rate measurement ─────────────────────────────────────────────────
const STATS_TTL_SECONDS = 8 * 24 * 3600;

function day(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Count a cache lookup outcome for `namespace` (fire-and-forget). */
export function recordCacheLookup(namespace: string, hit: boolean): void {
  void cache
    .incr(`stats:${namespace}:${hit ? "hit" : "miss"}:${day()}`, STATS_TTL_SECONDS)
    .catch(() => undefined);
}

export type CacheStats = { namespace: string; hits: number; misses: number; hitRate: number };

/** Hit/miss totals over the last `days` UTC days (today included). */
export async function getCacheStats(namespaces: string[], days = 7): Promise<CacheStats[]> {
  const out: CacheStats[] = [];
  for (const namespace of namespaces) {
    let hits = 0;
    let misses = 0;
    for (let d = 0; d < days; d++) {
      hits += Number((await cache.get<number>(`stats:${namespace}:hit:${day(d)}`)) ?? 0);
      misses += Number((await cache.get<number>(`stats:${namespace}:miss:${day(d)}`)) ?? 0);
    }
    const total = hits + misses;
    out.push({ namespace, hits, misses, hitRate: total ? hits / total : 0 });
  }
  return out;
}

/** Stable SHA-256 hex digest for cache keys. */
export async function digest(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
