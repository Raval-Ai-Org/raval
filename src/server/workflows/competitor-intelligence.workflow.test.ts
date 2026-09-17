import { afterEach, describe, expect, it, vi } from "vitest";

const crawlCompetitorPages = vi.hoisted(() => vi.fn());
const synthesizeCompetitorProfile = vi.hoisted(() => vi.fn());
vi.mock("@/server/research/competitor-intel.server", () => ({
  crawlCompetitorPages,
  synthesizeCompetitorProfile,
}));

import { competitorIntelligenceWorkflow } from "./competitor-intelligence.workflow";

afterEach(() => {
  crawlCompetitorPages.mockReset();
  synthesizeCompetitorProfile.mockReset();
});

describe("competitorIntelligenceWorkflow", () => {
  it("runs the crawl step then the synthesize step and returns the final result", async () => {
    const pages = [{ url: "https://competitor.com", markdown: "text", links: [] }];
    crawlCompetitorPages.mockResolvedValue(pages);
    const profile = {
      positioning: "Positioned for solo founders",
      strengths: ["Fast onboarding"],
      weaknesses: [],
      targetAudience: "Solo founders",
      pricingSignals: "$29/mo",
      differentiators: [],
      contentThemes: [],
      evidence: [],
      pagesCrawled: ["https://competitor.com"],
    };
    synthesizeCompetitorProfile.mockResolvedValue(profile);

    const run = await competitorIntelligenceWorkflow.createRun();
    const result = await run.start({ inputData: { competitorUrl: "https://competitor.com" } });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result).toEqual(profile);
    }
    expect(crawlCompetitorPages).toHaveBeenCalledWith("https://competitor.com");
    expect(synthesizeCompetitorProfile).toHaveBeenCalledWith("https://competitor.com", pages);
  });

  it("fails the run when the crawl step throws", async () => {
    crawlCompetitorPages.mockRejectedValue(new Error("Firecrawl unreachable"));

    const run = await competitorIntelligenceWorkflow.createRun();
    const result = await run.start({ inputData: { competitorUrl: "https://competitor.com" } });

    expect(result.status).toBe("failed");
    expect(synthesizeCompetitorProfile).not.toHaveBeenCalled();
  });
});
