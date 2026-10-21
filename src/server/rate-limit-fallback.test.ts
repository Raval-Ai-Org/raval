import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitFallback } from "./rate-limit-fallback";

afterEach(() => vi.useRealTimers());

describe("emergency rate limits", () => {
  it("bounds bursts synchronously, including weighted requests", () => {
    const store = new RateLimitFallback();
    expect(store.consume("video:user", 60, 8, 4).remaining).toBe(4);
    expect(store.consume("video:user", 60, 8, 4).ok).toBe(true);
    expect(store.consume("video:user", 60, 8, 1).ok).toBe(false);
    expect(store.consume("video:other", 60, 8, 1).ok).toBe(true);
  });

  it("resets expired windows and retains larger shared counts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    const store = new RateLimitFallback();
    store.consume("key", 60, 8, 1);
    store.observe("key", 8, 120_000, 8);
    store.observe("key", 1, 120_000, 8);
    expect(store.consume("key", 60, 8, 1).ok).toBe(false);
    vi.setSystemTime(120_000);
    expect(store.consume("key", 60, 8, 1).remaining).toBe(7);
  });

  it("rejects new identities at capacity without evicting live counters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(60_000);
    const store = new RateLimitFallback(2);
    store.consume("a", 60, 1, 1);
    store.consume("b", 60, 1, 1);
    expect(store.consume("c", 60, 1, 1).ok).toBe(false);
    expect(store.consume("a", 60, 1, 1).ok).toBe(false);
    vi.setSystemTime(120_000);
    expect(store.consume("c", 60, 1, 1).ok).toBe(true);
  });
});
