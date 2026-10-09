// Autopilot, the calendar and Studio pulling the same way: which format a slot
// gets, what a week is made of, whose post a day belongs to, and what happens next.
import { describe, expect, it } from "vitest";
import { nextSteps, stepLine, stepWhen } from "./agenda";
import {
  brainLabels,
  creativeBrief,
  EMPTY_BRAINS,
  groundPicks,
  readBrainUse,
  withoutUnknownFacts,
  type BrainLists,
} from "./brief";
import type { ActionView, AutopilotView, ProgramView } from "./contracts";
import { formatMix, needsPicture, typesFor, withPicture } from "./formats";
import {
  budgetVerdict,
  calendarSlot,
  cycleSlots,
  effectiveSlot,
  estimateCost,
  freeSlots,
  type CycleSlot,
} from "./policy";
import { shapeWeek } from "./shape";

const NOW = new Date("2026-10-05T08:00:00Z");

const base = {
  starts_on: "2026-10-05",
  ends_on: "2026-12-27",
  posts_per_week: 7,
  platforms: ["instagram"],
  content_types: ["social", "image", "carousel", "video"],
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timezone: "UTC",
  video_cap_per_week: 1,
};

describe("formats", () => {
  it("leads with pictures on Instagram and with words on LinkedIn", () => {
    const all = ["social", "image", "carousel", "video"];
    const instagram = formatMix("instagram", all, 9);
    expect(instagram.filter((t) => t === "social")).toHaveLength(1);
    expect(instagram.filter((t) => t === "carousel" || t === "image")).toHaveLength(6);
    const linkedin = formatMix("linkedin", all, 8);
    expect(linkedin[0]).toBe("social");
    expect(linkedin.filter((t) => t === "social")).toHaveLength(3);
  });

  it("only uses what the person allowed and the channel can carry", () => {
    expect(typesFor("threads", ["carousel", "video"])).toEqual(["social"]);
    expect(new Set(formatMix("instagram", ["image"], 4))).toEqual(new Set(["image"]));
    expect(typesFor("linkedin", ["article", "social"])).toEqual(["social"]);
  });

  it("gives a text post a picture where words alone can't be posted", () => {
    expect(needsPicture("instagram")).toBe(true);
    expect(needsPicture("linkedin")).toBe(false);
    expect(withPicture("social", "instagram")).toBe(true);
    expect(withPicture("social", "linkedin")).toBe(false);
    expect(withPicture("carousel", "instagram")).toBe(false);
    expect(withPicture(null, "tiktok")).toBe(true);
  });

  it("prices that post with its picture, and counts it against the weekly limit", () => {
    const plain = estimateCost("social", "linkedin").credits;
    const pictured = estimateCost("social", "instagram").credits;
    expect(pictured).toBe(estimateCost("image").credits);
    expect(pictured).toBeGreaterThan(plain);
    const args = { type: "social" as const, usedVideos: 0, videoCap: 0, usedCredits: 0 };
    expect(budgetVerdict({ ...args, platform: "linkedin", creditCap: plain }).ok).toBe(true);
    expect(budgetVerdict({ ...args, platform: "instagram", creditCap: plain }).ok).toBe(false);
  });

  it("plans a mixed week, one video at most, and a different start the week after", () => {
    const one = cycleSlots(base, 1, NOW).map((s) => s.type);
    expect(one.length).toBeGreaterThanOrEqual(5);
    expect(new Set(one).size).toBeGreaterThanOrEqual(3);
    expect(one.filter((t) => t === "video").length).toBeLessThanOrEqual(1);
    const two = cycleSlots(base, 2, NOW).map((s) => s.type);
    expect(two).toHaveLength(7);
    expect(two.join()).not.toBe(formatMix("instagram", base.content_types, 7).join());
  });
});

describe("shape", () => {
  const slots = cycleSlots(base, 2, NOW);

  it("gives every feed post an aim and a theme, and rotates both", () => {
    const shape = shapeWeek(slots, {
      goal: "awareness",
      pillars: ["Tips", "Proof", "Team"],
      cycle: 2,
    });
    expect(shape.size).toBe(slots.length);
    const values = [...shape.values()];
    expect(new Set(values.map((v) => v.aim)).size).toBeGreaterThan(2);
    expect(new Set(values.map((v) => v.pillar))).toEqual(new Set(["Tips", "Proof", "Team"]));
  });

  it("starts the next week somewhere else", () => {
    const pillars = ["Tips", "Proof", "Team"];
    const first = (cycle: number) => {
      const week = cycleSlots(base, cycle, NOW);
      const shape = shapeWeek(week, { goal: "awareness", pillars, cycle });
      return [...week].sort((a, b) => a.at.localeCompare(b.at)).map((s) => shape.get(s.index)!);
    };
    expect(first(2)[0].pillar).not.toBe(first(3)[0].pillar);
  });

  it("leaves Stories and articles to their own rules", () => {
    const story: CycleSlot = { ...slots[0], index: 900, type: "story", allowedTypes: ["story"] };
    const article: CycleSlot = { ...slots[0], index: 901, type: "article", platform: null };
    const shape = shapeWeek([slots[0], story, article], { goal: "leads", pillars: [], cycle: 1 });
    expect([...shape.keys()]).toEqual([slots[0].index]);
    expect(shape.get(slots[0].index)!.pillar).toBeNull();
  });
});

describe("the calendar", () => {
  const slots = cycleSlots(base, 2, NOW);

  it("leaves a day and channel alone once a person has a post there", () => {
    const day = slots[2].date;
    const out = freeSlots(slots, [
      { date: day, platform: "instagram", title: "Our autumn sale" },
      { date: day, platform: "linkedin", title: "Another channel" },
      { date: slots[4].date, platform: null, title: "A blog post" },
    ]);
    expect(out.covered).toBe(1);
    expect(out.slots.some((s) => s.date === day)).toBe(false);
    expect(out.slots).toHaveLength(slots.length - 1);
  });

  it("keeps Stories whatever is on the feed that day", () => {
    const story: CycleSlot = { ...slots[0], index: 900, type: "story", allowedTypes: ["story"] };
    const out = freeSlots(
      [slots[0], story],
      [{ date: slots[0].date, platform: "instagram", title: "Mine" }],
    );
    expect(out.slots.map((s) => s.index)).toEqual([900]);
  });

  it("reads where a piece sits now, in the program's own time zone", () => {
    expect(calendarSlot({ calendar_date: "2026-10-09", calendar_time: "18:30" }, "UTC")).toBe(
      "2026-10-09T18:30:00.000Z",
    );
    expect(
      calendarSlot({ calendar_date: "2026-10-09", calendar_time: "18:30" }, "Asia/Karachi"),
    ).toBe("2026-10-09T13:30:00.000Z");
    expect(calendarSlot({ calendar_date: "2026-10-09" }, "UTC")).toBeNull();
    expect(calendarSlot({ calendar_date: "soon", calendar_time: "09:00" }, "UTC")).toBeNull();
  });

  it("follows a piece a person moved, and only then", () => {
    const planned = "2026-10-07T09:00:00.000Z";
    const same = [{ calendar_date: "2026-10-07", calendar_time: "09:00" }];
    const moved = [{ calendar_date: "2026-10-09", calendar_time: "18:30" }];
    expect(effectiveSlot(planned, same, "UTC")).toBe(planned);
    expect(effectiveSlot(planned, moved, "UTC")).toBe("2026-10-09T18:30:00.000Z");
    expect(effectiveSlot(planned, [{}], "UTC")).toBe(planned);
    expect(effectiveSlot(null, moved, "UTC")).toBe("2026-10-09T18:30:00.000Z");
  });
});

describe("what happens next", () => {
  const program = { status: "running" } as ProgramView;
  const action = (over: Partial<ActionView>): ActionView => ({
    id: Math.random().toString(36).slice(2),
    kind: "content",
    status: "planned",
    plannedFor: "2026-10-08T09:00:00.000Z",
    platform: "instagram",
    contentType: "carousel",
    title: "Five signs your grinder is the problem",
    brief: "",
    reason: "",
    opportunityId: null,
    contentItemIds: [],
    creditsCharged: 0,
    approvedVia: null,
    error: null,
    metrics: null,
    updatedAt: "2026-10-05T08:00:00.000Z",
    nextStepAt: "2026-10-05T09:00:00.000Z",
    ...over,
  });
  const view = (
    over: Partial<Pick<AutopilotView, "upcoming" | "approvals" | "proposed" | "tasks">> & {
      nextPlanAt?: string | null;
    },
  ) => ({ program, upcoming: [], approvals: [], proposed: [], tasks: [], ...over });

  it("lists the next things in time order, each with its own time", () => {
    const steps = nextSteps(
      view({
        upcoming: [
          action({ id: "post", status: "scheduled", plannedFor: "2026-10-06T11:00:00.000Z" }),
          action({ id: "write" }),
        ],
        tasks: [
          action({
            id: "mail",
            kind: "task",
            contentType: "weekly_report",
            nextStepAt: "2026-10-12T08:00:00.000Z",
          }),
        ],
        nextPlanAt: "2026-10-10T09:00:00.000Z",
      }),
    );
    expect(steps.map((s) => s.id)).toEqual(["write", "post", "plan", "mail"]);
    expect(steps.map((s) => s.verb)).toEqual([
      "Writes",
      "Posts",
      "Plans your next week",
      "Sends your weekly summary",
    ]);
  });

  it("keeps what waits for a person out unless asked", () => {
    const waiting = view({ approvals: [action({ id: "w", status: "needs_approval" })] });
    expect(nextSteps(waiting)).toHaveLength(0);
    expect(nextSteps(waiting, { withWaiting: true })[0]).toMatchObject({ id: "w", needsYou: true });
  });

  it("says nothing while paused", () => {
    const paused = {
      ...view({ upcoming: [action({})] }),
      program: { status: "paused" } as ProgramView,
    };
    expect(nextSteps(paused)).toEqual([]);
  });

  it("says when in plain words", () => {
    const now = new Date(2026, 9, 5, 8, 0, 0);
    expect(stepWhen(new Date(2026, 9, 5, 7, 0, 0).toISOString(), now)).toBe("Now");
    expect(stepWhen(new Date(2026, 9, 5, 14, 0, 0).toISOString(), now)).toMatch(/^Today /);
    expect(stepWhen(new Date(2026, 9, 6, 9, 0, 0).toISOString(), now)).toMatch(/^Tomorrow /);
    const [step] = nextSteps(view({ upcoming: [action({ status: "generating" })] }));
    expect(stepLine(step, now)).toBe("Writing now “Five signs your grinder is the problem”");
  });
});

describe("the brief a piece is made from", () => {
  const lists: BrainLists = {
    audience: [
      { name: "Agency owners", detail: "Wants fewer tools. Struggles with reporting." },
      { name: "In-house SEO leads", detail: "Wants proof for the board." },
    ],
    competitors: [{ name: "Rivalo", detail: "All-in-one, built for enterprises." }],
    market: [{ name: "AI answers replace clicks", detail: "Show how to be cited." }],
    trends: [{ name: "Carousels with one claim per slide (instagram)", detail: "Short slides." }],
  };

  it("only ever uses entries that are on the lists", () => {
    const use = groundPicks(
      {
        audience: 1,
        competitor: 7,
        market: 0,
        trend: -1,
        hook: "Your reports take a day. Ours take a minute.",
      },
      lists,
    );
    expect(use.audience?.name).toBe("In-house SEO leads");
    expect(use.competitor).toBeUndefined();
    expect(use.market?.name).toBe("AI answers replace clicks");
    expect(use.trend).toBeUndefined();
    expect(groundPicks({ audience: "Agency owners", market: 1.5 }, lists).market).toBeUndefined();
  });

  it("writes every piece for a real group, in turn, when the plan named none", () => {
    expect(groundPicks({}, lists, 0).audience?.name).toBe("Agency owners");
    expect(groundPicks({ audience: -1 }, lists, 1).audience?.name).toBe("In-house SEO leads");
    expect(groundPicks(undefined, EMPTY_BRAINS, 3)).toEqual({});
  });

  it("hands Studio one brief with what each brain said, and never asks to name a rival", () => {
    const use = groundPicks(
      {
        audience: 0,
        competitor: 0,
        market: 0,
        trend: 0,
        visual: "A dashboard with one number circled.",
      },
      lists,
    );
    const brief = creativeBrief({
      title: "One report instead of five",
      brief: "Show the Monday reporting scramble and the single view that ends it.",
      aim: "save",
      pillar: "Reporting",
      use,
    });
    expect(brief.startsWith("One report instead of five")).toBe(true);
    expect(brief).toContain("Written for one group of customers: Agency owners.");
    expect(brief).toContain("without ever naming them");
    expect(brief).toContain("Brand theme: Reporting");
    expect(brief).toContain("worth saving");
    expect(brief).toMatch(/What is shown \(the subject only[^)]*\): A dashboard/);
    expect(brief).not.toContain("..");
    expect(brief.length).toBeLessThanOrEqual(3_900);
    expect(brainLabels(use)).toEqual([
      "Brand DNA",
      "For: Agency owners",
      "Market: AI answers replace clicks",
      "Stands apart from: Rivalo",
      "Format: Carousels with one claim per slide (instagram)",
    ]);
  });

  it("reads a stored brief back without trusting its shape", () => {
    const use = groundPicks({ audience: 0, hook: "Stop exporting five CSVs every Monday." }, lists);
    expect(readBrainUse(JSON.parse(JSON.stringify(use)))).toEqual(use);
    expect(readBrainUse({ audience: "x", market: { name: "" }, hook: 4 })).toEqual({});
    expect(readBrainUse(null)).toEqual({});
    expect(brainLabels({})).toEqual(["Brand DNA"]);
  });
});

describe("figures nobody gave", () => {
  const known = (s: string) => !/\d/.test(s) || s.includes("6 agents");

  it("drops the sentence that carries one and keeps the rest of the idea", () => {
    const out = withoutUnknownFacts(
      "Show how a clear definition gets quoted. AI engines read the first 40 words. Our 6 agents check every page! Invite a reply.",
      known,
    );
    expect(out.removed).toBe(1);
    expect(out.text).toBe(
      "Show how a clear definition gets quoted. Our 6 agents check every page! Invite a reply.",
    );
  });

  it("leaves clean text alone and can empty a line that is only a claim", () => {
    expect(withoutUnknownFacts("One idea, said plainly.", known)).toEqual({
      text: "One idea, said plainly.",
      removed: 0,
    });
    expect(withoutUnknownFacts("Teams see 3x more leads", known).text).toBe("");
    expect(withoutUnknownFacts("", known)).toEqual({ text: "", removed: 0 });
  });
});
