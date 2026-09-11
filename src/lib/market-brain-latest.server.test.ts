import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  completed: null as Record<string, unknown> | null,
  recent: null as Record<string, unknown> | null,
  cache: null as Record<string, unknown> | null,
  schedule: null as Record<string, unknown> | null,
  calls: [] as { table: string; filters: Record<string, unknown> }[],
}));

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  let completedOnly = false;
  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return chain;
    },
    not() {
      completedOnly = true;
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    async maybeSingle() {
      state.calls.push({ table, filters });
      if (table === "market_trend_collections") {
        return { data: completedOnly ? state.completed : state.recent, error: null };
      }
      if (table === "market_intelligence_cache") return { data: state.cache, error: null };
      if (table === "scheduled_jobs") return { data: state.schedule, error: null };
      return { data: null, error: null };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn((table: string) => builder(table)) },
}));

import { getLatestMarketBrain } from "./market-brain-latest.server";

const workspaceId = "22222222-2222-2222-2222-222222222222";
const completedAt = "2026-09-11T06:00:00.000Z";
const trendData = {
  keywords: ["AI marketing"],
  interestOverTime: [{ timestamp: 1, date: "2026-09-01", values: [80] }],
  relatedQueries: [],
  relatedTopics: [],
  regionalInterest: [],
};
const intelligence = {
  summary: "Interest is strong.",
  trendSignals: [],
  opportunities: [],
  recommendations: [],
  relatedQueries: [],
  relatedTopics: [],
  confidence: "medium",
  generatedAt: "2026-09-11T06:01:00.000Z",
};

beforeEach(() => {
  state.calls.length = 0;
  state.completed = {
    id: "collection-1",
    status: "completed",
    keywords: ["AI marketing"],
    location: "United States",
    requested_at: completedAt,
    completed_at: completedAt,
    updated_at: completedAt,
    normalized_result: trendData,
    provider_error: null,
  };
  state.recent = { ...state.completed };
  state.cache = { result: intelligence, updated_at: "2026-09-11T06:01:00.000Z" };
  state.schedule = { next_run_at: "2026-09-12T06:00:00.000Z", last_run_status: "ok" };
});

describe("getLatestMarketBrain", () => {
  it("returns the latest result with its analysis, freshness and schedule", async () => {
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest.result).toMatchObject({
      collectionId: "collection-1",
      keywords: ["AI marketing"],
      location: "United States",
      completedAt,
      data: trendData,
    });
    expect(latest.intelligence?.summary).toBe("Interest is strong.");
    expect(latest.freshUntil).toBe("2026-09-11T12:00:00.000Z");
    expect(latest.schedule).toEqual({ nextRunAt: "2026-09-12T06:00:00.000Z", lastRunStatus: "ok" });
    expect(latest.activeScan).toBeNull();
    expect(latest.lastError).toBeNull();
    // Every query is scoped to the workspace.
    for (const call of state.calls) expect(call.filters.workspace_id).toBe(workspaceId);
  });

  it("ignores an analysis written for an older version of the data", async () => {
    state.cache = { result: intelligence, updated_at: "2026-09-10T06:00:00.000Z" };
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest.result?.data).toEqual(trendData);
    expect(latest.intelligence).toBeNull();
  });

  it("ignores a cached analysis that no longer matches the schema", async () => {
    state.cache = { result: { summary: "" }, updated_at: "2026-09-11T07:00:00.000Z" };
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest.intelligence).toBeNull();
  });

  it("reports a scan still running so the client can resume it", async () => {
    const requestedAt = new Date(Date.now() - 60_000).toISOString();
    state.recent = { ...state.completed!, status: "pending", requested_at: requestedAt };
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest.activeScan).toEqual({
      collectionId: "collection-1",
      keywords: ["AI marketing"],
      location: "United States",
      requestedAt,
    });
    // The previous result stays available while the refresh runs.
    expect(latest.result?.data).toEqual(trendData);
  });

  it("does not resume a scan past the stale cutoff", async () => {
    state.recent = {
      ...state.completed!,
      status: "pending",
      requested_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    };
    expect((await getLatestMarketBrain(workspaceId)).activeScan).toBeNull();
  });

  it("keeps the previous result and reports the error when the last scan failed", async () => {
    state.recent = {
      ...state.completed!,
      status: "failed",
      provider_error: { message: "Payment Required.", providerCode: 40200 },
    };
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest.lastError).toEqual({ message: "Payment Required." });
    expect(latest.result?.data).toEqual(trendData);
  });

  it("returns an empty snapshot for a workspace without scans", async () => {
    state.completed = null;
    state.recent = null;
    state.schedule = null;
    const latest = await getLatestMarketBrain(workspaceId);
    expect(latest).toEqual({
      result: null,
      intelligence: null,
      activeScan: null,
      lastError: null,
      schedule: null,
      freshUntil: null,
    });
  });
});
