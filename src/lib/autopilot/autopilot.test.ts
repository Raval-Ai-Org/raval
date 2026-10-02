import { describe, expect, it } from "vitest";
import type { AgencyAutopilotRow, ProgramRow } from "./contracts";
import {
  acceptRatings,
  candidateFingerprint,
  filterCandidates,
  isStale,
  matchEvidence,
  MIN_SCORE,
  scoreOpportunity,
  type Candidate,
} from "./opportunities";
import {
  budgetVerdict,
  cycleSlots,
  estimateCost,
  generateAt,
  isPastApproval,
  planVerdict,
  publishDecision,
  scheduleTime,
  totalWeeks,
  weekOf,
} from "./policy";
import { canTransition, isTerminal, WORKER_STATUSES } from "./state";
import { buildAutopilotAttention, needsYou, rowState, sortAgencyRows } from "./status";
import { addDaysYmd, ymdInZone, zonedInstant } from "./time";
import { underperformers } from "@/lib/studio/performance";
import { summarizeLearnings } from "./learn";

const NOW = new Date("2026-10-05T08:00:00Z");

const program: ProgramRow = {
  id: "p1",
  workspace_id: "w1",
  status: "running",
  pause_reason: null,
  mode: "autopilot",
  goal: "leads",
  goal_note: "",
  platforms: ["linkedin", "instagram"],
  content_types: ["social", "carousel"],
  posts_per_week: 4,
  weekdays: [],
  timezone: "UTC",
  starts_on: "2026-10-05",
  ends_on: "2026-11-01",
  style_id: null,
  credit_cap_per_week: 150,
  video_cap_per_week: 0,
  act_on_opportunities: false,
  acting_user_id: "u1",
  strategy: {},
  automations: ["geo_scan"],
  last_notified_at: null,
  cycle: 0,
  created_by: "u1",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  finished_at: null,
};

describe("time", () => {
  it("finds the instant a zoned wall clock reads a time, across daylight saving", () => {
    expect(zonedInstant("2026-07-01", "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(zonedInstant("2026-12-01", "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-12-01T08:00:00.000Z",
    );
    expect(zonedInstant("2026-07-01", "09:00", "Not/AZone").toISOString()).toBe(
      "2026-07-01T09:00:00.000Z",
    );
  });

  it("reads today's date in a zone and adds days", () => {
    expect(ymdInZone(new Date("2026-10-05T23:30:00Z"), "Asia/Karachi")).toBe("2026-10-06");
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("state", () => {
  it("only allows the documented moves", () => {
    expect(canTransition("content", "needs_approval", "approved")).toBe(true);
    expect(canTransition("content", "needs_approval", "scheduled")).toBe(false);
    expect(canTransition("content", "planned", "scheduled")).toBe(false);
    expect(canTransition("content", "approved", "needs_approval")).toBe(true);
    expect(canTransition("content", "published", "planned")).toBe(false);
    expect(canTransition("plan", "planned", "done")).toBe(true);
    expect(canTransition("scan", "planned", "needs_approval")).toBe(false);
  });

  it("never treats a terminal status as work for the worker", () => {
    for (const status of WORKER_STATUSES) expect(isTerminal(status)).toBe(false);
  });
});

describe("slots", () => {
  it("builds the week's slots on the chosen platforms with allowed formats", () => {
    const slots = cycleSlots(program, 1, NOW);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(4);
    for (const slot of slots) {
      expect(["linkedin", "instagram"]).toContain(slot.platform);
      expect(["social", "carousel"]).toContain(slot.type);
      expect(Date.parse(slot.at)).toBeGreaterThan(NOW.getTime());
    }
  });

  it("leaves out slots after the end date and never plans video past its limit", () => {
    const short = { ...program, ends_on: "2026-10-06" };
    expect(cycleSlots(short, 1, NOW).every((s) => s.date <= "2026-10-06")).toBe(true);
    const video = { ...program, content_types: ["video"], platforms: ["instagram"] };
    expect(cycleSlots(video, 1, NOW).every((s) => s.type === "social")).toBe(true);
    const oneVideo = { ...video, video_cap_per_week: 1, content_types: ["video", "social"] };
    expect(
      cycleSlots(oneVideo, 1, NOW).filter((s) => s.type === "video").length,
    ).toBeLessThanOrEqual(1);
  });

  it("adds one article a week when articles are allowed", () => {
    const withArticle = { ...program, content_types: ["social", "article"] };
    const articles = cycleSlots(withArticle, 1, NOW).filter((s) => s.type === "article");
    expect(articles).toHaveLength(1);
    expect(articles[0].platform).toBeNull();
  });

  it("counts weeks", () => {
    expect(totalWeeks(program)).toBe(4);
    expect(weekOf(program, "2026-10-05")).toBe(1);
    expect(weekOf(program, "2026-10-12")).toBe(2);
    expect(weekOf(program, "2026-10-01")).toBe(0);
  });
});

describe("planVerdict", () => {
  const slots = cycleSlots(program, 1, NOW);
  const good = (slot: number, title: string) => ({
    slot,
    title,
    brief: "Explain the problem our customers face and show the one step that fixes it.",
    reason: "It answers a question buyers ask.",
  });

  it("keeps valid proposals and drops unknown slots, weak ones and repeats", () => {
    const verdict = planVerdict({
      slots,
      proposals: [
        good(slots[0].index, "Why onboarding stalls in week two"),
        good(999, "A slot that does not exist"),
        { slot: slots[1].index, title: "Hi", brief: "short", reason: "" },
        good(slots[2].index, "Why onboarding stalls in week two again"),
      ],
      recentTitles: [],
      opportunityCount: 0,
      creditCap: 1000,
    });
    expect(verdict.items).toHaveLength(1);
    expect(verdict.dropped.map((d) => d.reason).sort()).toEqual([
      "duplicate",
      "unknown_slot",
      "weak",
    ]);
  });

  it("refuses a title that repeats recent work", () => {
    const verdict = planVerdict({
      slots,
      proposals: [good(slots[0].index, "Five pricing mistakes founders make")],
      recentTitles: ["Five pricing mistakes that founders make"],
      opportunityCount: 0,
      creditCap: 1000,
    });
    expect(verdict.items).toHaveLength(0);
  });

  it("stops at the weekly credit limit", () => {
    const cost = estimateCost("social").credits;
    const verdict = planVerdict({
      slots,
      proposals: slots.map((s, i) => ({
        ...good(
          s.index,
          [
            "Pricing pages that convert",
            "Hiring your first marketer",
            "Churn warning signs",
            "Cold outreach openers",
          ][i % 4],
        ),
        type: "social",
      })),
      recentTitles: [],
      opportunityCount: 0,
      creditCap: cost,
    });
    expect(verdict.items).toHaveLength(1);
    expect(verdict.dropped.some((d) => d.reason === "budget")).toBe(true);
  });

  it("ignores a format the slot does not allow and an opportunity that was never shown", () => {
    const verdict = planVerdict({
      slots,
      proposals: [
        { ...good(slots[0].index, "A launch teaser for the new plan"), type: "ad", opportunity: 7 },
      ],
      recentTitles: [],
      opportunityCount: 2,
      creditCap: 1000,
    });
    expect(verdict.items[0].type).toBe(slots[0].type);
    expect(verdict.items[0].opportunity).toBeNull();
  });
});

describe("budget and timing", () => {
  it("blocks on credits and on videos separately", () => {
    const base = { usedCredits: 0, usedVideos: 0, creditCap: 5, videoCap: 0 };
    expect(budgetVerdict({ ...base, type: "social" })).toEqual({ ok: false, reason: "credits" });
    expect(budgetVerdict({ ...base, type: "video", creditCap: 1000 })).toEqual({
      ok: false,
      reason: "videos",
    });
    expect(budgetVerdict({ ...base, type: "social", creditCap: 1000 })).toEqual({ ok: true });
  });

  it("makes a piece ahead of its slot, and never schedules in the past", () => {
    expect(generateAt("2026-10-20T09:00:00Z", NOW).toISOString()).toBe("2026-10-17T09:00:00.000Z");
    expect(generateAt("2026-10-06T09:00:00Z", NOW).toISOString()).toBe(NOW.toISOString());
    expect(scheduleTime("2026-10-01T09:00:00Z", NOW).getTime()).toBeGreaterThan(NOW.getTime());
    expect(scheduleTime("2026-10-20T09:00:00Z", NOW).toISOString()).toBe(
      "2026-10-20T09:00:00.000Z",
    );
    expect(isPastApproval("2026-10-01T09:00:00Z", NOW)).toBe(true);
    expect(isPastApproval("2026-10-04T09:00:00Z", NOW)).toBe(false);
  });
});

describe("publishDecision", () => {
  const clean = {
    mode: "full" as const,
    fullEnabled: true,
    hasProgram: true,
    contentType: "social",
    warnings: 0,
    inventedFacts: 0,
    autoApprovedToday: 0,
    accountConnected: true,
  };

  it("approves by itself only when everything is clean", () => {
    expect(publishDecision(clean)).toEqual({ auto: true, reasons: [] });
  });

  it.each([
    [{ mode: "autopilot" as const }, "mode"],
    [{ mode: "assist" as const }, "mode"],
    [{ fullEnabled: false }, "full_not_enabled"],
    [{ contentType: "video" }, "format"],
    [{ contentType: "article" }, "format"],
    [{ warnings: 1 }, "quality_warnings"],
    [{ inventedFacts: 1 }, "unverified_facts"],
    [{ autoApprovedToday: 2 }, "daily_cap"],
    [{ accountConnected: false }, "account_not_connected"],
    [{ hasProgram: false }, "one_off"],
  ])("needs a person when %o", (patch, reason) => {
    const decision = publishDecision({ ...clean, ...patch });
    expect(decision.auto).toBe(false);
    expect(decision.reasons).toContain(reason);
  });
});

describe("opportunities", () => {
  const candidate = (over: Partial<Candidate> = {}): Candidate => ({
    kind: "competitor",
    title: "Acme launches an AI automation suite",
    summary: "Acme announced a new automation product for agencies.",
    evidence: [
      { title: "Acme blog", url: "https://acme.com/blog/launch?utm_source=x", date: "2026-10-03" },
    ],
    sourceKind: "competitor_update",
    sourceId: "u1",
    significance: "major",
    date: "2026-10-03T00:00:00Z",
    ...over,
  });
  const opts = { knownFingerprints: new Set<string>(), recentTitles: [], now: NOW };

  it("fingerprints by the cleaned source link", () => {
    expect(candidateFingerprint(candidate())).toBe("competitor:https://acme.com/blog/launch");
    expect(candidateFingerprint(candidate({ evidence: [] }))).toMatch(/^competitor:t:/);
  });

  it("drops stale, unsourced, known and repeated candidates", () => {
    expect(isStale(candidate({ date: "2026-08-01T00:00:00Z" }), NOW)).toBe(true);
    expect(filterCandidates([candidate({ date: "2026-08-01T00:00:00Z" })], opts)).toHaveLength(0);
    expect(filterCandidates([candidate({ evidence: [] })], opts)).toHaveLength(0);
    expect(
      filterCandidates(
        [
          candidate({
            evidence: [{ title: "x", url: "https://drive.google.com/file/1", date: null }],
          }),
        ],
        opts,
      ),
    ).toHaveLength(0);
    expect(
      filterCandidates([candidate()], {
        ...opts,
        knownFingerprints: new Set(["competitor:https://acme.com/blog/launch"]),
      }),
    ).toHaveLength(0);
    expect(
      filterCandidates([candidate()], {
        ...opts,
        recentTitles: ["Acme launches AI automation suite"],
      }),
    ).toHaveLength(0);
    const twice = filterCandidates(
      [
        candidate(),
        candidate({
          evidence: [{ title: "Other", url: "https://news.example.com/acme", date: null }],
        }),
      ],
      opts,
    );
    expect(twice).toHaveLength(1);
  });

  it("keeps an internal performance signal without a link", () => {
    const perf = candidate({
      kind: "performance",
      evidence: [],
      title: "Recent linkedin posts reached fewer people",
    });
    expect(filterCandidates([perf], opts)).toHaveLength(1);
  });

  it("scores from relevance, freshness, significance and source", () => {
    const strong = scoreOpportunity(candidate(), 90, NOW);
    const weak = scoreOpportunity(
      candidate({ significance: "minor", date: "2026-09-16T00:00:00Z" }),
      55,
      NOW,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it("accepts ratings only for shown candidates, once, above the bar and grounded", () => {
    const list = [candidate(), candidate({ title: "Beta raises a round", sourceId: "u2" })];
    const rating = (index: number, relevance: number) => ({
      index,
      relevance,
      why: "It touches how we position against automation tools.",
      action: "Create a LinkedIn post showing how we differ?",
      format: "social",
    });
    const rated = acceptRatings(
      list,
      [rating(0, 90), rating(0, 95), rating(5, 99), rating(1, 30)],
      NOW,
    );
    expect(rated).toHaveLength(1);
    expect(rated[0].candidate.sourceId).toBe("u1");
    expect(acceptRatings(list, [rating(0, 90)], NOW, () => false)).toHaveLength(0);
    expect(acceptRatings(list, [{ ...rating(0, 90), format: "podcast" }], NOW)[0].format).toBe(
      "social",
    );
  });

  it("attaches only sources that share real words with a claim", () => {
    const sources = [
      {
        title: "Agencies adopt AI automation for reporting",
        url: "https://a.example.com/1",
        snippet: "",
      },
      { title: "Cooking with cast iron", url: "https://b.example.com/2", snippet: "" },
    ];
    const evidence = matchEvidence("AI automation is reshaping agency reporting", sources);
    expect(evidence.map((e) => e.url)).toEqual(["https://a.example.com/1"]);
    expect(matchEvidence("Something unrelated entirely", sources)).toEqual([]);
  });
});

describe("agency status", () => {
  const row = (over: Partial<AgencyAutopilotRow>): AgencyAutopilotRow => ({
    workspaceId: "w1",
    programId: "p1",
    status: "running",
    pauseReason: null,
    mode: "autopilot",
    endsOn: "2026-11-01",
    needsApproval: 0,
    planWaiting: 0,
    newOpportunities: 0,
    failures: 0,
    missed: 0,
    performanceWarnings: 0,
    nextActionAt: null,
    nextActionTitle: null,
    ...over,
  });

  it("labels each client's state", () => {
    expect(rowState(row({ programId: null, status: null })).label).toBe("Off");
    expect(rowState(row({})).tone).toBe("good");
    expect(rowState(row({ needsApproval: 2 })).tone).toBe("warn");
    expect(rowState(row({ failures: 1 })).tone).toBe("risk");
    expect(rowState(row({ status: "paused", pauseReason: "user" })).tone).toBe("warn");
    expect(rowState(row({ status: "paused", pauseReason: "member_left" })).tone).toBe("risk");
  });

  it("puts the clients that need a person first", () => {
    const rows = sortAgencyRows([
      row({ workspaceId: "calm" }),
      row({ workspaceId: "approve", needsApproval: 3 }),
      row({ workspaceId: "broken", failures: 1 }),
    ]);
    expect(rows.map((r) => r.workspaceId)).toEqual(["broken", "approve", "calm"]);
    expect(needsYou(row({ needsApproval: 2, planWaiting: 4, failures: 1 }))).toBe(4);
  });

  it("writes the attention lines in plain words", () => {
    const items = buildAutopilotAttention(
      [row({ needsApproval: 2 }), row({ workspaceId: "w2", failures: 1, newOpportunities: 3 })],
      (id) => (id === "w1" ? "Acme" : "Beta"),
    );
    expect(items.map((i) => i.id)).toEqual([
      "autopilot-failures",
      "autopilot-approvals",
      "autopilot-opportunities",
    ]);
    expect(items[1].title).toBe("Acme is waiting on you");
  });
});

describe("learnings", () => {
  const piece = (title: string, platform: string, views: number, contentType = "social") => ({
    title,
    platform,
    contentType,
    views,
  });

  it("says nothing until there is enough to go on", () => {
    expect(summarizeLearnings([piece("A", "linkedin", 500), piece("B", "linkedin", 300)])).toEqual(
      [],
    );
  });

  it("names the best post and the stronger platform", () => {
    const lines = summarizeLearnings([
      piece("Grinder guide", "linkedin", 1800),
      piece("Roast day", "linkedin", 1200),
      piece("Friday latte", "instagram", 400),
      piece("New cups", "instagram", 600),
    ]);
    expect(lines[0]).toContain("Grinder guide");
    expect(lines[1]).toBe("LinkedIn reaches about 3× more people than Instagram.");
  });

  it("does not call one lucky post a pattern", () => {
    const lines = summarizeLearnings([
      piece("A", "linkedin", 5000),
      piece("B", "instagram", 300),
      piece("C", "facebook", 200),
    ]);
    expect(lines).toHaveLength(1);
  });
});

describe("underperformers", () => {
  const content = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`,
    title: `Post ${i}`,
    status: "published",
  }));
  const pub = (i: number, views: number) => ({
    content_item_id: `c${i}`,
    platform: "linkedin",
    status: "published",
    metrics: { views },
  });

  it("flags recent posts far below the workspace's own usual", () => {
    const low = underperformers(content, [
      pub(0, 60),
      pub(1, 900),
      pub(2, 1000),
      pub(3, 1100),
      pub(4, 950),
      pub(5, 1000),
    ]);
    expect(low.map((l) => l.contentItemId)).toEqual(["c0"]);
    expect(low[0].usualViews).toBeGreaterThan(900);
  });

  it("says nothing for a small or quiet account", () => {
    expect(underperformers(content, [pub(0, 10), pub(1, 900), pub(2, 1000)])).toEqual([]);
    expect(
      underperformers(content, [pub(0, 5), pub(1, 40), pub(2, 50), pub(3, 60), pub(4, 45)]),
    ).toEqual([]);
  });
});
