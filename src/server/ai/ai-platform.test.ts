// Unit tests for the AI platform layer: budgets, metering rows, structured
// output repair, the shared cache's LRU, pricing, and SSE stream metering.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { decide, checkBudget, setBudgetDeps, BudgetExceededError, enforceBudget } from "./budget";
import { recordUsage, setUsageSink, toUsageRow } from "./metering";
import { parseStructured, runStructured, AiOutputError } from "./structured";
import { estimateTextCost, tokenPrice } from "./pricing";
import { MemoryLru, cache } from "@/server/cache/store";
import { runWithScope } from "@/server/request-context";
import { setGuardrailSink } from "@/server/guardrails/events";
import { meterSseStream, TRUNCATION_EVENT, capTokens } from "@/lib/ai-gateway.server";

const LIMITS = { dailyUsd: 3, monthlyUsd: 40, monthlyImages: 10, monthlyVideos: 2 };
const usage = (over: Partial<Parameters<typeof decide>[1]> = {}) => ({
  todayCostUsd: 0,
  monthCostUsd: 0,
  monthImages: 0,
  monthVideos: 0,
  monthCalls: 0,
  monthCachedCalls: 0,
  monthSavedUsd: 0,
  ...over,
});

afterEach(() => {
  setBudgetDeps(null);
  vi.restoreAllMocks();
});

describe("budget decisions", () => {
  it("is ok well under every limit", () => {
    expect(decide("text", usage({ todayCostUsd: 0.5 }), LIMITS).mode).toBe("ok");
  });
  it("warns at 80% of a spend ceiling (soft cap)", () => {
    expect(decide("text", usage({ monthCostUsd: 33 }), LIMITS).mode).toBe("warn");
  });
  it("degrades text past the daily ceiling instead of failing", () => {
    expect(decide("text", usage({ todayCostUsd: 3.2 }), LIMITS).mode).toBe("degrade");
  });
  it("blocks images once the monthly quota is used (hard cap)", () => {
    expect(decide("image", usage({ monthImages: 10 }), LIMITS)).toMatchObject({ mode: "block" });
  });
  it("blocks video past the spend ceiling even with quota left", () => {
    expect(decide("video", usage({ monthCostUsd: 41 }), LIMITS).mode).toBe("block");
  });
  it("blocks search past the ceiling (no cheaper search to degrade to)", () => {
    expect(decide("search", usage({ todayCostUsd: 5 }), LIMITS).mode).toBe("block");
  });

  it("reads the workspace's plan and usage, and throws on block", async () => {
    await cache.del("budget:summary:ws:ws-over");
    await cache.del("budget:plan:ws-over");
    setGuardrailSink(async () => undefined);
    setBudgetDeps({
      summary: async () => usage({ monthImages: 150 }),
      plan: async () => "starter",
    });
    await expect(enforceBudget("image", { workspaceId: "ws-over" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("fails open when the usage store is unreachable", async () => {
    await cache.del("budget:summary:ws:ws-down");
    setBudgetDeps({
      summary: async () => {
        throw new Error("db down");
      },
      plan: async () => "starter",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkBudget("video", { workspaceId: "ws-down" })).mode).toBe("ok");
  });

  it("uses the per-user ceiling when no workspace is attributed", async () => {
    await cache.del("budget:summary:user:u-1");
    setBudgetDeps({ summary: async () => usage({ todayCostUsd: 2.5 }) });
    const d = await checkBudget("text", { workspaceId: null, userId: "u-1" });
    expect(d).toMatchObject({ scope: "user", mode: "degrade" });
  });
});

describe("metering", () => {
  it("attributes a call to the request scope's workspace, user and route", () => {
    const row = runWithScope({ userId: "u-9", workspaceId: "ws-9", route: "chat" }, () =>
      toUsageRow({
        provider: "openrouter",
        model: "m",
        inputTokens: 10.4,
        outputTokens: 3,
        estCostUsd: 0.01,
      }),
    );
    expect(row).toMatchObject({
      workspace_id: "ws-9",
      user_id: "u-9",
      route: "chat",
      input_tokens: 10,
      output_tokens: 3,
      est_cost_usd: 0.01,
    });
  });

  it("never charges a cache hit", () => {
    expect(
      toUsageRow({ provider: "openrouter", model: "m", cached: true, estCostUsd: 1 }).est_cost_usd,
    ).toBe(0);
  });

  it("logs a truncation guardrail event alongside the usage row", async () => {
    const rows: unknown[] = [];
    const events: Array<Record<string, unknown>> = [];
    const restoreUsage = setUsageSink(async (row) => void rows.push(row));
    const restoreGuard = setGuardrailSink(async (row) => void events.push(row));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordUsage({
      provider: "anthropic",
      model: "claude-sonnet-5",
      truncated: true,
      route: "coach",
    });
    await new Promise((r) => setTimeout(r, 0));
    restoreUsage();
    restoreGuard();
    expect(rows).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "truncation", route: "coach" });
  });
});

describe("structured output", () => {
  const Schema = z.object({ items: z.array(z.object({ body: z.string() })).min(1) });

  it("parses fenced JSON and validates it", () => {
    expect(parseStructured('```json\n{"items":[{"body":"x"}]}\n```', Schema)).toEqual({
      ok: true,
      value: { items: [{ body: "x" }] },
    });
  });

  it("reports a schema mismatch instead of returning a fallback", () => {
    const out = parseStructured('{"items":[]}', Schema);
    expect(out.ok).toBe(false);
  });

  it("repairs once, with a larger budget when the first answer was truncated", async () => {
    const calls: Array<{ maxTokens: number; repair: boolean }> = [];
    const value = await runStructured({
      route: "t",
      system: "s",
      user: "u",
      schema: Schema,
      maxTokens: 500,
      call: async (args) => {
        calls.push({ maxTokens: args.maxTokens, repair: args.repair });
        return args.repair
          ? { text: '{"items":[{"body":"ok"}]}', truncated: false }
          : { text: '{"items":[{"bo', truncated: true };
      },
    });
    expect(value.items[0].body).toBe("ok");
    expect(calls).toEqual([
      { maxTokens: 500, repair: false },
      { maxTokens: 1000, repair: true },
    ]);
  });

  it("throws AiOutputError and logs parse_failure when the repair also fails", async () => {
    const events: Array<Record<string, unknown>> = [];
    const restore = setGuardrailSink(async (row) => void events.push(row));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      runStructured({
        route: "content.generateBatch",
        system: "s",
        user: "u",
        schema: Schema,
        maxTokens: 500,
        call: async () => ({ text: "not json", truncated: false }),
      }),
    ).rejects.toBeInstanceOf(AiOutputError);
    await new Promise((r) => setTimeout(r, 0));
    restore();
    expect(events[0]).toMatchObject({ kind: "parse_failure", route: "content.generateBatch" });
  });
});

describe("pricing", () => {
  it("prices Claude Sonnet 5 at $2 / $10 per million tokens", () => {
    expect(tokenPrice("claude-sonnet-5")).toEqual({ inPerM: 2, outPerM: 10 });
    expect(
      estimateTextCost("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 100_000 }),
    ).toBe(3);
  });
  it("prices an unknown model conservatively rather than as free", () => {
    expect(
      estimateTextCost("mystery/model", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeGreaterThan(0);
  });
  it("honours an env override", () => {
    vi.stubEnv("AI_PRICE_QWEN_QWEN3_MAX_OUT", "9");
    expect(tokenPrice("qwen/qwen3-max").outPerM).toBe(9);
    vi.unstubAllEnvs();
  });
});

describe("token budgets", () => {
  it("no longer clamps generation to 1,200 tokens", () => {
    expect(capTokens(2400, "generate")).toBe(2400);
    expect(capTokens(99_999, "generate")).toBe(6000);
    expect(capTokens(undefined, "chat")).toBe(1500);
  });
});

describe("shared cache LRU", () => {
  it("evicts the least recently used entry past its entry cap", () => {
    const lru = new MemoryLru(2);
    lru.set("a", "1", 60);
    lru.set("b", "2", 60);
    lru.get("a");
    lru.set("c", "3", 60);
    expect(lru.get("b")).toBeNull();
    expect(lru.get("a")).toBe("1");
  });
  it("expires entries", () => {
    const lru = new MemoryLru();
    lru.set("a", "1", -1);
    expect(lru.get("a")).toBeNull();
  });
  it("round-trips JSON through the store (memory backend without REDIS_URL)", async () => {
    await cache.set("t:json", { a: 1 }, 60);
    expect(await cache.get("t:json")).toEqual({ a: 1 });
    expect(cache.backend()).toBe("memory");
  });
});

describe("SSE stream metering", () => {
  const sse = (...lines: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        // Split mid-line to prove frames are reassembled across chunks.
        const text = lines.join("\n") + "\n";
        c.enqueue(enc.encode(text.slice(0, 17)));
        c.enqueue(enc.encode(text.slice(17)));
        c.close();
      },
    });
  const read = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

  it("passes content through and reports usage when the stream ends", async () => {
    let info: any;
    const out = await read(
      meterSseStream(
        sse(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"cost":0.001}}',
          "data: [DONE]",
        ),
        (i) => (info = i),
      ),
    );
    expect(out).toContain('"Hello"');
    expect(out).not.toContain(TRUNCATION_EVENT);
    expect(info).toMatchObject({ finishReason: "stop", usage: { cost: 0.001 }, outputChars: 5 });
  });

  it("inserts the truncation event before [DONE] when the reply hit the ceiling", async () => {
    const out = await read(
      meterSseStream(
        sse(
          'data: {"choices":[{"delta":{"content":"cut"},"finish_reason":"length"}]}',
          "data: [DONE]",
        ),
        () => {},
      ),
    );
    expect(out.indexOf(TRUNCATION_EVENT)).toBeGreaterThan(-1);
    expect(out.indexOf(TRUNCATION_EVENT)).toBeLessThan(out.indexOf("[DONE]"));
  });
});
