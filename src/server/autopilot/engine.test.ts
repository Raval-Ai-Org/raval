import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRow, ProgramRow } from "@/lib/autopilot/contracts";
import type { Candidate } from "@/lib/autopilot/opportunities";
import type { CalendarPost } from "@/lib/autopilot/policy";
import type { BrainLists } from "@/lib/autopilot/brief";
import {
  actionsFromOpportunity,
  enqueueScan,
  runSweep,
  type AutopilotPorts,
  type ContentLite,
  type JobLite,
} from "./engine";
import { createMemoryAutopilotStore, type MemoryAutopilotStore } from "./store.memory";

const WS = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000bb";

type World = {
  clock: Date;
  store: MemoryAutopilotStore;
  ports: AutopilotPorts;
  content: Map<string, ContentLite>;
  jobs: Map<string, JobLite & { key: string }>;
  created: string[];
  scheduled: { id: string; at: string }[];
  role: "owner" | "admin" | "editor" | "viewer" | null;
  paused: boolean;
  enabled: boolean;
  full: boolean;
  invented: number;
  candidates: Candidate[];
  relevance: number;
  createError: Error | null;
  scheduleReason: string | null;
  learnings: string[];
  tasksRun: string[];
  sentToSite: string[];
  blog: boolean;
  calendar: CalendarPost[];
  brains: BrainLists;
};

function world(): World {
  const w = {
    clock: new Date("2026-10-05T08:00:00Z"),
    content: new Map<string, ContentLite>(),
    jobs: new Map<string, JobLite & { key: string }>(),
    created: [] as string[],
    scheduled: [] as { id: string; at: string }[],
    role: "editor" as World["role"],
    paused: false,
    enabled: true,
    full: false,
    invented: 0,
    candidates: [] as Candidate[],
    relevance: 90,
    createError: null as Error | null,
    scheduleReason: null as string | null,
    learnings: [] as string[],
    tasksRun: [] as string[],
    sentToSite: [] as string[],
    blog: true,
    calendar: [] as CalendarPost[],
    brains: { audience: [], competitors: [], market: [], trends: [] } as BrainLists,
  } as World;
  w.store = createMemoryAutopilotStore(() => w.clock);
  let n = 0;
  w.ports = {
    now: () => w.clock,
    enabled: () => w.enabled,
    fullEnabled: () => w.full,
    storiesEnabled: () => true,
    automationPaused: async () => w.paused,
    memberRole: async () => w.role,
    connectedPlatforms: async () => ["linkedin", "instagram"],
    content: {
      get: async (_ws, ids) =>
        ids.map((id) => w.content.get(id)).filter((c): c is ContentLite => Boolean(c)),
      tag: async (_ws, id, tag) => {
        const item = w.content.get(id);
        if (item)
          item.meta = {
            ...item.meta,
            autopilot_action_id: tag.actionId,
            calendar_date: tag.date,
            calendar_time: tag.time,
          };
      },
      approve: async (_ws, id) => {
        const item = w.content.get(id);
        if (!item || item.status !== "pending") return false;
        item.status = "approved";
        return true;
      },
    },
    studio: {
      findJob: async (_ws, key) => [...w.jobs.values()].find((j) => j.key === key) ?? null,
      create: async ({ idempotencyKey, action }) => {
        if (w.createError) throw w.createError;
        const contentId = `c${++n}`;
        w.content.set(contentId, {
          id: contentId,
          status: "pending",
          title: action.title,
          body: "Body",
          channel: action.platform,
          media_url: null,
          scheduled_at: null,
          meta: { platform: action.platform },
          metrics: {},
        });
        const job = {
          id: `j${n}`,
          key: idempotencyKey,
          status: "succeeded" as const,
          contentItemIds: [contentId],
          warnings: 0,
          error: null,
          createdAt: w.clock.toISOString(),
        };
        w.jobs.set(job.id, job);
        w.created.push(idempotencyKey);
        return { job, credits: 12 };
      },
      advance: async (_ws, jobId) => w.jobs.get(jobId) ?? null,
    },
    schedule: async ({ contentItemId, at }) => {
      if (w.scheduleReason) return { reason: w.scheduleReason };
      const item = w.content.get(contentItemId)!;
      // The real publisher refuses anything that isn't approved.
      if (item.status !== "approved")
        return { reason: "Content must be approved before scheduling" };
      item.status = "scheduled";
      item.scheduled_at = at;
      w.scheduled.push({ id: contentItemId, at });
      return { reason: null };
    },
    plan: {
      recentTitles: async () => [],
      learnings: async () => w.learnings,
      storyHours: async () => [],
      calendar: async () => w.calendar,
      brains: async () => w.brains,
      propose: async ({ slots }) =>
        slots.map((s, i) => ({
          slot: s.index,
          title: [
            "Pricing pages that convert",
            "Hiring your first marketer",
            "Churn warning signs",
            "Cold outreach openers",
          ][i % 4],
          brief: "Explain the problem our customers face and show the one step that fixes it.",
          reason: "Buyers ask about this.",
        })),
    },
    tasks: {
      run: async (name) => {
        w.tasksRun.push(name);
        return { status: "done", summary: "Started the scan." };
      },
    },
    site: {
      publishArticle: async ({ contentItemId }) => {
        if (!w.blog) return { status: "skipped", summary: "No blog is set up:" };
        // The real publisher keeps one publication per article.
        if (!w.sentToSite.includes(contentItemId)) w.sentToSite.push(contentItemId);
        return { status: "sent", summary: "Sent to example.com:" };
      },
    },
    scan: {
      collect: async () => w.candidates,
      rate: async (_ws, list) =>
        list.map((_c, index) => ({
          index,
          relevance: w.relevance,
          why: "It touches how we position against automation tools.",
          action: "Create a LinkedIn post showing how we differ?",
          format: "social",
        })),
      grounded: async () => true,
      inventedFacts: async () => w.invented,
    },
  };
  return w;
}

async function program(w: World, over: Partial<ProgramRow> = {}): Promise<ProgramRow> {
  const row = await w.store.insertProgram({
    workspace_id: WS,
    status: "running",
    mode: "autopilot",
    goal: "leads",
    goal_note: "",
    platforms: ["linkedin"],
    content_types: ["social"],
    posts_per_week: 2,
    weekdays: [],
    timezone: "UTC",
    starts_on: "2026-10-05",
    ends_on: "2026-11-01",
    credit_cap_per_week: 150,
    video_cap_per_week: 0,
    act_on_opportunities: false,
    acting_user_id: USER,
    created_by: USER,
  });
  if (Object.keys(over).length) await w.store.updateProgram(row.id, over);
  return (await w.store.getProgram(row.id))!;
}

async function piece(
  w: World,
  p: ProgramRow | null,
  over: Partial<ActionRow> = {},
): Promise<ActionRow> {
  const [row] = await w.store.insertActions([
    {
      workspace_id: WS,
      program_id: p?.id ?? null,
      kind: "content",
      status: "planned",
      dedupe_key: `content:test:${Math.random()}`,
      cycle: 1,
      planned_for: "2026-10-07T09:00:00.000Z",
      platform: "linkedin",
      content_type: "social",
      title: "Pricing pages that convert",
      brief: "Explain the problem our customers face.",
      requested_by: p ? null : USER,
      next_attempt_at: w.clock.toISOString(),
    },
  ]);
  if (Object.keys(over).length)
    Object.assign(
      w.store.actions.find((a) => a.id === row.id)!,
      over,
    );
  return w.store.actions.find((a) => a.id === row.id)!;
}

const sweep = (w: World) => runSweep(w.store, w.ports, { worker: "test-worker" });
const tick = (w: World, minutes: number) => {
  w.clock = new Date(w.clock.getTime() + minutes * 60_000);
};

let w: World;
beforeEach(() => {
  w = world();
});

describe("plan", () => {
  it("turns a week into content actions and queues next week's plan", async () => {
    const p = await program(w);
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    const content = w.store.actions.filter((a) => a.kind === "content");
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((a) => a.status === "planned" && a.platform === "linkedin")).toBe(true);
    expect(w.store.actions.some((a) => a.dedupe_key === `plan:${p.id}:2`)).toBe(true);
    expect(w.store.events.some((e) => e.kind === "plan_ready")).toBe(true);
    expect(w.created).toHaveLength(0);
  });

  it("starts the week's other work (the AI visibility check) once, and passes on what it learned", async () => {
    const p = await program(w);
    w.learnings = ["LinkedIn reaches about 2× more people than Instagram."];
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    const plan = w.store.actions.find((a) => a.kind === "plan" && a.cycle === 1)!;
    expect(plan.result.learnings).toEqual(w.learnings);
    const tasks = w.store.actions.filter((a) => a.kind === "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content_type).toBe("geo_scan");

    tick(w, 2);
    await sweep(w);
    await sweep(w);
    expect(w.tasksRun).toEqual(["geo_scan"]);
    expect(tasks[0].status).toBe("done");
    expect(w.store.events.some((e) => e.kind === "task_done")).toBe(true);
  });

  it("in Assist mode makes nothing until the plan is approved", async () => {
    const p = await program(w, { mode: "assist" });
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    tick(w, 60 * 24 * 3);
    await sweep(w);
    const content = w.store.actions.filter((a) => a.kind === "content");
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((a) => a.status === "proposed")).toBe(true);
    expect(w.created).toHaveLength(0);
  });

  it("planning the same week twice adds nothing", async () => {
    const p = await program(w);
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    const before = w.store.actions.length;
    await w.store.insertActions([
      {
        workspace_id: WS,
        program_id: p.id,
        kind: "plan",
        dedupe_key: `plan:${p.id}:1:again`,
        cycle: 1,
      },
    ]);
    await sweep(w);
    expect(w.store.actions.length).toBe(before + 1);
  });
});

describe("content lifecycle", () => {
  it("makes a piece once, waits for approval, then schedules and measures it", async () => {
    const p = await program(w);
    const action = await piece(w, p);

    await sweep(w);
    expect(action.status).toBe("needs_approval");
    expect(w.created).toHaveLength(1);
    expect(action.credits_charged).toBe(12);
    const item = w.content.get(action.content_item_ids[0])!;
    expect(item.meta.autopilot_action_id).toBe(action.id);

    // Not approved: many sweeps later, still nothing is scheduled.
    for (let i = 0; i < 5; i++) {
      tick(w, 5);
      await sweep(w);
    }
    expect(action.status).toBe("needs_approval");
    expect(w.scheduled).toHaveLength(0);

    item.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("scheduled");
    expect(w.scheduled).toEqual([{ id: item.id, at: "2026-10-07T09:00:00.000Z" }]);

    item.status = "published";
    item.metrics = { views: 1240, likes: 30 };
    w.clock = new Date("2026-10-07T09:10:00Z");
    await sweep(w);
    expect(action.status).toBe("published");
    tick(w, 60 * 49);
    await sweep(w);
    expect(action.status).toBe("measured");
    expect(action.result.metrics).toEqual({ views: 1240, likes: 30 });
    expect(w.scheduled).toHaveLength(1);
    expect(w.created).toHaveLength(1);
  });

  it("two overlapping workers make the piece only once", async () => {
    const p = await program(w);
    await piece(w, p);
    await Promise.all([
      runSweep(w.store, w.ports, { worker: "a" }),
      runSweep(w.store, w.ports, { worker: "b" }),
    ]);
    expect(w.created).toHaveLength(1);
  });

  it("follows an existing job instead of making a second one after a crash", async () => {
    const p = await program(w);
    const action = await piece(w, p, { status: "generating" });
    w.content.set("cx", {
      id: "cx",
      status: "pending",
      title: "t",
      body: "b",
      channel: "linkedin",
      media_url: null,
      scheduled_at: null,
      meta: {},
      metrics: {},
    });
    w.jobs.set("jx", {
      id: "jx",
      key: `autopilot:${action.id}:0`,
      status: "succeeded",
      contentItemIds: ["cx"],
      warnings: 0,
      error: null,
      createdAt: w.clock.toISOString(),
    });
    await sweep(w);
    expect(w.created).toHaveLength(0);
    expect(action.status).toBe("needs_approval");
    expect(action.content_item_ids).toEqual(["cx"]);
  });

  it("holds a piece that was edited after approval", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    await sweep(w);
    const item = w.content.get(action.content_item_ids[0])!;
    item.status = "approved";
    tick(w, 5);
    await sweep(w);
    expect(action.status).toBe("approved");
    // The content trigger demotes an edited approved item to draft.
    item.status = "draft";
    await sweep(w);
    expect(action.status).toBe("needs_approval");
    expect(w.scheduled).toHaveLength(0);
    expect(w.store.events.some((e) => e.kind === "piece_changed")).toBe(true);
  });

  it("skips a piece when the weekly limit is reached, without spending", async () => {
    const p = await program(w, { credit_cap_per_week: 5 });
    const action = await piece(w, p);
    await sweep(w);
    expect(action.status).toBe("skipped");
    expect(w.created).toHaveLength(0);
  });

  it("pauses the program when the member it acts for is gone", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    w.role = null;
    await sweep(w);
    expect((await w.store.getProgram(p.id))!.status).toBe("paused");
    expect((await w.store.getProgram(p.id))!.pause_reason).toBe("member_left");
    expect(action.status).toBe("planned");
    expect(w.created).toHaveLength(0);
    // A paused program's actions are not claimed at all.
    tick(w, 60);
    expect((await sweep(w)).claimed).toBe(0);
  });

  it("does nothing while automation is switched off or the flag is off", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    w.enabled = false;
    await sweep(w);
    expect(action.status).toBe("planned");
    w.enabled = true;
    w.paused = true;
    tick(w, 31);
    await sweep(w);
    expect(action.status).toBe("planned");
    expect((await w.store.getProgram(p.id))!.pause_reason).toBe("agents_paused");
    expect(w.created).toHaveLength(0);
  });

  it("marks a piece missed when nobody approves it in time, and never sends it", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    await sweep(w);
    w.clock = new Date("2026-10-09T10:00:00Z");
    await sweep(w);
    expect(action.status).toBe("missed");
    expect(w.scheduled).toHaveLength(0);
  });

  it("records a failed schedule with the publisher's reason and does not retry it", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    await sweep(w);
    w.content.get(action.content_item_ids[0])!.status = "approved";
    w.scheduleReason = "No connected LinkedIn account for this selection";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("failed");
    expect(action.last_error).toContain("No connected LinkedIn account");
    tick(w, 600);
    expect((await sweep(w)).claimed).toBe(0);
  });

  it("fails cleanly when the piece cannot be made (for example, no credits)", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    w.createError = new Error("Not enough credits");
    await sweep(w);
    expect(action.status).toBe("failed");
    expect(action.last_error).toBe("Not enough credits");
  });

  it("an article stops at ready and is never handed to the publisher", async () => {
    const p = await program(w);
    const action = await piece(w, p, { content_type: "article", platform: null });
    await sweep(w);
    w.content.get(action.content_item_ids[0])!.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("done");
    expect(w.scheduled).toHaveLength(0);
  });
});

describe("Full Autopilot", () => {
  it("never approves by itself unless the mode and the flag are both on", async () => {
    const p = await program(w, { mode: "autopilot" });
    const action = await piece(w, p);
    w.full = true;
    await sweep(w);
    tick(w, 5);
    await sweep(w);
    expect(action.status).toBe("needs_approval");

    const w2 = world();
    const p2 = await program(w2, { mode: "full" });
    const a2 = await piece(w2, p2);
    w2.full = false;
    await sweep(w2);
    tick(w2, 5);
    await sweep(w2);
    expect(a2.status).toBe("needs_approval");
    expect(w2.scheduled).toHaveLength(0);
  });

  it("approves a clean post and holds one with an unverified figure", async () => {
    const p = await program(w, { mode: "full" });
    w.full = true;
    const clean = await piece(w, p);
    await sweep(w);
    await sweep(w);
    expect(clean.status).toBe("approved");
    expect(clean.approved_via).toBe("auto");
    expect(w.store.events.some((e) => e.kind === "piece_auto_approved")).toBe(true);

    const w2 = world();
    const p2 = await program(w2, { mode: "full" });
    w2.full = true;
    w2.invented = 1;
    const risky = await piece(w2, p2);
    await sweep(w2);
    await sweep(w2);
    expect(risky.status).toBe("needs_approval");
    expect(risky.result.auto_reasons).toContain("unverified_facts");
  });
});

describe("opportunities", () => {
  const candidate: Candidate = {
    kind: "competitor",
    title: "Acme launches an AI automation suite",
    summary: "Acme announced a new automation product.",
    evidence: [{ title: "Acme blog", url: "https://acme.com/blog/launch", date: "2026-10-03" }],
    sourceKind: "competitor_update",
    sourceId: "u1",
    significance: "major",
    date: "2026-10-03T00:00:00Z",
  };

  it("stores a relevant opportunity once, however often it is found", async () => {
    w.candidates = [candidate];
    await enqueueScan(w.store, WS, w.clock);
    await enqueueScan(w.store, WS, w.clock);
    expect(w.store.actions.filter((a) => a.kind === "scan")).toHaveLength(1);
    await sweep(w);
    expect(w.store.opportunities).toHaveLength(1);
    expect(w.store.opportunities[0].evidence[0].url).toBe("https://acme.com/blog/launch");

    tick(w, 120);
    await enqueueScan(w.store, WS, w.clock);
    await sweep(w);
    expect(w.store.opportunities).toHaveLength(1);
  });

  it("drops weak and stale signals", async () => {
    w.candidates = [candidate];
    w.relevance = 30;
    await enqueueScan(w.store, WS, w.clock);
    await sweep(w);
    expect(w.store.opportunities).toHaveLength(0);

    const w2 = world();
    w2.candidates = [{ ...candidate, date: "2026-07-01T00:00:00Z" }];
    await enqueueScan(w2.store, WS, w2.clock);
    await sweep(w2);
    expect(w2.store.opportunities).toHaveLength(0);
  });

  it("only acts by itself when the program allows it, and suggestions never track on their own", async () => {
    w.candidates = [candidate];
    const p = await program(w, { act_on_opportunities: false });
    await enqueueScan(w.store, WS, w.clock);
    await sweep(w);
    expect(w.store.actions.filter((a) => a.kind === "content")).toHaveLength(0);
    expect(w.store.opportunities[0].status).toBe("new");

    const w2 = world();
    w2.candidates = [candidate];
    await program(w2, { act_on_opportunities: true });
    await enqueueScan(w2.store, WS, w2.clock);
    await sweep(w2);
    expect(w2.store.actions.filter((a) => a.kind === "content")).toHaveLength(1);
    expect(w2.store.opportunities[0].status).toBe("accepted");
    expect(p.id).toBeTruthy();
  });

  it("accepting the same opportunity twice makes one set of pieces", async () => {
    w.candidates = [candidate];
    await enqueueScan(w.store, WS, w.clock);
    await sweep(w);
    const opportunity = w.store.opportunities[0];
    const args = {
      opportunity,
      program: null,
      format: "campaign" as const,
      platforms: ["linkedin", "instagram"],
      requestedBy: USER,
      now: w.clock,
    };
    const first = await actionsFromOpportunity(w.store, args);
    const second = await actionsFromOpportunity(w.store, args);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(0);
    expect(first.every((a) => a.brief.includes("https://acme.com/blog/launch"))).toBe(true);
  });
});

describe("Story Autopilot", () => {
  const STORIES = {
    enabled: true,
    perDay: 1,
    days: [],
    windowStart: "09:00",
    windowEnd: "20:00",
    platforms: ["instagram", "facebook"],
    themes: ["tip", "behind", "question"],
    frames: 3,
    smartTiming: true,
  };
  const TITLES = [
    "Why your grinder matters most",
    "Kettle temperature for pour over",
    "Paper filters versus metal",
    "Weighing beans takes ten seconds",
    "Roast dates explained simply",
    "Steaming oat milk without splitting",
    "Which cup keeps espresso hot",
    "Storing beans away from light",
    "Decaf that still tastes sweet",
    "Cleaning a machine on Fridays",
  ];
  const uniqueTitles = () => {
    w.ports.plan.propose = async ({ slots }) =>
      slots.map((s, i) => ({
        slot: s.index,
        title: TITLES[i % TITLES.length],
        brief: "Explain the problem our customers face and show the one step that fixes it.",
        reason: "Buyers ask about this.",
      }));
  };
  const plan = async (over: Partial<ProgramRow> = {}) => {
    const p = await program(w, { stories: STORIES, credit_cap_per_week: 400, ...over });
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    uniqueTitles();
    await sweep(w);
    return p;
  };
  const storiesOf = () => w.store.actions.filter((a) => a.content_type === "story");

  it("plans a Story for every day, each with a theme, made the day before its slot", async () => {
    await plan();
    const stories = storiesOf();
    expect(stories).toHaveLength(7);
    expect(new Set(stories.map((s) => s.planned_for!.slice(0, 10))).size).toBe(7);
    // No two days in a row share a theme.
    const themes = stories
      .sort((a, b) => a.planned_for!.localeCompare(b.planned_for!))
      .map((s) => s.result.story_theme);
    for (let i = 1; i < themes.length; i++) expect(themes[i]).not.toBe(themes[i - 1]);
    for (const s of stories) {
      expect(s.result.story_platforms).toEqual(["instagram", "facebook"]);
      const lead = Date.parse(s.planned_for!) - Date.parse(s.next_attempt_at);
      // Never made at the slot itself; at most 30 hours ahead.
      expect(lead).toBeGreaterThan(60 * 60_000);
      expect(lead).toBeLessThanOrEqual(30 * 60 * 60_000);
    }
    // Feed posts are still planned alongside.
    expect(w.store.actions.filter((a) => a.content_type === "social").length).toBeGreaterThan(0);
  });

  it("plans only Stories when the program has no feed posts", async () => {
    await plan({ posts_per_week: 0 });
    const content = w.store.actions.filter((a) => a.kind === "content");
    expect(content.length).toBe(7);
    expect(content.every((a) => a.content_type === "story")).toBe(true);
  });

  it("plans no Stories when Stories are switched off for the workspace", async () => {
    w.ports.storiesEnabled = () => false;
    await plan();
    expect(storiesOf()).toHaveLength(0);
  });

  it("uses the hours this brand's Stories did best", async () => {
    w.ports.plan.storyHours = async () => [{ hour: 18, avg: 900, count: 3 }];
    await plan();
    expect(storiesOf().every((s) => s.planned_for!.slice(11, 16) === "18:15")).toBe(true);
  });

  it("asks Studio for designed frames on every Story account, with the slot's theme", async () => {
    const p = await program(w, { stories: STORIES });
    const calls: unknown[] = [];
    const create = w.ports.studio.create;
    w.ports.studio.create = async (args) => {
      calls.push({ platforms: args.platforms, story: args.story });
      return create(args);
    };
    await piece(w, p, {
      content_type: "story",
      platform: "instagram",
      result: { story_theme: "question", story_platforms: ["instagram", "facebook"] },
    });
    await sweep(w);
    expect(calls).toEqual([
      { platforms: ["instagram", "facebook"], story: { frames: 3, theme: "question" } },
    ]);
  });

  it("drops a Story nobody approved within six hours of its slot", async () => {
    const p = await program(w, { stories: STORIES });
    const a = await piece(w, p, { content_type: "story", platform: "instagram" });
    await sweep(w); // made, waiting for approval
    expect(w.store.actions.find((x) => x.id === a.id)!.status).toBe("needs_approval");
    w.clock = new Date(Date.parse(a.planned_for!) + 5 * 60 * 60_000);
    await sweep(w);
    expect(w.store.actions.find((x) => x.id === a.id)!.status).toBe("needs_approval");
    w.clock = new Date(Date.parse(a.planned_for!) + 7 * 60 * 60_000);
    await sweep(w);
    expect(w.store.actions.find((x) => x.id === a.id)!.status).toBe("missed");
    expect(w.scheduled).toHaveLength(0);
  });

  it("in fully automatic mode approves a clean Story, up to the daily number chosen", async () => {
    w.full = true;
    const p = await program(w, { mode: "full", stories: STORIES });
    const first = await piece(w, p, { content_type: "story", platform: "instagram" });
    const second = await piece(w, p, { content_type: "story", platform: "instagram" });
    for (let i = 0; i < 4; i++) {
      await sweep(w);
      tick(w, 4);
    }
    const status = (id: string) => w.store.actions.find((x) => x.id === id)!;
    const auto = [first, second].filter((a) => status(a.id).approved_via === "auto");
    // One a day was chosen: the second waits for a person.
    expect(auto).toHaveLength(1);
    expect([first, second].filter((a) => status(a.id).status === "needs_approval")).toHaveLength(1);
  });
});

describe("more than posts", () => {
  const plan = async (p: ProgramRow) => {
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
  };
  const measured = async (p: ProgramRow, title: string, views: number) =>
    piece(w, p, {
      status: "measured",
      title,
      result: { metrics: { views } },
      dedupe_key: `content:done:${title}`,
    });

  it("only weekly jobs become steps, and the summary waits for the week to end", async () => {
    const p = await program(w, {
      automations: ["geo_scan", "repurpose", "publish_articles", "weekly_report"],
    });
    await plan(p);
    const tasks = w.store.actions.filter((a) => a.kind === "task");
    expect(tasks.map((t) => t.content_type).sort()).toEqual([
      "geo_scan",
      "repurpose",
      "weekly_report",
    ]);
    const report = tasks.find((t) => t.content_type === "weekly_report")!;
    expect(report.next_attempt_at).toBe("2026-10-12T08:00:00.000Z");

    tick(w, 2);
    await sweep(w);
    await sweep(w);
    expect(w.tasksRun).toEqual(["geo_scan"]);
    expect(report.status).toBe("planned");

    w.clock = new Date("2026-10-12T08:01:00Z");
    await sweep(w);
    await sweep(w);
    expect(w.tasksRun).toContain("weekly_report");
    expect(report.status).toBe("done");
  });

  it("reuses the best post once, in another format, as an ordinary planned piece", async () => {
    const p = await program(w, {
      automations: ["repurpose"],
      content_types: ["social", "carousel"],
    });
    await measured(p, "Churn warning signs", 2400);
    await measured(p, "Hiring your first marketer", 300);
    await measured(p, "Cold outreach openers", 180);
    await plan(p);
    tick(w, 2);
    await sweep(w);
    await sweep(w);

    const reused = w.store.actions.filter((a) => a.dedupe_key.startsWith("repurpose:"));
    expect(reused).toHaveLength(1);
    expect(reused[0].content_type).toBe("carousel");
    expect(reused[0].title).toContain("Churn warning signs");
    expect(reused[0].brief).toContain("Do not invent figures");
    // It is made and waits for a person like any other piece.
    expect(["planned", "generating", "needs_approval"]).toContain(reused[0].status);
    expect(w.scheduled).toHaveLength(0);

    // Next week the same post is not reused again; the next best is.
    await w.store.insertActions([
      {
        workspace_id: WS,
        program_id: p.id,
        kind: "task",
        dedupe_key: `task:${p.id}:2:repurpose`,
        cycle: 2,
        content_type: "repurpose",
      },
    ]);
    tick(w, 2);
    await sweep(w);
    await sweep(w);
    const again = w.store.actions.filter((a) => a.dedupe_key.startsWith("repurpose:"));
    expect(again).toHaveLength(2);
    expect(again[1].title).toContain("Hiring your first marketer");
  });

  it("reuses nothing until there are results to go on", async () => {
    const p = await program(w, {
      automations: ["repurpose"],
      content_types: ["social", "carousel"],
    });
    await measured(p, "Churn warning signs", 2400);
    await plan(p);
    tick(w, 2);
    await sweep(w);
    await sweep(w);
    expect(w.store.actions.some((a) => a.dedupe_key.startsWith("repurpose:"))).toBe(false);
    const task = w.store.actions.find((a) => a.content_type === "repurpose")!;
    expect(task.status).toBe("skipped");
    // A quiet skip: nothing is written to the history.
    expect(w.store.events.some((e) => e.kind === "task_skipped")).toBe(false);
  });

  it("sends an approved article to the blog once, and only when told to", async () => {
    const off = await program(w);
    const kept = await piece(w, off, { content_type: "article", platform: null });
    await sweep(w);
    w.content.get(kept.content_item_ids[0])!.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(kept.status).toBe("done");
    expect(w.sentToSite).toHaveLength(0);

    await w.store.updateProgram(off.id, { automations: ["publish_articles"] });
    const p = (await w.store.getProgram(off.id))!;
    const action = await piece(w, p, { content_type: "article", platform: null });
    await sweep(w);
    // Not approved yet: nothing leaves.
    tick(w, 5);
    await sweep(w);
    expect(w.sentToSite).toHaveLength(0);

    w.content.get(action.content_item_ids[0])!.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("done");
    expect(w.sentToSite).toEqual(action.content_item_ids);
    expect(w.store.events.some((e) => e.kind === "article_sent")).toBe(true);
    expect(w.scheduled).toHaveLength(0);
  });

  it("keeps the article and says why when there is no blog to send it to", async () => {
    w.blog = false;
    const p = await program(w, { automations: ["publish_articles"] });
    const action = await piece(w, p, { content_type: "article", platform: null });
    await sweep(w);
    w.content.get(action.content_item_ids[0])!.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("done");
    expect(action.result.site).toBe("skipped");
    expect(w.store.events.some((e) => e.summary.includes("No blog is set up"))).toBe(true);
  });
});

describe("the calendar and the plan stay in step", () => {
  const planFor = async (p: ProgramRow) => {
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    return w.store.actions.filter((a) => a.kind === "content");
  };

  it("plans around a post a person already put on the calendar", async () => {
    const p = await program(w);
    const free = await planFor(p);
    expect(free.length).toBeGreaterThan(0);
    const taken = free[0].planned_for!.slice(0, 10);

    w = world();
    w.calendar = [{ date: taken, platform: "linkedin", title: "Our autumn sale" }];
    const again = await planFor(await program(w));
    expect(again).toHaveLength(free.length - 1);
    expect(again.some((a) => a.planned_for!.startsWith(taken))).toBe(false);
    const ready = w.store.events.find((e) => e.kind === "plan_ready")!;
    expect(ready.summary).toMatch(/already has a post of yours/);
  });

  it("gives every planned post what it is for, and a theme when the brand has them", async () => {
    const p = await program(w, {
      strategy: {
        summary: "Show up with useful posts.",
        audience: "Owners",
        voice: "Plain",
        pillars: [
          { title: "Tips", detail: "One thing to use today." },
          { title: "Proof", detail: "What customers got." },
        ],
      },
    });
    const content = await planFor(p);
    expect(content.every((a) => typeof a.result.aim === "string")).toBe(true);
    expect(content.map((a) => a.result.pillar).every((x) => x === "Tips" || x === "Proof")).toBe(
      true,
    );
  });

  it("plans posts and Stories together, each row carrying its own details", async () => {
    const p = await program(w, {
      platforms: ["instagram"],
      stories: { enabled: true, perDay: 1, frames: 3, platforms: ["instagram"] },
    });
    const content = await planFor(p);
    const stories = content.filter((a) => a.content_type === "story");
    const posts = content.filter((a) => a.content_type !== "story");
    expect(stories.length).toBeGreaterThan(0);
    expect(posts.length).toBeGreaterThan(0);
    // Every row has a result object: a missing one is what stopped real plans.
    expect(content.every((a) => a.result && typeof a.result === "object")).toBe(true);
    expect(stories.every((a) => Array.isArray(a.result.story_platforms))).toBe(true);
  });

  it("sends a piece at the time a person moved it to on the calendar", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    await sweep(w);
    const item = w.content.get(action.content_item_ids[0])!;
    expect(item.meta.calendar_time).toBe("09:00");

    // Dragged to Friday evening, then approved.
    item.meta = { ...item.meta, calendar_date: "2026-10-09", calendar_time: "18:30" };
    item.status = "approved";
    tick(w, 5);
    await sweep(w);
    await sweep(w);
    expect(action.status).toBe("scheduled");
    expect(w.scheduled).toEqual([{ id: item.id, at: "2026-10-09T18:30:00.000Z" }]);
    expect(action.planned_for).toBe("2026-10-09T18:30:00.000Z");
  });

  it("does not call a piece late when it was moved to a later day", async () => {
    const p = await program(w);
    const action = await piece(w, p);
    await sweep(w);
    const item = w.content.get(action.content_item_ids[0])!;
    item.meta = { ...item.meta, calendar_date: "2026-10-20", calendar_time: "10:00" };
    // Well past the first slot's grace, still before the new one.
    tick(w, 6 * 24 * 60);
    await sweep(w);
    expect(action.status).toBe("needs_approval");
    expect(action.planned_for).toBe("2026-10-20T10:00:00.000Z");
  });

  it("does not make a piece whose time passed while the worker was away", async () => {
    const p = await program(w);
    const action = await piece(w, p, { planned_for: "2026-10-04T09:00:00.000Z" });
    await sweep(w);
    expect(action.status).toBe("skipped");
    expect(w.created).toHaveLength(0);
    expect(action.credits_charged).toBe(0);
    expect(w.store.events.at(-1)!.summary).toMatch(/time had passed/);
  });

  it("still makes a late piece a person asked to try again", async () => {
    const p = await program(w);
    const action = await piece(w, p, {
      planned_for: "2026-10-04T09:00:00.000Z",
      generation_attempt: 1,
      result: { asked_again: true },
    });
    await sweep(w);
    expect(action.status).toBe("needs_approval");
    expect(w.created).toHaveLength(1);
  });
});

describe("what a piece is built from", () => {
  it("stores the brains' own words with each planned piece, never the model's", async () => {
    w.brains = {
      audience: [
        { name: "Agency owners", detail: "Wants fewer tools." },
        { name: "In-house leads", detail: "Wants proof." },
      ],
      competitors: [{ name: "Rivalo", detail: "Built for enterprises." }],
      market: [{ name: "AI answers replace clicks", detail: "Show how to be cited." }],
      trends: [],
    };
    const propose = w.ports.plan.propose;
    w.ports.plan.propose = async (input) =>
      (await propose(input)).map((p, i) => ({
        ...p,
        picks:
          i === 0
            ? {
                audience: 1,
                competitor: 0,
                market: 9,
                hook: "Your board wants proof, not a dashboard.",
              }
            : { audience: 42 },
      }));
    const p = await program(w);
    await w.store.insertActions([
      { workspace_id: WS, program_id: p.id, kind: "plan", dedupe_key: `plan:${p.id}:1`, cycle: 1 },
    ]);
    await sweep(w);
    const content = w.store.actions
      .filter((a) => a.kind === "content")
      .sort((a, b) => (a.planned_for ?? "").localeCompare(b.planned_for ?? ""));
    expect(content.length).toBeGreaterThan(1);
    const first = content[0].result.brains as Record<string, { name: string }>;
    expect(first.audience.name).toBe("In-house leads");
    expect(first.competitor.name).toBe("Rivalo");
    expect(first.market).toBeUndefined();
    // A number that isn't on the list: the piece still gets a real group.
    const second = content[1].result.brains as Record<string, { name: string }>;
    expect(["Agency owners", "In-house leads"]).toContain(second.audience.name);
  });
});

describe("when the maker is briefly unavailable", () => {
  const failing = (retryable: boolean) => {
    const create = w.ports.studio.create;
    w.ports.studio.create = async (args) => {
      const made = await create(args);
      const job = w.jobs.get(made.job.id)!;
      Object.assign(job, { status: "failed", error: "The render failed.", retryable });
      return { job, credits: 0 };
    };
    return () => {
      w.ports.studio.create = create;
    };
  };

  it("tries again by itself, then makes the piece once the maker is back", async () => {
    const p = await program(w);
    const action = await piece(w, p, { planned_for: "2026-10-09T09:00:00.000Z" });
    const restore = failing(true);
    await sweep(w);
    expect(action.status).toBe("planned");
    expect(action.generation_attempt).toBe(1);
    expect(action.content_item_ids).toEqual([]);
    expect(w.store.events.at(-1)!.kind).toBe("piece_waiting");
    // Not before its wait is over.
    tick(w, 10);
    await sweep(w);
    expect(w.created).toHaveLength(1);

    restore();
    tick(w, 60);
    await sweep(w);
    expect(action.status).toBe("needs_approval");
    expect(w.created).toEqual([`autopilot:${action.id}:0`, `autopilot:${action.id}:1`]);
  });

  it("stops after two tries and says so", async () => {
    const p = await program(w);
    const action = await piece(w, p, { planned_for: "2026-10-09T09:00:00.000Z" });
    failing(true);
    await sweep(w);
    tick(w, 61);
    await sweep(w);
    expect(action.status).toBe("planned");
    tick(w, 6 * 60 + 1);
    await sweep(w);
    expect(action.status).toBe("failed");
    expect(w.created).toHaveLength(3);
  });

  it("does not retry a piece that failed for its own reasons, or one with no time left", async () => {
    const p = await program(w);
    const own = await piece(w, p, { planned_for: "2026-10-09T09:00:00.000Z" });
    failing(false);
    await sweep(w);
    expect(own.status).toBe("failed");

    w = world();
    const soon = await piece(w, await program(w), { planned_for: "2026-10-05T08:30:00.000Z" });
    failing(true);
    await sweep(w);
    expect(soon.status).toBe("failed");
  });
});
