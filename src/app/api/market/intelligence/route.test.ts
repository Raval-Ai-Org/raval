import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceAccess = vi.hoisted(() => vi.fn());
const analyzeMarketCollection = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdr.helpers.server", () => ({ requireWorkspaceAccess }));
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
  requireWorkspaceAccess.mockResolvedValue({ ok: true, userId: "user-1", workspaceId });
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
    });
  });

  it("returns unauthorized workspace access", async () => {
    requireWorkspaceAccess.mockResolvedValue({
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
});
