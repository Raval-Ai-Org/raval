// engine.ts — the Autopilot worker (ADR-0028). No queue service: action rows
// leased with claim_autopilot_actions (FOR UPDATE SKIP LOCKED) and advanced by
// the existing run-schedules cron hook within a time budget.
//
// The engine is written against two interfaces — a store (rows) and ports
// (everything else Mellox already has: Studio, the content lifecycle, the
// publisher, Brand DNA, the model). It owns no generator, no publisher and no
// approval state of its own. Tests run it against store.memory.ts and fakes.
//
//   plan      one per week: dated slots (pure) + what to write (model) → content actions
//   content   planned → generating → needs_approval → approved → scheduled → published → measured
//   scan      turn already-collected market and competitor signals into opportunities
//   task      weekly work beyond posts: start a scan, reuse the best post, send the summary
//
// Rules the code below enforces:
//   * A piece is only ever scheduled when its content item reads `approved`
//     at that moment. The publisher would promote a draft; the engine never asks it to.
//   * Every status change is a compare-and-set on the status it was read at.
//   * An unknown outcome is resolved by reading the row, never by repeating the call.
import "server-only";
import {
  PUBLISHABLE_TYPES,
  WEEKLY_AUTOMATIONS,
  type ActionRow,
  type ActionStatus,
  type EventRow,
  type Evidence,
  type OpportunityFormat,
  type OpportunityKind,
  type OpportunityRow,
  type OpportunityStatus,
  type ProgramRow,
} from "@/lib/autopilot/contracts";
import {
  acceptRatings,
  AUTO_ACT_PER_WEEK,
  AUTO_ACT_SCORE,
  campaignPieces,
  candidateFingerprint,
  expiryFor,
  filterCandidates,
  scoreOpportunity,
  type Candidate,
  type Rating,
} from "@/lib/autopilot/opportunities";
import {
  budgetVerdict,
  cycleSlots,
  cycleStart,
  generateAt,
  isPastApproval,
  planVerdict,
  publishDecision,
  scheduleTime,
  weekOf,
  type CycleSlot,
  type PlanProposal,
} from "@/lib/autopilot/policy";
import { pickRepurpose, repurposeBrief } from "@/lib/autopilot/repurpose";
import { canTransition } from "@/lib/autopilot/state";
import { STORY_MEASURE_AFTER_MS, readStorySettings, type HourScore } from "@/lib/stories/schedule";
import { isStoryPlatform } from "@/lib/stories/placement";
import { addDaysYmd, ymdInZone, zonedInstant } from "@/lib/autopilot/time";
import type { StudioType } from "@/lib/studio/formats";
import type { WorkspaceRole } from "@/server/api-auth";

/* ───────────────────────── store ───────────────────────── */

export type NewAction = Pick<ActionRow, "workspace_id" | "kind" | "dedupe_key"> &
  Partial<
    Pick<
      ActionRow,
      | "program_id"
      | "status"
      | "cycle"
      | "slot"
      | "planned_for"
      | "platform"
      | "content_type"
      | "title"
      | "brief"
      | "reason"
      | "goal"
      | "opportunity_id"
      | "requested_by"
      | "next_attempt_at"
      | "result"
    >
  >;

export type NewOpportunity = Pick<
  OpportunityRow,
  | "workspace_id"
  | "kind"
  | "title"
  | "summary"
  | "why_relevant"
  | "suggested_action"
  | "suggested_type"
  | "suggested_platforms"
  | "evidence"
  | "source_kind"
  | "source_id"
  | "fingerprint"
  | "score"
  | "score_parts"
  | "expires_at"
>;

export type NewEvent = Pick<EventRow, "workspace_id" | "kind" | "summary"> &
  Partial<
    Pick<EventRow, "program_id" | "action_id" | "opportunity_id" | "data" | "actor" | "actor_id">
  >;

export type ActionPatch = Partial<
  Pick<
    ActionRow,
    | "studio_job_id"
    | "content_item_ids"
    | "generation_attempt"
    | "credits_charged"
    | "approved_by"
    | "approved_via"
    | "result"
    | "next_attempt_at"
    | "attempts"
    | "last_error"
    | "planned_for"
    | "finished_at"
  >
>;

export interface AutopilotStore {
  claim(worker: string, max: number, leaseSeconds: number, id?: string): Promise<ActionRow[]>;
  /**
   * Compare-and-set on the status the action was read at (and on the lease
   * holder when `worker` is given). Clears the lease unless `keepLease`.
   */
  transition(
    action: ActionRow,
    to: ActionStatus,
    patch?: ActionPatch,
    opts?: { worker?: string; keepLease?: boolean },
  ): Promise<boolean>;
  /** Give the lease back without changing status. */
  release(action: ActionRow, worker: string, patch?: ActionPatch): Promise<void>;
  /** Insert, ignoring rows whose (workspace_id, dedupe_key) already exists. Returns the new rows. */
  insertActions(rows: NewAction[]): Promise<ActionRow[]>;
  getAction(workspaceId: string, id: string): Promise<ActionRow | null>;
  listActions(
    workspaceId: string,
    opts?: { statuses?: ActionStatus[]; kind?: ActionRow["kind"]; since?: string; limit?: number },
  ): Promise<ActionRow[]>;
  /** Credits and videos already spent by a program in one week. */
  usage(programId: string, cycle: number): Promise<{ credits: number; videos: number }>;
  /**
   * Pieces approved automatically since `since`. Stories and posts have their
   * own daily caps, so each can be counted alone.
   */
  autoApprovedSince(
    workspaceId: string,
    since: string,
    opts?: { contentType?: string; excludeContentType?: string },
  ): Promise<number>;
  autoActedInCycle(programId: string, cycle: number): Promise<number>;
  openActionCount(programId: string): Promise<number>;

  getProgram(id: string): Promise<ProgramRow | null>;
  liveProgram(workspaceId: string): Promise<ProgramRow | null>;
  insertProgram(
    row: Omit<
      ProgramRow,
      | "id"
      | "created_at"
      | "updated_at"
      | "finished_at"
      | "cycle"
      | "pause_reason"
      | "strategy"
      | "last_notified_at"
      | "automations"
      | "stories"
    > & {
      strategy?: Record<string, unknown>;
      automations?: string[];
      stories?: Record<string, unknown>;
    },
  ): Promise<ProgramRow>;
  updateProgram(
    id: string,
    patch: Partial<ProgramRow>,
    expectStatus?: ProgramRow["status"],
  ): Promise<boolean>;

  knownFingerprints(
    workspaceId: string,
    since: string,
  ): Promise<{ fingerprint: string; title: string }[]>;
  insertOpportunities(rows: NewOpportunity[]): Promise<OpportunityRow[]>;
  getOpportunity(workspaceId: string, id: string): Promise<OpportunityRow | null>;
  listOpportunities(
    workspaceId: string,
    opts?: { statuses?: OpportunityStatus[]; limit?: number },
  ): Promise<OpportunityRow[]>;
  updateOpportunity(
    id: string,
    patch: Partial<Pick<OpportunityRow, "status" | "decided_by" | "decided_at">>,
    expectStatus?: OpportunityStatus,
  ): Promise<boolean>;
  expireOpportunities(workspaceId: string, now: string): Promise<void>;

  addEvent(event: NewEvent): Promise<void>;
  listEvents(workspaceId: string, limit: number): Promise<EventRow[]>;
}

/* ───────────────────────── ports ───────────────────────── */

export type ContentLite = {
  id: string;
  status: string;
  title: string;
  body: string;
  channel: string | null;
  media_url: string | null;
  scheduled_at: string | null;
  meta: Record<string, unknown>;
  metrics: Record<string, unknown>;
};

export type JobLite = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  contentItemIds: string[];
  warnings: number;
  error: string | null;
  createdAt: string;
};

export type PlanInput = {
  program: ProgramRow;
  slots: CycleSlot[];
  opportunities: OpportunityRow[];
  recentTitles: string[];
  /** What earlier results showed, in plain sentences. */
  learnings: string[];
};

export interface AutopilotPorts {
  now(): Date;
  enabled(workspaceId: string): boolean;
  fullEnabled(workspaceId: string): boolean;
  /** The Stories flag: off means Story Autopilot plans no Stories. */
  storiesEnabled(workspaceId: string): boolean;
  /** The global and per-workspace automation kill switches. */
  automationPaused(workspaceId: string): Promise<boolean>;
  memberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>;
  connectedPlatforms(workspaceId: string): Promise<string[]>;

  content: {
    get(workspaceId: string, ids: string[]): Promise<ContentLite[]>;
    /** Put the piece on the calendar at its slot and tag it as Autopilot's. */
    tag(
      workspaceId: string,
      id: string,
      tag: { actionId: string; date: string; time: string },
    ): Promise<void>;
    /** pending → approved, compare-and-set. Used only by Full mode. */
    approve(workspaceId: string, id: string): Promise<boolean>;
  };

  studio: {
    findJob(workspaceId: string, idempotencyKey: string): Promise<JobLite | null>;
    create(args: {
      workspaceId: string;
      userId: string;
      role: WorkspaceRole;
      idempotencyKey: string;
      action: ActionRow;
      /** Every platform the piece goes to (a Story can go to Instagram and Facebook). */
      platforms?: string[];
      /** Story pieces: how many frames and which theme. */
      story?: { frames: number; theme: string } | null;
    }): Promise<{ job: JobLite; credits: number }>;
    /** Check a running render once. */
    advance(workspaceId: string, jobId: string): Promise<JobLite | null>;
  };

  /** Hand one approved item to the publisher for a future time. May throw (limits). */
  schedule(args: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    contentItemId: string;
    at: string;
  }): Promise<{ reason: string | null }>;

  plan: {
    recentTitles(workspaceId: string): Promise<string[]>;
    /** What this workspace's own measured posts show so far. */
    learnings(workspaceId: string): Promise<string[]>;
    /** Local hours this brand's own Stories reached the most people. */
    storyHours(workspaceId: string, timeZone: string): Promise<HourScore[]>;
    propose(input: PlanInput): Promise<PlanProposal[]>;
  };

  /** Recurring work done by other Mellox systems (for example the AI visibility scan). */
  tasks: {
    run(
      name: string,
      args: { workspaceId: string; userId: string; actionId: string },
    ): Promise<{ status: "done" | "skipped"; summary: string; quiet?: boolean }>;
  };

  /** The workspace's own website, through the existing article publisher. */
  site: {
    /**
     * Send one approved article to the blog. "skipped" when there is no blog
     * to send it to; an article already on its way is "sent", never sent twice.
     */
    publishArticle(args: {
      workspaceId: string;
      userId: string;
      role: WorkspaceRole;
      contentItemId: string;
    }): Promise<{ status: "sent" | "skipped"; summary: string }>;
  };

  scan: {
    collect(workspaceId: string): Promise<Candidate[]>;
    rate(workspaceId: string, candidates: Candidate[]): Promise<Rating[]>;
    /** False when the text states a figure, date or link the evidence does not contain. */
    grounded(workspaceId: string, text: string, candidate: Candidate): Promise<boolean>;
    /** True when a finished piece states a figure the brand context does not contain. */
    inventedFacts(workspaceId: string, item: ContentLite): Promise<number>;
  };
}

/* ───────────────────────── helpers ───────────────────────── */

const MIN = 60_000;
const HOUR = 60 * MIN;
const LEASE_SECONDS = 180;
const MAX_ERRORS = 5;
/** A job that has not finished after this long is treated as failed. */
const GENERATION_TIMEOUT_MS = 25 * MIN;

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
};
const TYPE_NOUN: Record<string, string> = {
  story: "Story",
  social: "post",
  image: "image post",
  carousel: "carousel",
  video: "video",
  article: "article",
};

export function describePiece(action: Pick<ActionRow, "content_type" | "platform">): string {
  const noun = TYPE_NOUN[action.content_type ?? "social"] ?? "post";
  const where = action.platform ? PLATFORM_LABEL[action.platform] : null;
  return where ? `${where} ${noun}` : noun;
}

function inMs(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function hmInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "09:00";
  }
}

type Ctx = { store: AutopilotStore; ports: AutopilotPorts; worker: string };

type Actor = { userId: string; role: WorkspaceRole };

const CAN_ACT: readonly WorkspaceRole[] = ["owner", "admin", "editor"];

/** Finish a program whose end date has passed and that has nothing left in flight. */
async function maybeComplete(ctx: Ctx, program: ProgramRow | null): Promise<void> {
  if (!program || program.status !== "running") return;
  const today = ymdInZone(ctx.ports.now(), program.timezone);
  if (today <= program.ends_on) return;
  if ((await ctx.store.openActionCount(program.id)) > 0) return;
  const done = await ctx.store.updateProgram(
    program.id,
    { status: "completed", finished_at: ctx.ports.now().toISOString() },
    "running",
  );
  if (done) {
    await ctx.store.addEvent({
      workspace_id: program.workspace_id,
      program_id: program.id,
      kind: "program_completed",
      summary: "Autopilot finished its run.",
    });
  }
}

async function finish(
  ctx: Ctx,
  action: ActionRow,
  to: ActionStatus,
  patch: ActionPatch,
  event: Omit<NewEvent, "workspace_id" | "program_id" | "action_id"> | null,
): Promise<boolean> {
  if (!canTransition(action.kind, action.status, to)) {
    throw new Error(`Illegal autopilot transition ${action.status} → ${to}`);
  }
  const ok = await ctx.store.transition(action, to, patch, { worker: ctx.worker });
  if (ok && event) {
    await ctx.store.addEvent({
      workspace_id: action.workspace_id,
      program_id: action.program_id,
      action_id: action.id,
      ...event,
    });
  }
  return ok;
}

/* ───────────────────────── opportunity → actions ───────────────────────── */

/**
 * The content actions an accepted opportunity becomes. Shared by a person
 * pressing "Create" and by a running program acting by itself. The dedupe key
 * makes a second accept of the same opportunity a no-op.
 */
export async function actionsFromOpportunity(
  store: AutopilotStore,
  args: {
    opportunity: OpportunityRow;
    program: ProgramRow | null;
    format: OpportunityFormat;
    platforms: string[];
    requestedBy: string | null;
    now: Date;
    cycle?: number;
  },
): Promise<ActionRow[]> {
  const { opportunity, program, now } = args;
  const platforms = args.platforms.length
    ? args.platforms
    : opportunity.suggested_platforms.length
      ? opportunity.suggested_platforms
      : (program?.platforms ?? []);
  const storyPlatforms = platforms.filter(isStoryPlatform);
  const pieces: { type: string; platform: string | null }[] =
    args.format === "campaign"
      ? campaignPieces(platforms)
      : [
          {
            type: args.format,
            platform:
              args.format === "article"
                ? null
                : args.format === "story"
                  ? (storyPlatforms[0] ?? "instagram")
                  : (platforms[0] ?? null),
          },
        ];

  // A day's notice, then a day apart, so a campaign doesn't land all at once.
  const timeZone = program?.timezone ?? "UTC";
  const firstDay = addDaysYmd(ymdInZone(now, timeZone), 1);
  const brief = [
    opportunity.suggested_action || opportunity.title,
    opportunity.summary && `What happened: ${opportunity.summary}`,
    opportunity.why_relevant && `Why it matters to us: ${opportunity.why_relevant}`,
    opportunity.evidence.length
      ? `Sources: ${opportunity.evidence.map((e) => e.url).join(" , ")}`
      : "",
    "Use only facts from the sources above and the brand context. Do not invent figures.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3900);

  const rows: NewAction[] = pieces.map((piece, i) => {
    const plannedFor = zonedInstant(addDaysYmd(firstDay, i), "10:00", timeZone).toISOString();
    return {
      workspace_id: opportunity.workspace_id,
      program_id: program?.id ?? null,
      kind: "content",
      status: "planned",
      dedupe_key: `opp:${opportunity.id}:${i}`,
      cycle: args.cycle ?? 0,
      planned_for: plannedFor,
      platform: piece.platform,
      content_type: piece.type,
      title: opportunity.title.slice(0, 200),
      brief,
      reason: opportunity.why_relevant.slice(0, 500),
      goal: program?.goal ?? null,
      opportunity_id: opportunity.id,
      requested_by: args.requestedBy,
      next_attempt_at: now.toISOString(),
      ...(piece.type === "story"
        ? {
            result: {
              story_theme: "news",
              story_platforms: storyPlatforms.length ? storyPlatforms : ["instagram"],
            },
          }
        : {}),
    };
  });
  return store.insertActions(rows);
}

/** Queue one opportunity scan for a workspace; several triggers in an hour collapse to one. */
export async function enqueueScan(
  store: AutopilotStore,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const bucket = now.toISOString().slice(0, 13);
  await store.insertActions([
    {
      workspace_id: workspaceId,
      kind: "scan",
      status: "planned",
      dedupe_key: `scan:${bucket}`,
      title: "Look for opportunities",
      next_attempt_at: now.toISOString(),
    },
  ]);
}

/* ───────────────────────── plan ───────────────────────── */

async function runPlan(ctx: Ctx, action: ActionRow, program: ProgramRow): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();
  const cycle = Math.max(1, action.cycle);
  const start = cycleStart(program, cycle);

  if (start > program.ends_on) {
    await finish(ctx, action, "skipped", { finished_at: now.toISOString() }, null);
    await maybeComplete(ctx, program);
    return;
  }

  let learnings: string[] = [];
  const stories = ports.storiesEnabled(program.workspace_id)
    ? readStorySettings(program.stories)
    : { ...readStorySettings(program.stories), enabled: false };
  const storyHours =
    stories.enabled && stories.smartTiming
      ? await ports.plan.storyHours(program.workspace_id, program.timezone).catch(() => [])
      : [];
  const slots = cycleSlots(
    stories.enabled ? program : { ...program, stories: {} },
    cycle,
    now,
    undefined,
    storyHours,
  );
  let planned = 0;
  let droppedCount = 0;
  if (slots.length) {
    const opportunities = await store.listOpportunities(program.workspace_id, {
      statuses: ["new"],
      limit: 5,
    });
    const recentTitles = await ports.plan.recentTitles(program.workspace_id);
    learnings = await ports.plan.learnings(program.workspace_id).catch(() => []);
    const proposals = await ports.plan.propose({
      program,
      slots,
      opportunities,
      recentTitles,
      learnings,
    });
    const usage = await store.usage(program.id, cycle);
    const verdict = planVerdict({
      slots,
      proposals,
      recentTitles,
      opportunityCount: opportunities.length,
      creditCap: program.credit_cap_per_week,
      usedCredits: usage.credits,
    });
    droppedCount = verdict.dropped.length;

    const rows: NewAction[] = verdict.items.map((item) => ({
      workspace_id: program.workspace_id,
      program_id: program.id,
      kind: "content",
      // Assist: nothing is made until a person says yes to the plan.
      status: program.mode === "assist" ? "proposed" : "planned",
      dedupe_key: `content:${program.id}:${cycle}:${item.slot.index}`,
      cycle,
      slot: item.slot.index,
      planned_for: item.slot.at,
      platform: item.slot.platform,
      content_type: item.type,
      title: item.title,
      brief: item.brief,
      reason: item.reason,
      goal: program.goal,
      opportunity_id: item.opportunity === null ? null : opportunities[item.opportunity].id,
      // Made ahead of the slot (a day for a Story, three for a post), never at it.
      next_attempt_at: generateAt(item.slot.at, now, item.type).toISOString(),
      ...(item.type === "story"
        ? {
            result: {
              story_theme: item.slot.topic,
              story_platforms: item.slot.platforms ?? [item.slot.platform],
            },
          }
        : {}),
    }));
    const inserted = await store.insertActions(rows);
    planned = inserted.length;
    for (const row of inserted) {
      if (row.opportunity_id) {
        await store.updateOpportunity(row.opportunity_id, { status: "accepted" }, "new");
      }
    }
  }

  // This week's recurring work beyond posts (for example the AI visibility check).
  await store.insertActions(
    program.automations
      .filter((name) => (WEEKLY_AUTOMATIONS as readonly string[]).includes(name))
      .map((name) => ({
        workspace_id: program.workspace_id,
        program_id: program.id,
        kind: "task" as const,
        status: "planned" as const,
        dedupe_key: `task:${program.id}:${cycle}:${name}`,
        cycle,
        content_type: name,
        title: TASK_TITLE[name] ?? name,
        // The summary is about the week, so it goes out the morning after it ends.
        next_attempt_at:
          name === "weekly_report"
            ? zonedInstant(addDaysYmd(start, 7), "08:00", program.timezone).toISOString()
            : now.toISOString(),
      })),
  );

  // Next week's plan, two days before that week starts.
  const nextStart = cycleStart(program, cycle + 1);
  if (nextStart <= program.ends_on) {
    await store.insertActions([
      {
        workspace_id: program.workspace_id,
        program_id: program.id,
        kind: "plan",
        status: "planned",
        dedupe_key: `plan:${program.id}:${cycle + 1}`,
        cycle: cycle + 1,
        title: "Plan the week",
        next_attempt_at: zonedInstant(
          addDaysYmd(nextStart, -2),
          "09:00",
          program.timezone,
        ).toISOString(),
      },
    ]);
  }
  await store.updateProgram(program.id, { cycle });

  const pieces = `${planned} ${planned === 1 ? "piece" : "pieces"}`;
  await finish(
    ctx,
    action,
    "done",
    { result: { planned, dropped: droppedCount, learnings }, finished_at: now.toISOString() },
    {
      kind: "plan_ready",
      summary:
        planned === 0
          ? `Nothing new to plan for the week of ${start}.`
          : program.mode === "assist"
            ? `Planned ${pieces} for the week of ${start}. Waiting for your OK.`
            : `Planned ${pieces} for the week of ${start}.`,
      data: { cycle, planned, dropped: droppedCount },
    },
  );
  if (planned === 0) await maybeComplete(ctx, program);
}

/* ───────────────────────── tasks ───────────────────────── */

const TASK_TITLE: Record<string, string> = {
  geo_scan: "Check AI visibility",
  repurpose: "Reuse the best post",
  weekly_report: "Send the weekly summary",
};

type TaskOutcome = { status: "done" | "skipped"; summary: string; quiet?: boolean };

/**
 * "Reuse what worked": the best measured post comes back in another format.
 * It only adds a planned piece; that piece is made, checked, approved and
 * counted against the weekly limits like any other.
 */
async function repurposeBest(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow,
): Promise<TaskOutcome> {
  const { store, ports } = ctx;
  const now = ports.now();
  const measured = await store.listActions(program.workspace_id, {
    statuses: ["measured"],
    kind: "content",
    since: inMs(now, -60 * 24 * HOUR),
    limit: 100,
  });
  const pieces = measured.map((a) => ({
    id: a.id,
    title: a.title,
    platform: a.platform,
    contentType: a.content_type,
    views: Number((a.result.metrics as Record<string, unknown> | undefined)?.views) || 0,
  }));
  const date = addDaysYmd(ymdInZone(now, program.timezone), 3);
  if (date > program.ends_on) {
    return { status: "skipped", summary: "Autopilot ends before a reused post could go out." };
  }
  const plannedFor = zonedInstant(date, "11:00", program.timezone).toISOString();
  const used = new Set<string>();
  // A post reused in an earlier week is refused by its dedupe key; try the next best.
  for (let i = 0; i < 5; i++) {
    const pick = pickRepurpose({
      pieces,
      contentTypes: program.content_types,
      platforms: program.platforms,
      used,
    });
    if (!pick) break;
    const { brief, reason } = repurposeBrief(pick);
    const [made] = await store.insertActions([
      {
        workspace_id: program.workspace_id,
        program_id: program.id,
        kind: "content",
        status: program.mode === "assist" ? "proposed" : "planned",
        dedupe_key: `repurpose:${pick.source.id}`,
        cycle: Math.max(1, action.cycle),
        planned_for: plannedFor,
        platform: pick.platform,
        content_type: pick.type,
        title: `${pick.source.title} (new format)`.slice(0, 200),
        brief,
        reason,
        goal: program.goal,
        next_attempt_at: generateAt(plannedFor, now, pick.type).toISOString(),
        result: { repurposed_from: pick.source.id },
      },
    ]);
    if (made) {
      return {
        status: "done",
        summary: `Reusing your best post as a ${describePiece(made)}: ${pick.source.title}`,
      };
    }
    used.add(pick.source.id);
  }
  return {
    status: "skipped",
    summary: "Nothing to reuse yet. Mellox needs a few posts with results first.",
    quiet: true,
  };
}

async function runTask(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
  actor: Actor,
): Promise<void> {
  const now = ctx.ports.now();
  const name = action.content_type ?? "";
  const out: TaskOutcome =
    name === "repurpose"
      ? program
        ? await repurposeBest(ctx, action, program)
        : { status: "skipped", summary: "Autopilot is not running.", quiet: true }
      : await ctx.ports.tasks.run(name, {
          workspaceId: action.workspace_id,
          userId: actor.userId,
          actionId: action.id,
        });
  await finish(
    ctx,
    action,
    out.status,
    {
      finished_at: now.toISOString(),
      last_error: out.status === "skipped" ? out.summary.slice(0, 480) : null,
    },
    out.quiet
      ? null
      : {
          kind: out.status === "done" ? "task_done" : "task_skipped",
          summary: out.summary.slice(0, 480),
        },
  );
  // The summary email is the last step of a program's final week.
  await maybeComplete(ctx, program);
}

/* ───────────────────────── scan ───────────────────────── */

async function runScan(ctx: Ctx, action: ActionRow): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();
  const workspaceId = action.workspace_id;
  await store.expireOpportunities(workspaceId, now.toISOString());

  const known = await store.knownFingerprints(workspaceId, inMs(now, -45 * 24 * HOUR));
  const candidates = filterCandidates(await ports.scan.collect(workspaceId), {
    knownFingerprints: new Set(known.map((k) => k.fingerprint)),
    recentTitles: known.map((k) => k.title),
    now,
  });

  const rows: NewOpportunity[] = [];
  const base = (candidate: Candidate) => ({
    workspace_id: workspaceId,
    kind: candidate.kind as OpportunityKind,
    title: candidate.title.slice(0, 200),
    summary: candidate.summary.slice(0, 1200),
    evidence: candidate.evidence as Evidence[],
    source_kind: candidate.sourceKind,
    source_id: candidate.sourceId,
    fingerprint: candidateFingerprint(candidate),
    expires_at: expiryFor(candidate.kind, now),
  });

  // A drop in the workspace's own numbers needs no model to be relevant.
  const internal = (c: Candidate) => c.kind === "performance" || c.kind === "visibility";
  for (const candidate of candidates.filter(internal)) {
    const visibility = candidate.kind === "visibility";
    const { score, parts } = scoreOpportunity(candidate, 75, now);
    rows.push({
      ...base(candidate),
      why_relevant: visibility
        ? "AI assistants can only recommend what they can read and trust."
        : "These posts reached far fewer people than your usual.",
      suggested_action: visibility
        ? "Open AI Visibility and apply the fixes?"
        : "Try a different angle or format on this channel.",
      suggested_type: "social",
      suggested_platforms: !visibility && candidate.sourceId ? [candidate.sourceId] : [],
      score,
      score_parts: parts,
    });
  }

  const external = candidates.filter((c) => !internal(c));
  if (external.length) {
    const ratings = await ports.scan.rate(workspaceId, external);
    const grounded = new Map<string, boolean>();
    for (const rating of ratings) {
      const candidate = external[rating.index];
      if (!candidate) continue;
      grounded.set(
        `${rating.index}`,
        await ports.scan.grounded(
          workspaceId,
          `${rating.why ?? ""} ${rating.action ?? ""}`,
          candidate,
        ),
      );
    }
    const rated = acceptRatings(external, ratings, now, (_text, candidate) => {
      return grounded.get(`${external.indexOf(candidate)}`) !== false;
    });
    const live = await store.liveProgram(workspaceId);
    for (const r of rated) {
      rows.push({
        ...base(r.candidate),
        why_relevant: r.why,
        suggested_action: r.action,
        suggested_type: r.format,
        suggested_platforms: live?.platforms.slice(0, 2) ?? [],
        score: r.score,
        score_parts: r.parts,
      });
    }
  }

  const inserted = rows.length ? await store.insertOpportunities(rows) : [];
  let acted = 0;

  // A running program may act on the strongest ones itself, within a weekly cap.
  const program = await store.liveProgram(workspaceId);
  if (
    program &&
    program.status === "running" &&
    program.mode !== "assist" &&
    program.act_on_opportunities
  ) {
    const cycle = Math.max(1, weekOf(program, ymdInZone(now, program.timezone)));
    let room = AUTO_ACT_PER_WEEK - (await store.autoActedInCycle(program.id, cycle));
    for (const opportunity of [...inserted].sort((a, b) => b.score - a.score)) {
      if (room <= 0) break;
      if (
        opportunity.kind === "performance" ||
        opportunity.kind === "visibility" ||
        opportunity.score < AUTO_ACT_SCORE
      ) {
        continue;
      }
      const format = (
        opportunity.suggested_type === "campaign" ? "social" : opportunity.suggested_type
      ) as OpportunityFormat;
      const made = await actionsFromOpportunity(store, {
        opportunity,
        program,
        format,
        platforms: opportunity.suggested_platforms,
        requestedBy: null,
        now,
        cycle,
      });
      if (!made.length) continue;
      await store.updateOpportunity(opportunity.id, { status: "accepted" }, "new");
      await store.addEvent({
        workspace_id: workspaceId,
        program_id: program.id,
        action_id: made[0].id,
        opportunity_id: opportunity.id,
        kind: "opportunity_taken",
        summary: `Acting on an opportunity: ${opportunity.title}`.slice(0, 480),
        data: { score: opportunity.score },
      });
      room--;
      acted++;
    }
  }

  await finish(
    ctx,
    action,
    "done",
    { result: { found: inserted.length, acted }, finished_at: now.toISOString() },
    inserted.length
      ? {
          kind: "opportunities_found",
          summary: `Found ${inserted.length} new ${inserted.length === 1 ? "opportunity" : "opportunities"}.`,
          data: { ids: inserted.map((o) => o.id) },
        }
      : null,
  );
}

/* ───────────────────────── content ───────────────────────── */

async function fail(
  ctx: Ctx,
  action: ActionRow,
  reason: string,
  kind = "step_failed",
): Promise<void> {
  await finish(
    ctx,
    action,
    "failed",
    { last_error: reason.slice(0, 480), finished_at: ctx.ports.now().toISOString() },
    {
      kind,
      summary: `Couldn't finish the ${describePiece(action)}: ${reason}`.slice(0, 480),
    },
  );
}

async function onJob(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
  job: JobLite,
  credits: number | null,
): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();

  if (job.status === "failed" || job.status === "cancelled") {
    await fail(ctx, action, job.error ?? "The piece could not be made.");
    return;
  }
  if (job.status !== "succeeded") {
    if (now.getTime() - Date.parse(job.createdAt) > GENERATION_TIMEOUT_MS) {
      await fail(ctx, action, "It took too long to make. Try again.");
      return;
    }
    await store.release(action, ctx.worker, {
      studio_job_id: job.id,
      next_attempt_at: inMs(now, 30_000),
      ...(credits === null ? {} : { credits_charged: credits }),
    });
    return;
  }

  if (!job.contentItemIds.length) {
    await fail(ctx, action, "Nothing was saved. Try again.");
    return;
  }
  const timeZone = program?.timezone ?? "UTC";
  const slot = action.planned_for ?? inMs(now, 24 * HOUR);
  for (const id of job.contentItemIds) {
    await ports.content.tag(action.workspace_id, id, {
      actionId: action.id,
      date: ymdInZone(new Date(slot), timeZone),
      time: hmInZone(slot, timeZone),
    });
  }
  await finish(
    ctx,
    action,
    "needs_approval",
    {
      studio_job_id: job.id,
      content_item_ids: job.contentItemIds,
      result: { ...action.result, warnings: job.warnings },
      // Looked at again straight away, so Full mode can decide without a wait.
      next_attempt_at: now.toISOString(),
      last_error: null,
      ...(credits === null ? {} : { credits_charged: credits }),
    },
    {
      kind: "piece_ready",
      summary: `Made a ${describePiece(action)}: ${action.title}`.slice(0, 480),
    },
  );
}

async function generate(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
  actor: Actor,
): Promise<void> {
  const { store, ports } = ctx;
  const key = `autopilot:${action.id}:${action.generation_attempt}`;

  if (action.status === "planned") {
    if (program) {
      const used = await store.usage(program.id, action.cycle);
      const verdict = budgetVerdict({
        type: (action.content_type ?? "social") as StudioType,
        usedCredits: used.credits,
        usedVideos: used.videos,
        creditCap: program.credit_cap_per_week,
        videoCap: program.video_cap_per_week,
      });
      if (!verdict.ok) {
        const why =
          verdict.reason === "videos"
            ? "This week's video limit is reached."
            : "This week's credit limit is reached.";
        await finish(
          ctx,
          action,
          "skipped",
          { last_error: why, finished_at: ports.now().toISOString() },
          { kind: "piece_skipped", summary: `Skipped a ${describePiece(action)}. ${why}` },
        );
        return;
      }
    }
    // Claim the work before spending anything. A lost race stops here.
    // The lease is kept: this invocation goes straight on to make the piece.
    const claimed = await store.transition(
      action,
      "generating",
      { attempts: 0 },
      { worker: ctx.worker, keepLease: true },
    );
    if (!claimed) return;
    action = { ...action, status: "generating" };
  }

  let job = action.studio_job_id
    ? await ports.studio.advance(action.workspace_id, action.studio_job_id)
    : await ports.studio.findJob(action.workspace_id, key);
  let credits: number | null = null;
  if (!job) {
    try {
      const story = action.content_type === "story";
      const storyPlatforms = Array.isArray(action.result.story_platforms)
        ? (action.result.story_platforms as unknown[]).filter(isStoryPlatform)
        : [];
      const made = await ports.studio.create({
        workspaceId: action.workspace_id,
        userId: actor.userId,
        role: actor.role,
        idempotencyKey: key,
        action,
        ...(story
          ? {
              platforms: storyPlatforms.length ? storyPlatforms : [action.platform ?? "instagram"],
              story: {
                frames: readStorySettings(program?.stories).frames,
                theme:
                  typeof action.result.story_theme === "string" ? action.result.story_theme : "tip",
              },
            }
          : {}),
      });
      job = made.job;
      credits = made.credits;
    } catch (error) {
      await fail(ctx, action, message(error));
      return;
    }
  } else if (job.status === "running" && !action.studio_job_id) {
    job = (await ports.studio.advance(action.workspace_id, job.id)) ?? job;
  }
  await onJob(ctx, action, program, job, credits);
}

async function awaitApproval(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();
  const items = await ports.content.get(action.workspace_id, action.content_item_ids);
  if (!items.length) {
    await finish(
      ctx,
      action,
      "cancelled",
      { finished_at: now.toISOString() },
      {
        kind: "piece_removed",
        summary: `The ${describePiece(action)} was deleted.`,
      },
    );
    return;
  }
  if (items.some((i) => i.status === "rejected")) {
    await finish(
      ctx,
      action,
      "rejected",
      { finished_at: now.toISOString() },
      {
        kind: "piece_rejected",
        summary: `You skipped the ${describePiece(action)}: ${action.title}`.slice(0, 480),
        actor: "user",
      },
    );
    return;
  }
  const settled = ["approved", "scheduled", "publishing", "published"];
  if (items.every((i) => settled.includes(i.status))) {
    await finish(
      ctx,
      action,
      "approved",
      { approved_via: action.approved_via ?? "user", next_attempt_at: now.toISOString() },
      action.approved_via
        ? null
        : {
            kind: "piece_approved",
            summary: `Approved: ${action.title}`.slice(0, 480),
            actor: "user",
          },
    );
    return;
  }
  if (isPastApproval(action.planned_for, now, action.content_type)) {
    await finish(
      ctx,
      action,
      "missed",
      { finished_at: now.toISOString() },
      {
        kind: "piece_missed",
        summary:
          `Not approved in time, so it wasn't sent: ${action.title}. It's still in your drafts.`.slice(
            0,
            480,
          ),
      },
    );
    await maybeComplete(ctx, program);
    return;
  }

  // Full mode: decide once whether this piece may go without a person.
  if (
    program?.mode === "full" &&
    ports.fullEnabled(action.workspace_id) &&
    !action.result.auto_checked &&
    items.every((i) => i.status === "pending")
  ) {
    const connected = await ports.connectedPlatforms(action.workspace_id);
    let invented = 0;
    for (const item of items) invented += await ports.scan.inventedFacts(action.workspace_id, item);
    const story = action.content_type === "story";
    const decision = publishDecision({
      mode: program?.mode ?? "assist",
      fullEnabled: ports.fullEnabled(action.workspace_id),
      hasProgram: Boolean(program),
      contentType: action.content_type,
      warnings: Number(action.result.warnings ?? 0),
      inventedFacts: invented,
      // Stories have their own daily cap: the number a day the person chose.
      autoApprovedToday: await store.autoApprovedSince(
        action.workspace_id,
        inMs(now, -24 * HOUR),
        story ? { contentType: "story" } : { excludeContentType: "story" },
      ),
      dailyCap: story ? readStorySettings(program?.stories).perDay : undefined,
      video: story && items.some((i) => i.meta.media_type === "video"),
      accountConnected: !action.platform || connected.includes(action.platform),
    });
    if (decision.auto) {
      let all = true;
      for (const item of items)
        all = (await ports.content.approve(action.workspace_id, item.id)) && all;
      if (all) {
        await finish(
          ctx,
          action,
          "approved",
          {
            approved_via: "auto",
            result: { ...action.result, auto_checked: true },
            next_attempt_at: now.toISOString(),
          },
          {
            kind: "piece_auto_approved",
            summary: `Approved automatically (it passed every check): ${action.title}`.slice(
              0,
              480,
            ),
          },
        );
        return;
      }
    }
    await store.release(action, ctx.worker, {
      result: { ...action.result, auto_checked: true, auto_reasons: decision.reasons },
      next_attempt_at: inMs(now, 3 * MIN),
    });
    return;
  }
  await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 3 * MIN) });
}

async function scheduleApproved(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
  actor: Actor,
): Promise<void> {
  const { ports } = ctx;
  const now = ports.now();
  const items = await ports.content.get(action.workspace_id, action.content_item_ids);
  if (!items.length) {
    await finish(
      ctx,
      action,
      "cancelled",
      { finished_at: now.toISOString() },
      {
        kind: "piece_removed",
        summary: `The ${describePiece(action)} was deleted.`,
      },
    );
    return;
  }
  // Edited after approval: the content trigger sent it back to draft.
  if (
    items.some((i) => i.status === "draft" || i.status === "pending" || i.status === "rejected")
  ) {
    await finish(
      ctx,
      action,
      "needs_approval",
      { approved_via: null, approved_by: null, next_attempt_at: now.toISOString() },
      {
        kind: "piece_changed",
        summary: `Changed after approval, so it needs a new OK: ${action.title}`.slice(0, 480),
      },
    );
    return;
  }
  if (!PUBLISHABLE_TYPES.includes(action.content_type as StudioType)) {
    // An approved article goes to the blog when the program was told to send
    // them. The article publisher decides whether it can; it is asked once.
    let sent: { status: "sent" | "skipped"; summary: string } | null = null;
    if (
      action.content_type === "article" &&
      program?.automations.includes("publish_articles") &&
      items.every((i) => i.status === "approved")
    ) {
      try {
        sent = await ports.site.publishArticle({
          workspaceId: action.workspace_id,
          userId: actor.userId,
          role: actor.role,
          contentItemId: items[0].id,
        });
      } catch (error) {
        sent = {
          status: "skipped",
          summary: `Your article is ready, but it couldn't be sent to your website (${message(error)}):`,
        };
      }
    }
    await finish(
      ctx,
      action,
      "done",
      {
        finished_at: now.toISOString(),
        ...(sent ? { result: { ...action.result, site: sent.status } } : {}),
      },
      {
        kind: sent?.status === "sent" ? "article_sent" : "piece_done",
        summary: (sent
          ? `${sent.summary} ${action.title}`
          : `Your ${describePiece(action)} is ready: ${action.title}`
        ).slice(0, 480),
      },
    );
    await maybeComplete(ctx, program);
    return;
  }

  const timeZone = program?.timezone ?? "UTC";
  const done = (item: ContentLite) =>
    ["scheduled", "publishing", "published"].includes(item.status);
  let reason: string | null = null;
  let at = scheduleTime(action.planned_for, now).toISOString();
  for (const item of items) {
    // The gate: only an item that reads `approved` right now is handed over.
    if (done(item) || item.status !== "approved") continue;
    try {
      const out = await ports.schedule({
        workspaceId: action.workspace_id,
        userId: actor.userId,
        role: actor.role,
        contentItemId: item.id,
        at,
      });
      reason = out.reason ?? reason;
    } catch (error) {
      reason = message(error);
    }
  }
  // Whatever the call said, the row is the truth.
  const after = await ports.content.get(action.workspace_id, action.content_item_ids);
  if (after.length && after.every(done)) {
    const scheduledAt = after.map((i) => i.scheduled_at ?? "").find(Boolean);
    at = scheduledAt || at;
    await finish(
      ctx,
      action,
      "scheduled",
      { result: { ...action.result, scheduled_at: at }, next_attempt_at: at, last_error: null },
      {
        kind: "piece_scheduled",
        summary: `Scheduled for ${when(at, timeZone)}: ${action.title}`.slice(0, 480),
        data: { at },
      },
    );
    return;
  }
  await fail(ctx, action, reason ?? "It could not be scheduled.", "schedule_failed");
}

async function watchScheduled(ctx: Ctx, action: ActionRow): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();
  const items = await ports.content.get(action.workspace_id, action.content_item_ids);
  if (!items.length) {
    await finish(ctx, action, "cancelled", { finished_at: now.toISOString() }, null);
    return;
  }
  if (items.every((i) => i.status === "published")) {
    await finish(
      ctx,
      action,
      "published",
      // A Story's numbers are final once it has expired.
      {
        next_attempt_at: inMs(
          now,
          action.content_type === "story" ? STORY_MEASURE_AFTER_MS : 48 * HOUR,
        ),
      },
      { kind: "piece_published", summary: `Posted: ${action.title}`.slice(0, 480) },
    );
    return;
  }
  const failed = items.find((i) => i.status === "failed" || i.status === "partial_failed");
  if (failed) {
    const detail = failed.meta.last_distribution_error;
    await fail(
      ctx,
      action,
      typeof detail === "string" && detail ? detail : "The post didn't go out.",
      "publish_failed",
    );
    return;
  }
  // Unscheduled by a person: back in their hands.
  if (items.some((i) => ["approved", "draft", "pending", "rejected"].includes(i.status))) {
    await finish(
      ctx,
      action,
      "cancelled",
      { finished_at: now.toISOString() },
      {
        kind: "piece_unscheduled",
        summary: `Taken off the schedule by your team: ${action.title}`.slice(0, 480),
        actor: "user",
      },
    );
    return;
  }
  await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 5 * MIN) });
}

async function measure(ctx: Ctx, action: ActionRow, program: ProgramRow | null): Promise<void> {
  const items = await ctx.ports.content.get(action.workspace_id, action.content_item_ids);
  const metrics: Record<string, number> = {};
  for (const item of items) {
    for (const key of ["views", "likes", "comments", "shares", "saves", "reach", "replies"]) {
      const value = Number(item.metrics?.[key]);
      if (Number.isFinite(value) && value > 0) metrics[key] = (metrics[key] ?? 0) + value;
    }
  }
  const views = metrics.views;
  await finish(
    ctx,
    action,
    "measured",
    { result: { ...action.result, metrics }, finished_at: ctx.ports.now().toISOString() },
    {
      kind: "piece_measured",
      summary: (views
        ? `Results so far: ${views.toLocaleString("en-US")} views for ${action.title}`
        : `No numbers yet for ${action.title}`
      ).slice(0, 480),
      data: { metrics },
    },
  );
  await maybeComplete(ctx, program);
}

/* ───────────────────────── advance one action ───────────────────────── */

async function resolveActor(
  ctx: Ctx,
  action: ActionRow,
  program: ProgramRow | null,
): Promise<Actor | null> {
  const userId = program?.acting_user_id ?? action.requested_by;
  if (!userId) return null;
  const role = await ctx.ports.memberRole(action.workspace_id, userId);
  return role && CAN_ACT.includes(role) ? { userId, role } : null;
}

export async function advance(ctx: Ctx, action: ActionRow): Promise<void> {
  const { store, ports } = ctx;
  const now = ports.now();
  const workspaceId = action.workspace_id;

  if (!ports.enabled(workspaceId)) {
    await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 30 * MIN) });
    return;
  }
  const program = action.program_id ? await store.getProgram(action.program_id) : null;
  if (action.program_id && (!program || program.status !== "running")) {
    await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 30 * MIN) });
    return;
  }

  if (await ports.automationPaused(workspaceId)) {
    if (program) {
      const paused = await store.updateProgram(
        program.id,
        { status: "paused", pause_reason: "agents_paused" },
        "running",
      );
      if (paused) {
        await store.addEvent({
          workspace_id: workspaceId,
          program_id: program.id,
          kind: "program_paused",
          summary: "Paused: automation is switched off for this workspace.",
        });
      }
    }
    await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 30 * MIN) });
    return;
  }

  if (action.kind === "scan") return runScan(ctx, action);

  // Everything else acts for a person, so that person must still be on the team.
  const actor = await resolveActor(ctx, action, program);
  if (!actor) {
    if (program) {
      const paused = await store.updateProgram(
        program.id,
        { status: "paused", pause_reason: "member_left" },
        "running",
      );
      if (paused) {
        await store.addEvent({
          workspace_id: workspaceId,
          program_id: program.id,
          kind: "program_paused",
          summary: "Paused: the person who started Autopilot is no longer an editor here.",
        });
      }
      await store.release(action, ctx.worker, { next_attempt_at: inMs(now, 30 * MIN) });
    } else {
      await fail(ctx, action, "The person who asked for this is no longer an editor here.");
    }
    return;
  }

  if (action.kind === "plan") return runPlan(ctx, action, program!);
  if (action.kind === "task") return runTask(ctx, action, program, actor);

  switch (action.status) {
    case "planned":
    case "generating":
      return generate(ctx, action, program, actor);
    case "needs_approval":
      return awaitApproval(ctx, action, program);
    case "approved":
      return scheduleApproved(ctx, action, program, actor);
    case "scheduled":
      return watchScheduled(ctx, action);
    case "published":
      return measure(ctx, action, program);
    default:
      await store.release(action, ctx.worker);
  }
}

/* ───────────────────────── the sweep ───────────────────────── */

export type SweepResult = { claimed: number; advanced: number; failed: number; deferred: number };

/** Steps that spend money or take a while; at most one per workspace per sweep. */
function isHeavy(action: ActionRow): boolean {
  if (action.kind === "task") return false;
  return action.kind !== "content" || action.status === "planned";
}

export async function runSweep(
  store: AutopilotStore,
  ports: AutopilotPorts,
  opts: { worker: string; budgetMs?: number; max?: number; onlyId?: string },
): Promise<SweepResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const ctx: Ctx = { store, ports, worker: opts.worker };
  const claimed = await store.claim(opts.worker, opts.max ?? 12, LEASE_SECONDS, opts.onlyId);
  const result: SweepResult = { claimed: claimed.length, advanced: 0, failed: 0, deferred: 0 };
  const heavyDone = new Set<string>();

  for (const action of claimed) {
    const heavy = isHeavy(action);
    if (Date.now() - started > budgetMs || (heavy && heavyDone.has(action.workspace_id))) {
      await store.release(action, opts.worker, {
        next_attempt_at: inMs(ports.now(), heavy ? MIN : 0),
      });
      result.deferred++;
      continue;
    }
    if (heavy) heavyDone.add(action.workspace_id);
    try {
      await advance(ctx, action);
      result.advanced++;
    } catch (error) {
      result.failed++;
      const attempts = action.attempts + 1;
      const reason = message(error);
      console.error(`[autopilot] ${action.kind}/${action.status} ${action.id} failed:`, reason);
      if (attempts >= MAX_ERRORS && canTransition(action.kind, action.status, "failed")) {
        const latest = (await store.getAction(action.workspace_id, action.id)) ?? action;
        await store
          .transition(latest, "failed", { attempts, last_error: reason })
          .catch(() => false);
        await store.addEvent({
          workspace_id: action.workspace_id,
          program_id: action.program_id,
          action_id: action.id,
          kind: "step_failed",
          summary: `A step kept failing and was stopped: ${reason}`.slice(0, 480),
        });
      } else {
        await store
          .release(action, opts.worker, {
            attempts,
            last_error: reason,
            next_attempt_at: inMs(ports.now(), Math.min(60, 5 * attempts) * MIN),
          })
          .catch(() => undefined);
      }
    }
  }
  return result;
}
