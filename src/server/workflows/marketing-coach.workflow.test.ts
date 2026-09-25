import { afterEach, describe, expect, it, vi } from "vitest";

const synthesizeCoachBriefing = vi.hoisted(() => vi.fn());
vi.mock("@/server/research/coach-briefing.server", () => ({ synthesizeCoachBriefing }));

import { marketingCoachWorkflow } from "./marketing-coach.workflow";

afterEach(() => {
  synthesizeCoachBriefing.mockReset();
});

const minimalBriefing = {
  greeting: "Hi",
  headline: "Go",
  focus: {
    title: "Do it",
    why: "Because",
    action: { label: "Go", prompt: "go", intent: "ideate" },
  },
  wins: [],
  risks: [],
  competitors: [],
  market: [],
  plays: [],
  weekPlan: [],
  sources: [],
  generatedAt: "2026-01-15T09:00:00.000Z",
};

const input = {
  today: "2026-01-15T09:00:00.000Z",
  dayName: "Thursday",
  siteUrl: "https://mellox.ai",
  brandSeed: "Mellox",
  model: "anthropic/claude-opus-5.5",
  signals: {
    workspaceName: "Mellox",
    website: "https://mellox.ai",
    publishedLast7d: 0,
    scheduledNext7d: 0,
    pendingDrafts: 0,
    latestGeoScore: null,
    previousGeoScore: null,
    recentInsights: [],
    recentContent: [],
  },
  siteText: "",
  siteMeta: {},
  compResults: [],
  reviewResults: [],
  trendResults: [],
};

describe("marketingCoachWorkflow", () => {
  it("passes the real Date (reconstructed from the ISO input) to synthesizeCoachBriefing", async () => {
    synthesizeCoachBriefing.mockResolvedValue({ briefing: minimalBriefing, hasContent: true });

    const run = await marketingCoachWorkflow.createRun();
    const result = await run.start({ inputData: input });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.result).toEqual({ briefing: minimalBriefing, hasContent: true });
    expect(synthesizeCoachBriefing).toHaveBeenCalledOnce();
    const passed = synthesizeCoachBriefing.mock.calls[0][0];
    expect(passed.today).toBeInstanceOf(Date);
    expect(passed.today.toISOString()).toBe(input.today);
  });
});
