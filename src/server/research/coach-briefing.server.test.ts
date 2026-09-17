import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeCoachBriefing, type CoachSynthesisInput } from "./coach-briefing.server";

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  vi.unstubAllGlobals();
});

const baseInput: CoachSynthesisInput = {
  today: new Date("2026-01-15T09:00:00.000Z"),
  dayName: "Thursday",
  siteUrl: "https://mellox.ai",
  brandSeed: "Mellox",
  model: "claude-sonnet-5",
  signals: {
    workspaceName: "Mellox",
    website: "https://mellox.ai",
    publishedLast7d: 2,
    scheduledNext7d: 1,
    pendingDrafts: 3,
    latestGeoScore: 72,
    previousGeoScore: 65,
    recentInsights: [],
    recentContent: [],
  },
  brandContext: "Mellox helps small teams market like agencies.",
  siteText: "Mellox homepage text",
  siteMeta: { description: "AI marketing intelligence" },
  compResults: [{ title: "Rival Co", url: "https://rival.example", snippet: "A competitor" }],
  reviewResults: [],
  trendResults: [],
};

function stubClaude(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(body) }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
  );
}

describe("synthesizeCoachBriefing", () => {
  it("normalizes a real model response and reports hasContent", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubClaude({
      greeting: "Good morning, Mellox",
      headline: "Momentum day",
      focus: {
        title: "Publish today",
        why: "Consistency compounds",
        action: { label: "Draft", prompt: "Draft a post", intent: "social" },
      },
      wins: [{ title: "Score up", detail: "GEO score rose" }],
      risks: [],
      competitors: [],
      market: [],
      plays: [],
      weekPlan: ["Ship the post"],
    });

    const { briefing, hasContent } = await synthesizeCoachBriefing(baseInput);

    expect(hasContent).toBe(true);
    expect(briefing.greeting).toBe("Good morning, Mellox");
    expect(briefing.focus.title).toBe("Publish today");
    expect(briefing.sources[0]).toEqual({
      label: "Competitor: Rival Co",
      url: "https://rival.example",
    });
  });

  it("falls back to a scan-baseline focus when the model returns nothing usable", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubClaude({});

    const { briefing, hasContent } = await synthesizeCoachBriefing({
      ...baseInput,
      signals: { ...baseInput.signals, latestGeoScore: null },
    });

    expect(hasContent).toBe(false);
    expect(briefing.focus.title).toBe("Run your first AI Visibility scan");
  });

  it("asks the user to add a website when none is on file", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubClaude({});

    const { briefing } = await synthesizeCoachBriefing({ ...baseInput, siteUrl: null });

    expect(briefing.focus.title).toBe("Add your website so I can research your brand");
  });
});
