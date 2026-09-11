import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  // Test hook: runs after the Nth select-mode maybeSingle() read.
  afterRead: null as null | ((readIndex: number) => void),
  reads: 0,
}));

// Mirrors the live table's CHECK (status IN ('pending','completed','failed')).
// The previous mock accepted "no_data", which the real database rejects (23514).
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

vi.mock("@/lib/dataforseo/google-trends.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dataforseo/google-trends.server")>(
    "@/lib/dataforseo/google-trends.server",
  );
  return {
    ...actual,
    createGoogleTrendsTask: vi.fn(async () => ({ taskId: "task-1" })),
    getGoogleTrendsTask: vi.fn(async () => ({
      id: "task-1",
      status: "pending",
      statusCode: 20100,
    })),
  };
});

import {
  pollGoogleTrendsCollection,
  requestGoogleTrendsCollection,
  trendRequestKey,
} from "./google-trends-collection.server";
import {
  createGoogleTrendsTask,
  DataForSeoError,
  getGoogleTrendsTask,
} from "./google-trends.server";

const input = { keywords: ["AI marketing"], location: "United States", language: "en" };
const workspaceId = "workspace-1";

function trends(values: number[]) {
  return {
    keywords: input.keywords,
    interestOverTime: [{ timestamp: 1, date: "2024-01-01", values }],
    relatedQueries: [],
    relatedTopics: [],
    regionalInterest: [],
  };
}

beforeEach(() => {
  state.rows.length = 0;
  state.afterRead = null;
  state.reads = 0;
  vi.clearAllMocks();
});

describe("Google Trends collection cache", () => {
  it("deduplicates concurrent task creation", async () => {
    const [first, second] = await Promise.all([
      requestGoogleTrendsCollection(input, workspaceId),
      requestGoogleTrendsCollection(input, workspaceId),
    ]);

    expect(first.state).toBe("pending");
    expect(second.collectionId).toBe(first.collectionId);
    expect(createGoogleTrendsTask).toHaveBeenCalledOnce();
  });

  it("returns a fresh completed result from cache", async () => {
    state.rows.push({
      id: "cached-1",
      workspace_id: workspaceId,
      request_key: trendRequestKey(input),
      keywords: input.keywords,
      location: input.location,
      language: input.language,
      date_from: null,
      date_to: null,
      time_range: null,
      dataforseo_task_id: "task-cached",
      status: "completed",
      normalized_result: trends([7]),
      provider_error: null,
      requested_at: new Date().toISOString(),
      last_polled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await requestGoogleTrendsCollection(input, workspaceId);

    expect(result.state).toBe("cached");
    expect(result.data?.interestOverTime[0]?.values).toEqual([7]);
    expect(createGoogleTrendsTask).not.toHaveBeenCalled();
  });

  it("persists pending, completed, and failed poll states", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    const pending = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(pending.state).toBe("pending");

    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      statusCode: 20000,
      data: trends([9]),
    });
    const completed = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(completed.state).toBe("completed");
    expect(completed.data?.interestOverTime[0]?.values).toEqual([9]);

    state.rows[0].status = "pending";
    state.rows[0].dataforseo_task_id = "task-1";
    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "failed",
      statusCode: 40200,
      statusMessage: "Provider failed",
    });
    const failed = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(failed.state).toBe("failed");
    expect(failed.error?.message).toBe("Provider failed");
  });

  it("stores provider errors as failed state", async () => {
    vi.mocked(createGoogleTrendsTask).mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await requestGoogleTrendsCollection(input, workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.message).toBe("Google Trends collection failed");
  });

  it("reports the retry cooldown and keeps the provider message on a recent failure", async () => {
    vi.mocked(createGoogleTrendsTask).mockRejectedValueOnce(
      new DataForSeoError("DataForSEO task creation failed: Payment Required.", 502, 40200),
    );
    await requestGoogleTrendsCollection(input, workspaceId);
    const again = await requestGoogleTrendsCollection(input, workspaceId);
    expect(again.state).toBe("failed");
    expect(again.error).toMatchObject({
      message: expect.stringContaining("Payment Required"),
      providerCode: 40200,
    });
    expect(again.retryAfterSeconds).toBeGreaterThan(0);
    expect(createGoogleTrendsTask).toHaveBeenCalledOnce();
  });

  it("reclaims stale pending collections instead of reusing them forever", async () => {
    const stale = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    state.rows.push({
      id: "stale-1",
      workspace_id: workspaceId,
      request_key: trendRequestKey(input),
      keywords: input.keywords,
      location: input.location,
      language: input.language,
      status: "pending",
      dataforseo_task_id: "old-task",
      normalized_result: null,
      provider_error: null,
      requested_at: stale,
      last_polled_at: stale,
      completed_at: null,
      updated_at: stale,
    });

    const result = await requestGoogleTrendsCollection(input, workspaceId);

    expect(result.state).toBe("pending");
    expect(createGoogleTrendsTask).toHaveBeenCalledOnce();
    expect(state.rows[0]?.dataforseo_task_id).toBe("task-1");
  });

  it("measures pending staleness from requested_at, which polling does not refresh", async () => {
    const stale = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    state.rows.push({
      id: "polled-1",
      workspace_id: workspaceId,
      request_key: trendRequestKey(input),
      keywords: input.keywords,
      status: "pending",
      dataforseo_task_id: "old-task",
      normalized_result: null,
      provider_error: null,
      requested_at: stale,
      last_polled_at: new Date().toISOString(),
      completed_at: null,
      // A poll a moment ago bumped updated_at through the touch trigger.
      updated_at: new Date().toISOString(),
    });

    await requestGoogleTrendsCollection(input, workspaceId);

    expect(createGoogleTrendsTask).toHaveBeenCalledOnce();
  });

  it("does not create a second provider task when a concurrent request reclaimed the row", async () => {
    const expired = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    state.rows.push({
      id: "expired-1",
      workspace_id: workspaceId,
      request_key: trendRequestKey(input),
      keywords: input.keywords,
      status: "completed",
      dataforseo_task_id: "old-task",
      normalized_result: trends([5]),
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
        dataforseo_task_id: "task-other",
        normalized_result: null,
        requested_at: new Date().toISOString(),
        updated_at: nextTimestamp(),
      });
    };

    const result = await requestGoogleTrendsCollection(input, workspaceId);

    expect(result.state).toBe("pending");
    expect(result.taskId).toBe("task-other");
    expect(createGoogleTrendsTask).not.toHaveBeenCalled();
  });

  it("persists no_data in a form the status CHECK constraint accepts", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      statusCode: 20000,
    });

    const result = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);

    expect(result.state).toBe("no_data");
    expect(result.error?.code).toBe("no_data");
    expect(state.rows[0]).toMatchObject({
      status: "completed",
      normalized_result: null,
      provider_error: { code: "no_data" },
    });
    // A later scan within the TTL reuses the answer instead of paying again.
    const again = await requestGoogleTrendsCollection(input, workspaceId);
    expect(again.state).toBe("no_data");
    expect(createGoogleTrendsTask).toHaveBeenCalledOnce();
  });

  it("treats data without any measured signal as no_data", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      statusCode: 20000,
      data: trends([0]),
    });
    const result = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(result.state).toBe("no_data");
    expect(state.rows[0]?.normalized_result).toBeNull();
  });

  it("stays pending on a transient status-check failure", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    vi.mocked(getGoogleTrendsTask).mockRejectedValueOnce(
      new DataForSeoError("DataForSEO request timed out", 504, undefined, true),
    );
    const result = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(result.state).toBe("pending");
    expect(result.error?.message).toBe("DataForSEO request timed out");
    expect(state.rows[0]?.status).toBe("pending");
  });

  it("fails a task that is still pending past the stale cutoff", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    state.rows[0].requested_at = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    const result = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("provider_timeout");
    expect(state.rows[0]?.status).toBe("failed");
  });

  it("fails a pending row whose provider task was never created", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    state.rows[0].dataforseo_task_id = null;
    state.rows[0].requested_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const result = await pollGoogleTrendsCollection(started.collectionId!, workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("task_not_created");
  });

  it("keeps the previous result stored while a refresh runs and after it fails", async () => {
    const expired = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    state.rows.push({
      id: "old-1",
      workspace_id: workspaceId,
      request_key: trendRequestKey(input),
      keywords: input.keywords,
      status: "completed",
      dataforseo_task_id: "old-task",
      normalized_result: trends([5]),
      provider_error: null,
      requested_at: expired,
      completed_at: expired,
      updated_at: expired,
    });

    const refresh = await requestGoogleTrendsCollection(input, workspaceId);
    expect(refresh.state).toBe("pending");
    expect(refresh.data).toBeUndefined();
    expect(state.rows[0]).toMatchObject({
      status: "pending",
      normalized_result: trends([5]),
      completed_at: expired,
    });

    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "failed",
      statusCode: 40200,
      statusMessage: "Provider failed",
    });
    const failed = await pollGoogleTrendsCollection(refresh.collectionId!, workspaceId);
    expect(failed.state).toBe("failed");
    expect(failed.data).toBeUndefined();
    expect(state.rows[0]).toMatchObject({ status: "failed", normalized_result: trends([5]) });
  });

  it("does not poll a collection that belongs to another workspace", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    const result = await pollGoogleTrendsCollection(started.collectionId!, "workspace-2");
    expect(result.state).toBe("no_data");
    expect(result.data).toBeUndefined();
    expect(getGoogleTrendsTask).not.toHaveBeenCalled();
  });
});
