import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRow, ProgramRow } from "@/lib/autopilot/contracts";
import type { Candidate } from "@/lib/autopilot/opportunities";
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
  } as World;
  w.store = createMemoryAutopilotStore(() => w.clock);
  let n = 0;
  w.ports = {
    now: () => w.clock,
    enabled: () => w.enabled,
    fullEnabled: () => w.full,
    automationPaused: async () => w.paused,
    memberRole: async () => w.role,
    connectedPlatforms: async () => ["linkedin", "instagram"],
    content: {
      get: async (_ws, ids) =>
        ids.map((id) => w.content.get(id)).filter((c): c is ContentLite => Boolean(c)),
      tag: async (_ws, id, tag) => {
        const item = w.content.get(id);
        if (item)
          item.meta = { ...item.meta, autopilot_action_id: tag.actionId, calendar_date: tag.date };
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
    style_id: null,
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
