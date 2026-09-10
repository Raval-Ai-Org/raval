import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

function builder() {
  let mode = "select";
  let values: Record<string, unknown> | Record<string, unknown>[] = {};
  let id: string | undefined;
  let requestKey: string | undefined;
  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: string) {
      if (column === "id") id = value;
      if (column === "request_key") requestKey = value;
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
      return {
        data:
          state.rows.find((row) => (id ? row.id === id : row.request_key === requestKey)) ?? null,
        error: null,
      };
    },
    async single() {
      if (mode === "insert") {
        const row = {
          id: `collection-${state.rows.length + 1}`,
          requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...values,
        };
        state.rows.push(row);
        return { data: row, error: null };
      }
      const row = state.rows.find((candidate) => candidate.id === id);
      if (!row) return { data: null, error: new Error("missing row") };
      Object.assign(row, values, { updated_at: new Date().toISOString() });
      return { data: row, error: null };
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
} from "./google-trends-collection.server";
import { createGoogleTrendsTask, getGoogleTrendsTask } from "./google-trends.server";

const input = { keywords: ["AI marketing"], location: "United States", language: "en" };
const workspaceId = "workspace-1";

beforeEach(() => {
  state.rows.length = 0;
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
      request_key: "wrong-key",
      keywords: input.keywords,
      location: input.location,
      language: input.language,
      date_from: null,
      date_to: null,
      time_range: null,
      dataforseo_task_id: "task-cached",
      status: "completed",
      normalized_result: {
        keywords: input.keywords,
        interestOverTime: [{ timestamp: 1, date: "2024-01-01", values: [7] }],
        relatedQueries: [],
        relatedTopics: [],
        regionalInterest: [],
      },
      provider_error: null,
      requested_at: new Date().toISOString(),
      last_polled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Use the service's key so the fixture remains independent of implementation details.
    const { trendRequestKey } = await import("./google-trends-collection.server");
    state.rows[0].request_key = trendRequestKey(input);
    const result = await requestGoogleTrendsCollection(input, workspaceId);

    expect(result.state).toBe("cached");
    expect(result.data?.interestOverTime[0]?.values).toEqual([7]);
    expect(createGoogleTrendsTask).not.toHaveBeenCalled();
  });

  it("persists pending, completed, and failed poll states", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    const pending = await pollGoogleTrendsCollection(started.collectionId!);
    expect(pending.state).toBe("pending");

    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      statusCode: 20000,
      data: {
        keywords: input.keywords,
        interestOverTime: [{ timestamp: 1, date: "2024-01-01", values: [9] }],
        relatedQueries: [],
        relatedTopics: [],
        regionalInterest: [],
      },
    });
    const completed = await pollGoogleTrendsCollection(started.collectionId!);
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
    const failed = await pollGoogleTrendsCollection(started.collectionId!);
    expect(failed.state).toBe("failed");
    expect(failed.error?.message).toBe("Provider failed");
  });

  it("stores provider errors as failed state", async () => {
    vi.mocked(createGoogleTrendsTask).mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await requestGoogleTrendsCollection(input, workspaceId);
    expect(result.state).toBe("failed");
    expect(result.error?.message).toBe("Google Trends collection failed");
  });

  it("reclaims stale pending collections instead of reusing them forever", async () => {
    const stale = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    state.rows.push({
      id: "stale-1",
      workspace_id: workspaceId,
      request_key: (await import("./google-trends-collection.server")).trendRequestKey(input),
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

  it("persists no_data when the provider completes without usable data", async () => {
    const started = await requestGoogleTrendsCollection(input, workspaceId);
    vi.mocked(getGoogleTrendsTask).mockResolvedValueOnce({
      id: "task-1",
      status: "completed",
      statusCode: 20000,
    });

    const result = await pollGoogleTrendsCollection(started.collectionId!);

    expect(result.state).toBe("no_data");
    expect(state.rows[0]?.status).toBe("no_data");
  });
});
