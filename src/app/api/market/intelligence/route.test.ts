import { beforeEach, describe, expect, it, vi } from "vitest";

const checkWorkspaceMembership = vi.hoisted(() => vi.fn());
const analyzeMarketCollection = vi.hoisted(() => vi.fn());

vi.mock("@/server/api-auth", async (importActual) => ({
  ...(await importActual<typeof import("@/server/api-auth")>()),
  requireUserId: vi.fn(async () => ({ ok: true, userId: "user-1", claims: {}, supabase: {} })),
  checkWorkspaceMembership,
}));
vi.mock("@/server/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/server/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/market-intelligence.server", () => ({
  MarketIntelligenceError: class MarketIntelligenceError extends Error {
    status = 502;
  },
  analyzeMarketCollection,
}));

import { POST } from "./route";

const workspaceId = "22222222-2222-2222-2222-222222222222";
const collectionId = "11111111-1111-1111-1111-111111111111";

function request(body: unknown) {
  return new Request("http://localhost/api/market/intelligence", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkWorkspaceMembership.mockResolvedValue({ ok: true, workspaceId });
  analyzeMarketCollection.mockResolvedValue({ state: "pending", collectionId });
});

describe("POST /api/market/intelligence", () => {
  it("returns pending without invoking AI itself", async () => {
    const response = await POST(request({ workspaceId, collectionId }));
    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("pending");
    expect(analyzeMarketCollection).toHaveBeenCalledWith({
      workspaceId,
      collectionId,
      analysisType: undefined,
      operation: expect.stringMatching(/^market-intelligence-/),
    });
  });

  it("returns unauthorized workspace access", async () => {
    checkWorkspaceMembership.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not a member" }, { status: 403 }),
    });
    const response = await POST(request({ workspaceId, collectionId }));
    expect(response.status).toBe(403);
    expect(analyzeMarketCollection).not.toHaveBeenCalled();
  });

  it("returns completed intelligence from the service", async () => {
    analyzeMarketCollection.mockResolvedValue({
      state: "completed",
      collectionId,
      data: {
        summary: "Grounded result",
        trendSignals: [],
        opportunities: [],
        recommendations: [],
        relatedQueries: [],
        relatedTopics: [],
        confidence: "low",
        generatedAt: "2026-09-10T00:00:00.000Z",
      },
    });
    const response = await POST(request({ workspaceId, collectionId }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.summary).toBe("Grounded result");
  });

  it("passes a provider failure through with its code instead of a generic error", async () => {
    analyzeMarketCollection.mockResolvedValue({
      state: "failed",
      collectionId,
      error: { message: "Claude output was cut off", status: 502, code: "max_tokens" },
    });
    const response = await POST(request({ workspaceId, collectionId }));
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      state: "failed",
      error: { code: "max_tokens", message: "Claude output was cut off" },
    });
  });

  it("answers a slow analysis with a structured 504 before the client gives up", async () => {
    vi.useFakeTimers();
    analyzeMarketCollection.mockReturnValue(new Promise(() => {}));
    const pending = POST(request({ workspaceId, collectionId }));
    await vi.advanceTimersByTimeAsync(90_001);
    const response = await pending;
    vi.useRealTimers();
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      state: "failed",
      collectionId,
      error: { code: "timeout" },
    });
  });
});
