import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/api-auth", async (importActual) => ({
  ...(await importActual<typeof import("@/server/api-auth")>()),
  requireUserId: vi.fn(async () => ({ ok: true, userId: "test-user", claims: {}, supabase: {} })),
  checkWorkspaceMembership: vi.fn(async (_auth: unknown, workspaceId: string) => ({
    ok: true,
    workspaceId,
  })),
}));
vi.mock("@/server/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/server/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => null),
}));

const ensureMarketBrainSchedule = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@/lib/dataforseo/google-trends-collection.server", () => ({
  requestGoogleTrendsCollection: vi.fn(async () => ({
    state: "pending",
    collectionId: "11111111-1111-1111-1111-111111111111",
    taskId: "task-1",
  })),
  pollGoogleTrendsCollection: vi.fn(async () => ({
    state: "completed",
    collectionId: "11111111-1111-1111-1111-111111111111",
    taskId: "task-1",
    data: {
      keywords: ["AI marketing"],
      interestOverTime: [],
      relatedQueries: [],
      relatedTopics: [],
      regionalInterest: [],
    },
  })),
}));

vi.mock("@/lib/market-brain-scheduler.server", () => ({
  ensureMarketBrainSchedule,
}));

import { POST } from "./route";
import {
  pollGoogleTrendsCollection,
  requestGoogleTrendsCollection,
} from "@/lib/dataforseo/google-trends-collection.server";

describe("POST /api/market/trends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts one keyword", async () => {
    const response = await POST(
      new Request("http://localhost/api/market/trends", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "22222222-2222-2222-2222-222222222222",
          keywords: ["AI marketing"],
          location: "United States",
          language: "en",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("pending");
    expect(requestGoogleTrendsCollection).toHaveBeenCalledOnce();
  });

  it("polls a collection without blocking the original request", async () => {
    const response = await (
      await import("./route")
    ).GET(
      new Request(
        "http://localhost/api/market/trends?collectionId=11111111-1111-1111-1111-111111111111&workspaceId=22222222-2222-2222-2222-222222222222",
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("completed");
    expect(pollGoogleTrendsCollection).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      expect.stringMatching(/^market-poll-/),
    );
  });

  it("registers the workspace as a daily Market Brain schedule when provided", async () => {
    const response = await POST(
      new Request("http://localhost/api/market/trends", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "22222222-2222-2222-2222-222222222222",
          keywords: ["AI marketing"],
          location: "United States",
          language: "en",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(ensureMarketBrainSchedule).toHaveBeenCalledWith({
      workspaceId: "22222222-2222-2222-2222-222222222222",
      location: "United States",
      language: "en",
      keywords: ["AI marketing"],
    });
  });

  it("rejects missing keywords and more than five keywords", async () => {
    const missing = await POST(
      new Request("http://localhost/api/market/trends", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const tooMany = await POST(
      new Request("http://localhost/api/market/trends", {
        method: "POST",
        body: JSON.stringify({ keywords: ["one", "two", "three", "four", "five", "six"] }),
      }),
    );

    expect(missing.status).toBe(400);
    expect(tooMany.status).toBe(400);
    expect(requestGoogleTrendsCollection).not.toHaveBeenCalled();
  });
});
