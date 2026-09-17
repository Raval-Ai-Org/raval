import { afterEach, describe, expect, it, vi } from "vitest";

const scanRow = vi.hoisted(() => ({
  id: "scan-1",
  workspace_id: "ws-1",
  url: "https://mellox.ai",
  origin: "https://mellox.ai",
  host: "mellox.ai",
  mode: "full",
  trigger: "manual",
  status: "done",
  stage: "done",
  config: {},
  progress: {},
  overall_score: 72,
  category_scores: { crawlability: 80, structure: 65 },
  report: null,
  probes: null,
  previous_scan_id: null,
  error: null,
  cancel_requested: false,
  lease_until: null,
  created_at: "2026-01-01T00:00:00.000Z",
  started_at: null,
  completed_at: null,
}));

const maybeSingle = vi.hoisted(() => vi.fn().mockResolvedValue({ data: scanRow, error: null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle,
      };
      return chain;
    }),
  },
}));

// The nested competitorIntelligenceWorkflow depends on these two functions —
// mocking them (not runCompetitorIntel, which this workflow no longer calls
// directly) exercises the real nested-workflow composition end to end.
const crawlCompetitorPages = vi.hoisted(() => vi.fn());
const synthesizeCompetitorProfile = vi.hoisted(() => vi.fn());
vi.mock("@/server/research/competitor-intel.server", () => ({
  crawlCompetitorPages,
  synthesizeCompetitorProfile,
}));

import { geoAeoAuditWorkflow } from "./geo-aeo-audit.workflow";

afterEach(() => {
  crawlCompetitorPages.mockReset();
  synthesizeCompetitorProfile.mockReset();
  maybeSingle.mockClear();
});

describe("geoAeoAuditWorkflow", () => {
  it("reads the scan then analyzes each competitor, tolerating a per-competitor failure", async () => {
    crawlCompetitorPages.mockResolvedValue([{ url: "x", markdown: "x", links: [] }]);
    synthesizeCompetitorProfile
      .mockResolvedValueOnce({
        positioning: "Enterprise-first",
        strengths: ["Scale"],
        weaknesses: [],
        targetAudience: "",
        pricingSignals: "",
        differentiators: [],
        contentThemes: [],
        evidence: [],
        pagesCrawled: [],
      })
      .mockRejectedValueOnce(new Error("Firecrawl timed out"));

    const run = await geoAeoAuditWorkflow.createRun();
    const result = await run.start({
      inputData: {
        workspaceId: "ws-1",
        scanId: "scan-1",
        competitorUrls: ["https://a.com", "https://b.com"],
      },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.result.scan).toMatchObject({
      scanId: "scan-1",
      host: "mellox.ai",
      overallScore: 72,
    });
    expect(result.result.competitors).toEqual([
      expect.objectContaining({
        competitorUrl: "https://a.com",
        ok: true,
        positioning: "Enterprise-first",
      }),
      expect.objectContaining({
        competitorUrl: "https://b.com",
        ok: false,
        error: "Firecrawl timed out",
      }),
    ]);
  });

  it("fails the run when the scan doesn't exist for this workspace", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const run = await geoAeoAuditWorkflow.createRun();
    const result = await run.start({
      inputData: { workspaceId: "ws-1", scanId: "missing", competitorUrls: [] },
    });

    expect(result.status).toBe("failed");
    expect(crawlCompetitorPages).not.toHaveBeenCalled();
  });
});
