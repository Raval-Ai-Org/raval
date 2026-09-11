// Rate limiter behaviour: allow under budget, 429 over it, and — critically —
// fail OPEN when the store is unavailable, so a database hiccup degrades spend
// control rather than taking the product down.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const { consumeRateLimit, enforceRateLimit, rateLimitTierConfig } = await import("./rate-limit");

/** Shape the SQL function returns: a single-row result set. */
function row(allowed: boolean, currentCount: number, resetInSeconds = 60) {
  return {
    data: [
      {
        allowed,
        current_count: currentCount,
        reset_at: new Date(Date.now() + resetInSeconds * 1000).toISOString(),
      },
    ],
    error: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  vi.restoreAllMocks();
});

describe("consumeRateLimit", () => {
  it("allows a request under the limit and reports what is left", async () => {
    rpc.mockResolvedValue(row(true, 3));

    const result = await consumeRateLimit("chat", "user-1");

    expect(result.ok).toBe(true);
    expect(result.limit).toBe(rateLimitTierConfig("chat").limit);
    expect(result.remaining).toBe(rateLimitTierConfig("chat").limit - 3);
  });

  it("passes the tier's window and limit, and namespaces the bucket by tier", async () => {
    rpc.mockResolvedValue(row(true, 1));

    await consumeRateLimit("video", "user-1");

    const [fnName, args] = rpc.mock.calls[0];
    expect(fnName).toBe("consume_rate_limit");
    expect(args).toMatchObject({
      p_bucket_key: "video:user-1",
      p_window_seconds: rateLimitTierConfig("video").windowSeconds,
      p_limit: rateLimitTierConfig("video").limit,
      p_cost: 1,
    });
  });

  it("keeps separate budgets per tier for the same user", async () => {
    rpc.mockResolvedValue(row(true, 1));

    await consumeRateLimit("image", "user-1");
    await consumeRateLimit("video", "user-1");

    expect(rpc.mock.calls[0][1].p_bucket_key).toBe("image:user-1");
    expect(rpc.mock.calls[1][1].p_bucket_key).toBe("video:user-1");
  });

  it("denies once the store reports the limit is exceeded", async () => {
    rpc.mockResolvedValue(row(false, rateLimitTierConfig("video").limit + 1));

    const result = await consumeRateLimit("video", "user-1");

    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("fails open when the store returns an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const result = await consumeRateLimit("chat", "user-1");

    expect(result.ok).toBe(true);
  });

  it("fails open when the store throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockRejectedValue(new Error("socket hang up"));

    const result = await consumeRateLimit("chat", "user-1");

    expect(result.ok).toBe(true);
  });

  it("fails open on an unexpected response shape", async () => {
    rpc.mockResolvedValue({ data: [{ unexpected: true }], error: null });

    const result = await consumeRateLimit("chat", "user-1");

    expect(result.ok).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("returns null so the route proceeds when under budget", async () => {
    rpc.mockResolvedValue(row(true, 1));

    expect(await enforceRateLimit("generate", "user-1")).toBeNull();
  });

  it("returns a 429 carrying Retry-After and RateLimit headers", async () => {
    rpc.mockResolvedValue(row(false, 99, 42));

    const response = await enforceRateLimit("image", "user-1");

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(Number(response!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response!.headers.get("RateLimit-Limit")).toBe(
      String(rateLimitTierConfig("image").limit),
    );
    expect(response!.headers.get("RateLimit-Remaining")).toBe("0");

    const body = await response!.json();
    expect(body.error).toMatch(/too many image generation requests/i);
  });
});

describe("tier configuration", () => {
  it("prices video below image below the text tiers", () => {
    const perHour = (tier: "image" | "video") => {
      const { limit, windowSeconds } = rateLimitTierConfig(tier);
      return (limit / windowSeconds) * 3600;
    };

    // The most expensive upstream call must have the tightest budget.
    expect(perHour("video")).toBeLessThan(perHour("image"));
    expect(rateLimitTierConfig("audit").limit).toBeLessThan(rateLimitTierConfig("chat").limit);
  });
});

const { rateLimitFor, RateLimitedError } = await import("./rate-limit");
const { runMiddleware } = await import("./middleware");
const { knownErrorResponse } = await import("./route");

describe("rateLimitFor (server-function middleware)", () => {
  it("passes the context through when under budget", async () => {
    rpc.mockResolvedValue(row(true, 1));
    const context = await runMiddleware([rateLimitFor("generate")], { userId: "user-1" });
    expect(context.userId).toBe("user-1");
    expect(rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ p_bucket_key: "generate:user-1" }),
    );
  });

  it("throws RateLimitedError over budget, which the RPC route maps to 429", async () => {
    rpc.mockResolvedValue(row(false, 41, 30));
    const error = await runMiddleware([rateLimitFor("generate")], { userId: "user-1" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    const res = knownErrorResponse(error);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("refuses to run before authentication has set a user", async () => {
    await expect(runMiddleware([rateLimitFor("generate")], {})).rejects.toThrow(/^Unauthorized/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
