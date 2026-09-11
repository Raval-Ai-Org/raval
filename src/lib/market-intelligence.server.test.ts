import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  collection: null as Record<string, unknown> | null,
  workspace: null as Record<string, unknown> | null,
  cached: null as Record<string, unknown> | null,
}));

const claudeTextPrompt = vi.hoisted(() => vi.fn());

function builder(table: string) {
  let id: string | undefined;
  let analysisKey: string | undefined;
  let upserted: Record<string, unknown> | null = null;
  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: string) {
      if (table === "market_trend_collections" && column === "id") id = value;
      if (table === "market_intelligence_cache" && column === "analysis_key") analysisKey = value;
      return chain;
    },
    upsert(value: Record<string, unknown>) {
      upserted = value;
      return chain;
    },
    async maybeSingle() {
      if (table === "market_trend_collections") {
        return {
          data: state.collection && state.collection.id === id ? state.collection : null,
          error: null,
        };
      }
      if (table === "workspaces") return { data: state.workspace, error: null };
      if (table === "market_intelligence_cache") {
        return {
          data: state.cached && state.cached.analysis_key === analysisKey ? state.cached : null,
          error: null,
        };
      }
      return { data: null, error: null };
    },
    async then(resolve: (value: unknown) => unknown) {
      if (upserted) {
        state.cached = { id: "cache-1", ...upserted };
      }
      return resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn((table: string) => builder(table)) },
}));

vi.mock("@/lib/anthropic-gateway.server", () => ({
  AnthropicGatewayError: class AnthropicGatewayError extends Error {
    status = 503;
    code = "provider_error";
  },
  claudeTextPrompt,
  selectClaudeModel: vi.fn(() => "test-model"),
}));

import { analyzeMarketCollection, MarketIntelligenceSchema } from "./market-intelligence.server";

const collectionId = "11111111-1111-1111-1111-111111111111";
const workspaceId = "22222222-2222-2222-2222-222222222222";

const trendData = {
  keywords: ["AI marketing"],
  interestOverTime: [{ timestamp: 1, date: "2024-01-01", values: [80] }],
  relatedQueries: [{ query: "AI marketing tools", value: "100", kind: "top" as const }],
  relatedTopics: [],
  regionalInterest: [{ geoId: "US-CA", geoName: "California", values: [90] }],
};

const validIntelligence = {
  summary: "Interest is strong for the supplied AI marketing topic.",
  trendSignals: [
    {
      title: "Strong measured interest",
      direction: "rising",
      evidence: ["The supplied graph includes a value of 80."],
      significance: "The topic merits targeted testing, but direction over time is limited.",
      opportunities: ["Create an evidence-led educational asset."],
    },
  ],
  opportunities: [
    {
      title: "Educational content test",
      explanation: "Use the measured interest as a reason to test a focused content angle.",
      targetAudience: "The supplied brand audience",
      recommendedAction: "Publish one practical explainer and measure response.",
      priority: "medium",
    },
  ],
  recommendations: [
    {
      action: "Test one practical AI marketing explainer.",
      reason: "The supplied Trends evidence shows meaningful interest.",
      expectedMarketingImpact: "May clarify which message earns engagement; validate with results.",
      priority: "medium",
    },
  ],
  relatedQueries: ["AI marketing tools"],
  relatedTopics: [],
  confidence: "medium",
  generatedAt: "2026-09-10T00:00:00.000Z",
};

beforeEach(() => {
  claudeTextPrompt.mockClear();
  state.collection = {
    id: collectionId,
    status: "completed",
    keywords: ["AI marketing"],
    location: "United States",
    language: "en",
    completed_at: "2026-09-10T00:00:00.000Z",
    normalized_result: trendData,
    provider_error: null,
  };
  state.workspace = {
    name: "Mellox",
    industry: "Marketing technology",
    audience: "Marketing teams",
    goals: "Grow qualified demand",
    website_url: "https://example.com",
    brand_voice: { brandName: "Mellox", positioning: "AI marketing intelligence" },
  };
  state.cached = null;
  claudeTextPrompt.mockResolvedValue(JSON.stringify(validIntelligence));
});

describe("Market Intelligence engine", () => {
  it("turns valid trend data and Brand DNA into validated intelligence", async () => {
    const result = await analyzeMarketCollection({ collectionId, workspaceId });

    expect(result.state).toBe("completed");
    expect(MarketIntelligenceSchema.safeParse(result.data).success).toBe(true);
    expect(claudeTextPrompt).toHaveBeenCalledOnce();
    expect(claudeTextPrompt.mock.calls[0][0].user).toContain("AI marketing tools");
    expect(claudeTextPrompt.mock.calls[0][0].user).toContain("AI marketing intelligence");
  });

  it("works without Brand DNA", async () => {
    state.workspace!.brand_voice = null;
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("completed");
  });

  it.each([
    ["pending", "pending"],
    ["failed", "failed"],
  ] as const)("returns %s collection state without calling Claude", async (status, expected) => {
    state.collection!.status = status;
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe(expected);
    expect(claudeTextPrompt).not.toHaveBeenCalled();
  });

  it("returns no_data for missing or empty collections", async () => {
    state.collection = null;
    await expect(analyzeMarketCollection({ collectionId, workspaceId })).resolves.toMatchObject({
      state: "no_data",
    });
    state.collection = { id: collectionId, status: "completed", normalized_result: null };
    await expect(analyzeMarketCollection({ collectionId, workspaceId })).resolves.toMatchObject({
      state: "no_data",
    });
  });

  it("accepts Claude output with harmless extra metadata keys", async () => {
    claudeTextPrompt.mockResolvedValue(
      JSON.stringify({
        ...validIntelligence,
        metadata: { model: "claude-opus-5", promptVersion: 3 },
        notes: "extra commentary",
      }),
    );
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("completed");
    expect(result.data).toMatchObject({ summary: validIntelligence.summary });
  });

  it("rejects malformed AI output safely", async () => {
    claudeTextPrompt.mockResolvedValue("not json");
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("malformed_response");
  });

  it("returns provider failures safely", async () => {
    claudeTextPrompt.mockRejectedValue(new Error("provider unavailable"));
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("failed");
    expect(result.error?.message).toBe("Market intelligence generation failed");
  });

  it("uses a validated cached result without calling Claude", async () => {
    const first = await analyzeMarketCollection({ collectionId, workspaceId });
    claudeTextPrompt.mockClear();
    const second = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(first.state).toBe("completed");
    expect(second.state).toBe("cached");
    expect(claudeTextPrompt).not.toHaveBeenCalled();
  });

  // Regression: max_tokens 3000 left no room for Opus 5's default adaptive
  // thinking, so the JSON was truncated and every analysis failed.
  it("requests structured output with room for thinking plus the full answer", async () => {
    await analyzeMarketCollection({ collectionId, workspaceId });
    const call = claudeTextPrompt.mock.calls[0][0];
    expect(call.maxTokens).toBeGreaterThanOrEqual(16_000);
    expect(call.effort).toBe("medium");
    expect(call.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(call.timeoutMs).toBeLessThan(90_000);
  });

  it("regenerates when the collection is refreshed in place with new data", async () => {
    await analyzeMarketCollection({ collectionId, workspaceId });
    state.collection!.completed_at = "2026-09-11T06:00:00.000Z";
    const refreshed = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(refreshed.state).toBe("completed");
    expect(claudeTextPrompt).toHaveBeenCalledTimes(2);
  });

  it("regenerates instead of returning an empty cached result when the cache entry is invalid", async () => {
    await analyzeMarketCollection({ collectionId, workspaceId });
    state.cached!.result = { summary: "" };
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("completed");
    expect(result.data?.summary).toBe(validIntelligence.summary);
    expect(claudeTextPrompt).toHaveBeenCalledTimes(2);
  });

  it("caps over-long lists instead of failing an otherwise valid analysis", async () => {
    claudeTextPrompt.mockResolvedValue(
      JSON.stringify({
        ...validIntelligence,
        relatedQueries: Array.from({ length: 30 }, (_, index) => `query ${index}`),
      }),
    );
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result.state).toBe("completed");
    expect(result.data?.relatedQueries).toHaveLength(20);
  });

  it("returns a truncation from the gateway as a failed state with its code", async () => {
    const { AnthropicGatewayError } = await import("@/lib/anthropic-gateway.server");
    const truncated = new AnthropicGatewayError(502, "cut off", "max_tokens");
    Object.assign(truncated, { status: 502, code: "max_tokens", message: "cut off" });
    claudeTextPrompt.mockRejectedValue(truncated);
    const result = await analyzeMarketCollection({ collectionId, workspaceId });
    expect(result).toMatchObject({ state: "failed", error: { code: "max_tokens" } });
  });
});
