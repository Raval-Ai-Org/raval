import { describe, expect, it } from "vitest";
import { StrategySchema as AutopilotStrategySchema } from "@/lib/autopilot/contracts";
import type { StrategyFacts } from "./contracts";
import {
  groundStrategy,
  normalizeShares,
  strategyBlock,
  toAutopilotStrategy,
  urlKey,
} from "./ground";

const COMP = "11111111-1111-4111-8111-111111111111";
const facts: StrategyFacts = {
  competitors: [{ id: COMP, name: "Rivalry Inc" }],
  sources: [{ url: "https://news.test/ai-search-rises/", title: "AI search rises" }],
  audiences: ["Busy founders"],
  platforms: ["linkedin"],
};

const raw = {
  positioning: {
    statement: "Acme helps small teams ship marketing without an agency.",
    promise: "A week of posts in ten minutes",
    differentiators: ["Built for small teams", "Shows its sources"],
  },
  goal: {
    type: "leads",
    summary: "Bring in more demo requests.",
    metric: "Demo requests",
    target: "20 a month",
  },
  audiences: [
    { name: "busy founders", why: "No time for marketing", message: "Marketing that runs itself" },
    { name: "Invented Segment", why: "", message: "" },
  ],
  voice: "Plain, warm, direct",
  pillars: [
    { title: "How-to tips", detail: "One thing to do today", share: 50 },
    { title: "Customer wins", detail: "Real results", share: 30 },
    { title: "Behind the scenes", detail: "", share: 30 },
  ],
  channels: [
    { platform: "TikTok", role: "Reach", perWeek: 2, formats: ["video"] },
    { platform: "linkedin", role: "Trust", perWeek: 3.4, formats: ["post", "carousel"] },
  ],
  messages: {
    attract: "Stop guessing",
    convince: "See the sources",
    convert: "Start free",
    keep: "",
  },
  competitors: [
    { competitorId: COMP, name: "wrong name", theirAngle: "Cheapest", ourEdge: "We show proof" },
    {
      competitorId: "22222222-2222-4222-8222-222222222222",
      name: "Ghost Co",
      theirAngle: "",
      ourEdge: "x y",
    },
  ],
  plays: [
    {
      title: "Answer AI search questions",
      detail: "",
      sourceUrl: "https://www.news.test/ai-search-rises",
      sourceTitle: "made up",
    },
    {
      title: "Ride a made-up trend",
      detail: "",
      sourceUrl: "https://nowhere.test/x",
      sourceTitle: "",
    },
    { title: "No link at all", detail: "", sourceUrl: "", sourceTitle: "" },
  ],
  roadmap: [{ phase: "Days 1–30", focus: "Set the base", actions: ["Post three times a week"] }],
  kpis: [{ label: "Demo requests", target: "20", why: "The goal" }],
  rules: { do: ["Lead with the benefit"], dont: ["No jargon"] },
};

describe("groundStrategy", () => {
  const s = groundStrategy(raw, facts)!;

  it("keeps only competitors the workspace tracks, under their real name", () => {
    expect(s.competitors).toEqual([
      { competitorId: COMP, name: "Rivalry Inc", theirAngle: "Cheapest", ourEdge: "We show proof" },
    ]);
  });

  it("keeps only market plays whose source was really collected", () => {
    expect(s.plays).toHaveLength(1);
    expect(s.plays[0].sourceUrl).toBe("https://news.test/ai-search-rises/");
    expect(s.plays[0].sourceTitle).toBe("AI search rises");
  });

  it("speaks only to audience groups that exist", () => {
    expect(s.audiences.map((a) => a.name)).toEqual(["Busy founders"]);
  });

  it("keeps any audience when no groups are set up yet", () => {
    const open = groundStrategy(raw, { ...facts, audiences: [] })!;
    expect(open.audiences).toHaveLength(2);
  });

  it("makes theme shares add up to 100", () => {
    expect(s.pillars.reduce((n, p) => n + p.share, 0)).toBe(100);
  });

  it("puts connected channels first and rounds the cadence", () => {
    expect(s.channels[0]).toMatchObject({ platform: "linkedin", perWeek: 3 });
  });

  it("refuses an answer that isn't a strategy", () => {
    expect(groundStrategy({ ...raw, pillars: [] }, facts)).toBeNull();
    expect(
      groundStrategy({ ...raw, goal: { ...raw.goal, type: "world peace" } }, facts),
    ).toBeNull();
    expect(groundStrategy(null, facts)).toBeNull();
  });
});

describe("normalizeShares", () => {
  it("handles zeros, junk and rounding", () => {
    expect(normalizeShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalizeShares([0, 0])).toEqual([50, 50]);
    expect(normalizeShares([Number.NaN, 5])).toEqual([0, 100]);
    expect(normalizeShares([])).toEqual([]);
  });
});

describe("urlKey", () => {
  it("ignores www, case and a trailing slash", () => {
    expect(urlKey("https://WWW.News.test/a/")).toBe(urlKey("http://news.test/a"));
    expect(urlKey("not a url")).toBe("");
  });
});

describe("what the rest of Mellox reads", () => {
  const s = groundStrategy(raw, facts)!;

  it("maps to the strategy Autopilot plans against", () => {
    const auto = toAutopilotStrategy(s);
    expect(AutopilotStrategySchema.safeParse(auto).success).toBe(true);
    expect(auto.pillars.map((p) => p.title)).toEqual(s.pillars.map((p) => p.title));
    expect(auto.audience).toContain("Busy founders");
  });

  it("writes a capped, stable prompt block", () => {
    const block = strategyBlock(s);
    expect(block).toBe(strategyBlock(s));
    expect(block).toContain("Against Rivalry Inc: We show proof");
    expect(block).toContain("How-to tips");
    expect(strategyBlock(s, 120).length).toBeLessThanOrEqual(120);
  });
});
