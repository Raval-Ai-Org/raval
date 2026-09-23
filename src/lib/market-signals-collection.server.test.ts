import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  // Test hook: runs after the Nth select-mode maybeSingle() read.
  afterRead: null as null | ((readIndex: number) => void),
  reads: 0,
}));

// Mirrors the live table's CHECK (status IN ('pending','completed','failed')).
const ALLOWED_STATUSES = new Set(["pending", "completed", "failed"]);
const checkViolation = {
  code: "23514",
  message: 'violates check constraint "market_trend_collections_status_check"',
};

// Distinct per write, like the table's touch_updated_at() trigger.
let clock = 0;
function nextTimestamp() {
  clock = Math.max(clock + 1, Date.now());
  return new Date(clock).toISOString();
}

function builder() {
  let mode = "select";
  let values: Record<string, unknown> = {};
  let id: string | undefined;
  let requestKey: string | undefined;
  let updatedAt: string | undefined;
  let workspace: string | undefined;
  const violatesCheck = () => "status" in values && !ALLOWED_STATUSES.has(String(values.status));
  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: string) {
      if (column === "id") id = value;
      if (column === "request_key") requestKey = value;
      if (column === "updated_at") updatedAt = value;
      if (column === "workspace_id") workspace = value;
      return chain;
    },
    insert(input: Record<string, unknown>) {
      mode = "insert";
      values = input;
      return chain;
    },
    update(input: Record<string, unknown>) {
      mode = "update";
      values = input;
      return chain;
    },
    async maybeSingle() {
      if (mode === "update") {
        if (violatesCheck()) return { data: null, error: checkViolation };
        // Compare-and-set: nothing matches once updated_at has moved on.
        const row = state.rows.find(
          (candidate) =>
            candidate.id === id && (updatedAt === undefined || candidate.updated_at === updatedAt),
        );
        if (!row) return { data: null, error: null };
        Object.assign(row, values, { updated_at: nextTimestamp() });
        return { data: { ...row }, error: null };
      }
      const found =
        state.rows.find(
          (row) =>
            (id ? row.id === id : row.request_key === requestKey) &&
            (workspace === undefined || row.workspace_id === workspace),
        ) ?? null;
      const snapshot = found ? { ...found } : null;
      state.afterRead?.(state.reads++);
      return { data: snapshot, error: null };
    },
    async single() {
      if (violatesCheck()) return { data: null, error: checkViolation };
      if (mode === "insert") {
        const now = nextTimestamp();
        const row = {
          id: `collection-${state.rows.length + 1}`,
          requested_at: new Date().toISOString(),
          updated_at: now,
          ...values,
        };
        state.rows.push(row);
        return { data: { ...row }, error: null };
      }
      const row = state.rows.find((candidate) => candidate.id === id);
      if (!row) return { data: null, error: new Error("missing row") };
      Object.assign(row, values, { updated_at: nextTimestamp() });
      return { data: { ...row }, error: null };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn(() => builder()) },
}));

const collectMarketSignals = vi.hoisted(() => vi.fn());

vi.mock("@/server/research/market-signals.server", async () => {
  const actual = await vi.importActual<typeof import("@/server/research/market-signals.server")>(
    "@/server/research/market-signals.server",
  );
  return { ...actual, collectMarketSignals };
});

import {
  marketSignalsRequestKey,
  pollMarketSignalsCollection,
  requestMarketSignalsCollection,
} from "./market-signals-collection.server";
import { BudgetExceededError } from "@/server/ai/budget";

const input = { keywords: ["AI marketing"], location: "United States" };
const workspaceId = "workspace-1";

function signals(sourceCount: number) {
  return {
    keywords: input.keywords,
    location: input.location,
    sources: Array.from({ length: sourceCount }, (_, index) => ({
      title: `Source ${index}`,
      url: `https://example.com/${index}`,
      snippet: "snippet",
      domain: "example.com",
      publishedDate: "2026-09-10",
    })),
  };
}

beforeEach(() => {
  state.rows.length = 0;
  state.afterRead = null;
  state.reads = 0;
  vi.clearAllMocks();
  collectMarketSignals.mockResolvedValue(signals(3));
});

describe("Market signals collection cache", () => {
  it("deduplicates concurrent searches for the same lens", async () => {
    const [first, second] = await Promise.all([
      requestMarketSignalsCollection(input, workspaceId),
      requestMarketSignalsCollection(input, workspaceId),
    ]);

    expect(first.state).toBe("completed");
    expect(second.collectionId).toBe(first.collectionId);
    expect(collectMarketSignals).toHaveBeenCalledOnce();
  });

  it("runs the search inline and returns completed directly", async () => {
    const result = await requestMarketSignalsCollection(input, workspaceId);
    expect(result.state).toBe("completed");
    expect(result.data?.sources).toHaveLength(3);
  });

  it("returns a fresh completed result from cache without searching again", async () => {
    state.rows.push({
      id: "cached-1",
      workspace_id: workspaceId,
      request_key: marketSignalsRequestKey(input),
      provider: "tavily",
      keywords: input.keywords,
      location: input.location,
      status: "completed",
      normalized_result: signals(1),
      provider_error: null,
      requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await requestMarketSignalsCollection(input, workspaceId);

    expect(result.state).toBe("cached");
    expect(result.data?.sources).toHaveLength(1);
    expect(collectMarketSignals).not.toHaveBeenCalled();
  });

  it("stores provider errors as failed and reports a retry cooldown", async () => {
    collectMarketSignals.mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await requestMarketSignalsCollection(input, workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.message).toBe("provider unavailable");

    const again = await requestMarketSignalsCollection(input, workspaceId);
    expect(again.state).toBe("failed");
    expect(again.retryAfterSeconds).toBeGreaterThan(0);
    expect(collectMarketSignals).toHaveBeenCalledOnce();
  });

  it("treats an empty result as no_data and reuses it within the TTL", async () => {
    collectMarketSignals.mockResolvedValueOnce(signals(0));
    const result = await requestMarketSignalsCollection(input, workspaceId);
    expect(result.state).toBe("no_data");
    expect(result.error?.code).toBe("no_data");
    expect(state.rows[0]).toMatchObject({ status: "completed", normalized_result: null });

    const again = await requestMarketSignalsCollection(input, workspaceId);
    expect(again.state).toBe("no_data");
    expect(collectMarketSignals).toHaveBeenCalledOnce();
  });

  it("reclaims a stale pending row instead of reusing it forever", async () => {
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    state.rows.push({
      id: "stale-1",
      workspace_id: workspaceId,
      request_key: marketSignalsRequestKey(input),
      provider: "tavily",
      keywords: input.keywords,
      location: input.location,
      status: "pending",
      normalized_result: null,
      provider_error: null,
      requested_at: stale,
      completed_at: null,
      updated_at: stale,
    });

    const result = await requestMarketSignalsCollection(input, workspaceId);

    expect(result.state).toBe("completed");
    expect(collectMarketSignals).toHaveBeenCalledOnce();
  });

  it("does not run a second search when a concurrent request already claimed the row", async () => {
    const expired = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    state.rows.push({
      id: "expired-1",
      workspace_id: workspaceId,
      request_key: marketSignalsRequestKey(input),
      provider: "tavily",
      keywords: input.keywords,
      location: input.location,
      status: "completed",
      normalized_result: signals(1),
      provider_error: null,
      requested_at: expired,
      completed_at: expired,
      updated_at: expired,
    });
    // Another instance claims the row between this request's read and its write.
    state.afterRead = (readIndex) => {
      if (readIndex !== 0) return;
      Object.assign(state.rows[0], {
        status: "pending",
        normalized_result: null,
        requested_at: new Date().toISOString(),
        updated_at: nextTimestamp(),
      });
    };

    const result = await requestMarketSignalsCollection(input, workspaceId);

    expect(result.state).toBe("pending");
    expect(collectMarketSignals).not.toHaveBeenCalled();
  });

  it("keeps the previous result stored while a refresh runs and after it fails", async () => {
    const expired = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    state.rows.push({
      id: "old-1",
      workspace_id: workspaceId,
      request_key: marketSignalsRequestKey(input),
      provider: "tavily",
      keywords: input.keywords,
      status: "completed",
      normalized_result: signals(1),
      provider_error: null,
      requested_at: expired,
      completed_at: expired,
      updated_at: expired,
    });
    collectMarketSignals.mockRejectedValueOnce(new Error("provider unavailable"));

    const refresh = await requestMarketSignalsCollection(input, workspaceId);
    expect(refresh.state).toBe("failed");
    expect(state.rows[0]).toMatchObject({ status: "failed", normalized_result: signals(1) });
  });

  it("propagates a budget error and marks the row failed", async () => {
    collectMarketSignals.mockImplementation(() => {
      throw new BudgetExceededError("search", "AI allowance reached for this period.");
    });
    await expect(requestMarketSignalsCollection(input, workspaceId)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(state.rows[0]).toMatchObject({ status: "failed" });
  });

  it("poll fails a row still pending past the stale cutoff (crash recovery)", async () => {
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    state.rows.push({
      id: "crashed-1",
      workspace_id: workspaceId,
      request_key: marketSignalsRequestKey(input),
      provider: "tavily",
      keywords: input.keywords,
      status: "pending",
      normalized_result: null,
      provider_error: null,
      requested_at: stale,
      completed_at: null,
      updated_at: stale,
    });

    const result = await pollMarketSignalsCollection("crashed-1", workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("provider_timeout");
  });

  it("does not poll a collection that belongs to another workspace", async () => {
    const started = await requestMarketSignalsCollection(input, workspaceId);
    const result = await pollMarketSignalsCollection(started.collectionId!, "workspace-2");
    expect(result.state).toBe("no_data");
    expect(result.data).toBeUndefined();
  });
});
