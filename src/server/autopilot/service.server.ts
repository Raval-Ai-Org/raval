// service.server.ts — what a person can do to Autopilot, and the cron entry.
// Every function here is called after the workspace and role were verified by
// the RPC layer; each change is written to the append-only history and the
// workspace audit log.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import {
  AUTOMATIONS,
  AUTOPILOT_TYPES,
  type Automation,
  type ReadinessItem,
  OPPORTUNITY_FORMATS,
  StrategySchema,
  type ActionRow,
  type ActionView,
  type AgencyAutopilotRow,
  type AutopilotView,
  type EventRow,
  type OpportunityFormat,
  type OpportunityRow,
  type OpportunityView,
  type ProgramRow,
  type ProgramSettings,
  type ProgramView,
} from "@/lib/autopilot/contracts";
import { totalWeeks, weekOf } from "@/lib/autopilot/policy";
import { CANCELLABLE_STATUSES } from "@/lib/autopilot/state";
import { addDaysYmd, isValidTimeZone, ymdInZone } from "@/lib/autopilot/time";
import { readStorySettings, storyTimes } from "@/lib/stories/schedule";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { signAssetPath } from "@/server/assets/persist.server";
import { isAutopilotEnabled, isFullAutopilotEnabled } from "@/lib/feature-flags";
import type { PlatformId } from "@/lib/social-platforms";
import { recordAudit } from "@/server/audit.server";
import { roleAtLeast, type WorkspaceRole } from "@/server/api-auth";
import { requireBillingFeature } from "@/server/billing/feature.server";
import { HttpError } from "@/server/http-error";
import { appUrl, emailConfigured, sendEmail } from "@/server/notify/email.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  actionsFromOpportunity,
  describePiece,
  enqueueScan,
  runSweep,
  type SweepResult,
} from "./engine";
import {
  approveContent,
  connectedPlatforms,
  loadContent,
  realPorts,
  rejectContent,
} from "./ports.server";
import { supabaseAutopilotStore as store } from "./store.server";

const WORKER = `autopilot-${process.pid}-${randomUUID().slice(0, 8)}`;
const DAY = 86_400_000;

export type Caller = { workspaceId: string; userId: string; role: WorkspaceRole };

/** Off means "doesn't exist": 404, exactly like an unknown route. */
export function assertAutopilotEnabled(workspaceId: string): void {
  if (!isAutopilotEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

/* ───────────────────────── cron + kick ───────────────────────── */

/**
 * Cron entry: advance whatever is due, inside the budget. Called from the
 * run-schedules hook, which is already scheduled — Autopilot adds no cron job.
 */
export async function runDueAutopilot(
  opts: { budgetMs?: number; max?: number } = {},
): Promise<SweepResult> {
  const result = await runSweep(store, realPorts, { worker: WORKER, ...opts });
  await notifyWaiting().catch((error) => console.error("[autopilot] notice failed", error));
  return result;
}

const NOTICE_EVERY_MS = 20 * 60 * 60_000;

/**
 * Tell the member a program acts for that posts are waiting on them — by
 * email, at most once a day per program — so nobody has to open Mellox to
 * find out. Sent only when something is actually waiting. Pieces that failed
 * to go out in the last day (a Story is gone for good if nobody retries it)
 * ride in the same email; they never trigger one on their own schedule.
 */
export async function notifyWaiting(limit = 20): Promise<number> {
  if (!emailConfigured()) return 0;
  const admin = supabaseAdmin as unknown as SupabaseClient;
  const { data: waiting, error } = await admin
    .from("autopilot_actions")
    .select("program_id, workspace_id, status, title")
    .in("status", ["needs_approval", "proposed"])
    .not("program_id", "is", null)
    .limit(500);
  if (error) throw new Error(error.message);
  const { data: failedRows } = await admin
    .from("autopilot_actions")
    .select("program_id, workspace_id, status, title")
    .eq("status", "failed")
    .eq("kind", "content")
    .not("program_id", "is", null)
    .gte("updated_at", new Date(Date.now() - NOTICE_EVERY_MS).toISOString())
    .limit(200);
  const byProgram = new Map<string, { workspaceId: string; titles: string[]; failed: string[] }>();
  for (const row of [...(waiting ?? []), ...(failedRows ?? [])] as {
    program_id: string;
    workspace_id: string;
    status: string;
    title: string;
  }[]) {
    const entry = byProgram.get(row.program_id) ?? {
      workspaceId: row.workspace_id,
      titles: [],
      failed: [],
    };
    (row.status === "failed" ? entry.failed : entry.titles).push(row.title);
    byProgram.set(row.program_id, entry);
  }
  let sent = 0;
  for (const [programId, entry] of byProgram) {
    if (sent >= limit) break;
    if (!isAutopilotEnabled(entry.workspaceId)) continue;
    const program = await store.getProgram(programId);
    if (!program || program.status !== "running" || !program.acting_user_id) continue;
    if (
      program.last_notified_at &&
      Date.now() - Date.parse(program.last_notified_at) < NOTICE_EVERY_MS
    ) {
      continue;
    }
    // Claim the notice first, so two overlapping sweeps send one email.
    let claim = admin
      .from("autopilot_programs")
      .update({ last_notified_at: new Date().toISOString() })
      .eq("id", programId);
    claim = program.last_notified_at
      ? claim.eq("last_notified_at", program.last_notified_at)
      : claim.is("last_notified_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) continue;

    const { data: user } = await supabaseAdmin.auth.admin.getUserById(program.acting_user_id);
    const email = user?.user?.email;
    if (!email) continue;
    const { data: ws } = await admin
      .from("workspaces")
      .select("name")
      .eq("id", entry.workspaceId)
      .maybeSingle();
    const name = (ws as { name?: string } | null)?.name ?? "your workspace";
    const n = entry.titles.length;
    const f = entry.failed.length;
    const list = (titles: string[]) =>
      titles
        .slice(0, 6)
        .map((t) => `• ${t}`)
        .join("\n");
    const ok = await sendEmail({
      to: email,
      subject: n
        ? `${n} ${n === 1 ? "post is" : "posts are"} waiting for your OK`
        : `${f} ${f === 1 ? "post" : "posts"} didn't go out`,
      text: [
        n ? `Autopilot for ${name} has ${n === 1 ? "a post" : `${n} posts`} ready:` : "",
        n ? list(entry.titles) : "",
        n ? "Nothing goes out until you approve it." : "",
        f ? `${f === 1 ? "This" : "These"} didn't go out for ${name}:` : "",
        f ? list(entry.failed) : "",
        f ? "Open Autopilot to see why and try again." : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      action: [
        n ? "Review and approve" : "See what happened",
        appUrl(`/w/${entry.workspaceId}/app/autopilot`),
      ],
    });
    if (ok) sent++;
  }
  return sent;
}

/** Continue one action after the response is sent, so a click feels instant. */
function kick(actionId: string): void {
  after(async () => {
    try {
      await runSweep(store, realPorts, {
        worker: WORKER,
        onlyId: actionId,
        budgetMs: 100_000,
        max: 1,
      });
    } catch (error) {
      console.error(`[autopilot] background step for ${actionId} failed`, error);
    }
  });
}

/** Ask for an opportunity scan (Market Brain or a competitor sweep found something). */
export async function requestOpportunityScan(workspaceId: string): Promise<void> {
  if (!isAutopilotEnabled(workspaceId)) return;
  try {
    await enqueueScan(store, workspaceId, new Date());
  } catch (error) {
    console.error(`[autopilot] could not queue a scan for ${workspaceId}`, error);
  }
}

/* ───────────────────────── present ───────────────────────── */

function parseStrategy(raw: unknown) {
  const parsed = StrategySchema.safeParse(raw);
  return parsed.success && parsed.data.pillars.length ? parsed.data : null;
}

function presentProgram(row: ProgramRow, now: Date): ProgramView {
  const total = totalWeeks(row);
  return {
    id: row.id,
    status: row.status,
    pauseReason: row.pause_reason,
    mode: row.mode,
    goal: row.goal,
    goalNote: row.goal_note,
    platforms: row.platforms as PlatformId[],
    contentTypes: row.content_types.filter((t): t is ProgramView["contentTypes"][number] =>
      (AUTOPILOT_TYPES as readonly string[]).includes(t),
    ),
    postsPerWeek: row.posts_per_week,
    weekdays: row.weekdays,
    timezone: row.timezone,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    styleId: row.style_id,
    creditCapPerWeek: row.credit_cap_per_week,
    videoCapPerWeek: row.video_cap_per_week,
    actOnOpportunities: row.act_on_opportunities,
    strategy: parseStrategy(row.strategy),
    automations: (row.automations ?? []).filter((a): a is Automation =>
      (AUTOMATIONS as readonly string[]).includes(a),
    ),
    stories: readStorySettings(row.stories),
    week: Math.min(total, Math.max(1, weekOf(row, ymdInZone(now, row.timezone)))),
    totalWeeks: total,
  };
}

function presentAction(row: ActionRow): ActionView {
  const metrics = row.result?.metrics;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    plannedFor: row.planned_for,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title,
    brief: row.brief,
    reason: row.reason,
    opportunityId: row.opportunity_id,
    contentItemIds: row.content_item_ids,
    creditsCharged: row.credits_charged,
    approvedVia: row.approved_via,
    error: row.last_error,
    metrics: metrics && typeof metrics === "object" ? (metrics as Record<string, number>) : null,
    updatedAt: row.updated_at,
  };
}

function presentOpportunity(row: OpportunityRow): OpportunityView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    why: row.why_relevant,
    suggestedAction: row.suggested_action,
    suggestedType: (OPPORTUNITY_FORMATS as readonly string[]).includes(row.suggested_type)
      ? (row.suggested_type as OpportunityFormat)
      : "social",
    suggestedPlatforms: row.suggested_platforms as PlatformId[],
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    score: row.score,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function presentEvent(row: EventRow) {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    actor: row.actor,
    actionId: row.action_id,
    createdAt: row.created_at,
  };
}

/* ───────────────────────── read ───────────────────────── */

const admin = supabaseAdmin as unknown as SupabaseClient;

/** What Autopilot needs before it can do real work, and what is still missing. */
async function readiness(
  workspaceId: string,
  program: ProgramRow | null,
  connected: string[],
): Promise<ReadinessItem[]> {
  const [{ data: ws }, { data: dna }] = await Promise.all([
    admin.from("workspaces").select("website_url").eq("id", workspaceId).maybeSingle(),
    admin.from("workspace_brand_dna").select("dna").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const website = (ws as { website_url?: string | null } | null)?.website_url ?? null;
  const dnaSize = JSON.stringify((dna as { dna?: unknown } | null)?.dna ?? {}).length;
  const stories = readStorySettings(program?.stories);
  const wanted = [
    ...new Set([
      ...(program && program.posts_per_week > 0 ? program.platforms : []),
      ...(stories.enabled ? stories.platforms : []),
    ]),
  ];
  const missing = wanted.filter((p) => !connected.includes(p));
  const accountsOk = connected.length > 0 && missing.length === 0;
  return [
    {
      id: "accounts",
      ok: accountsOk,
      required: true,
      label: accountsOk ? "Social accounts connected" : "Connect your social accounts",
      detail: accountsOk
        ? `${connected.length} connected`
        : missing.length
          ? `Not connected: ${missing.join(", ")}`
          : "Posts can't go out until an account is connected.",
      cta: "Connect",
    },
    {
      id: "brand",
      ok: dnaSize > 300,
      required: false,
      label: dnaSize > 300 ? "Brand DNA ready" : "Add your Brand DNA",
      detail:
        dnaSize > 300 ? "Posts are written from it" : "So posts sound like you and stay true.",
      cta: "Add",
    },
    {
      id: "website",
      ok: Boolean(website),
      required: false,
      label: website ? "Website set" : "Add your website",
      detail: website
        ? "Checked every week for AI visibility"
        : "Needed for the AI visibility check.",
      cta: "Add",
    },
  ];
}

function latestLearnings(actions: ActionRow[]): string[] {
  const plan = actions
    .filter((a) => a.kind === "plan" && a.status === "done")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const list = plan?.result?.learnings;
  return Array.isArray(list) ? list.filter((l): l is string => typeof l === "string") : [];
}

function latestTasks(actions: ActionRow[]): ActionView[] {
  const seen = new Set<string>();
  return actions
    .filter((a) => a.kind === "task")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .filter((a) => {
      const key = a.content_type ?? "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(presentAction);
}

async function latestVisibility(workspaceId: string) {
  const { data } = await admin
    .from("geo_scans")
    .select("overall_score, completed_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { overall_score: number | null; completed_at: string | null } | null;
  return row ? { score: row.overall_score, scannedAt: row.completed_at } : null;
}

/** Story Autopilot at a glance: today's times and what's queued. */
function storySummary(
  program: ProgramRow,
  actions: ActionRow[],
  now: Date,
): AutopilotView["stories"] {
  const settings = readStorySettings(program.stories);
  if (!settings.enabled) return null;
  const stories = actions.filter((a) => a.content_type === "story");
  const planned = stories
    .filter((a) => a.planned_for && Date.parse(a.planned_for) > now.getTime())
    .sort((a, b) => (a.planned_for ?? "").localeCompare(b.planned_for ?? ""));
  const { times, source } = storyTimes({
    windowStart: settings.windowStart,
    windowEnd: settings.windowEnd,
    perDay: settings.perDay,
  });
  return {
    enabled: true,
    times: planned.length
      ? [
          ...new Set(
            planned.slice(0, settings.perDay).map((a) => hmIn(a.planned_for!, program.timezone)),
          ),
        ]
      : times,
    timing: settings.smartTiming && planned.length ? "learned" : source,
    upcoming: stories.filter((a) =>
      ["planned", "generating", "approved", "scheduled"].includes(a.status),
    ).length,
    waiting: stories.filter((a) => a.status === "needs_approval").length,
  };
}

function hmIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** For the sidebar: is it available, is it running, is anything waiting. */
export async function getAutopilotBadge(workspaceId: string) {
  const program = await store.liveProgram(workspaceId);
  if (!program) return { status: null, waiting: 0 };
  const waiting = await store.listActions(workspaceId, {
    statuses: ["needs_approval", "proposed"],
    limit: 50,
  });
  return { status: program.status, waiting: waiting.length };
}

export async function getAutopilotView(caller: Caller): Promise<AutopilotView> {
  const { workspaceId, role } = caller;
  const now = new Date();
  const [program, all, opportunities, events, connected] = await Promise.all([
    store.liveProgram(workspaceId),
    store.listActions(workspaceId, {
      since: new Date(now.getTime() - 45 * DAY).toISOString(),
      limit: 300,
    }),
    store.listOpportunities(workspaceId, { statuses: ["new"], limit: 20 }),
    store.listEvents(workspaceId, 60),
    connectedPlatforms(workspaceId).catch(() => [] as string[]),
  ]);

  const actions = all.filter((a) => a.kind === "content");
  const waiting = actions.filter((a) => a.status === "needs_approval");
  const previews = await loadContent(
    workspaceId,
    waiting.flatMap((a) => a.content_item_ids.slice(0, 1)),
  ).catch(() => []);
  const previewById = new Map(previews.map((p) => [p.id, p]));

  let budget: AutopilotView["budget"] = null;
  if (program) {
    const cycle = Math.max(1, weekOf(program, ymdInZone(now, program.timezone)));
    const used = await store.usage(program.id, cycle);
    budget = {
      creditsUsed: used.credits,
      creditCap: program.credit_cap_per_week,
      videosUsed: used.videos,
      videoCap: program.video_cap_per_week,
    };
  }

  const byRecent = (a: ActionRow, b: ActionRow) => b.updated_at.localeCompare(a.updated_at);
  const pick = (...statuses: string[]) => actions.filter((a) => statuses.includes(a.status));

  return {
    enabled: true,
    fullAvailable: isFullAutopilotEnabled(workspaceId),
    canEdit: roleAtLeast(role, "editor"),
    canManage: roleAtLeast(role, "admin"),
    program: program ? presentProgram(program, now) : null,
    budget,
    proposed: pick("proposed").map(presentAction),
    approvals: await Promise.all(
      waiting.map(async (a) => {
        const item = previewById.get(a.content_item_ids[0]);
        return {
          ...presentAction(a),
          preview: item
            ? {
                contentItemId: item.id,
                status: item.status,
                title: item.title,
                body: item.body.slice(0, 1_200),
                mediaUrl:
                  item.media_url && /^https?:\/\//.test(item.media_url) ? item.media_url : null,
                channel: item.channel,
                frames: await storyFrameUrls(workspaceId, item),
              }
            : null,
        };
      }),
    ),
    upcoming: pick("planned", "generating", "approved", "scheduled").map(presentAction),
    finished: pick("published", "measured", "done").sort(byRecent).slice(0, 30).map(presentAction),
    failed: pick("failed", "missed")
      .filter((a) => Date.parse(a.updated_at) > now.getTime() - 14 * DAY)
      .sort(byRecent)
      .map(presentAction),
    opportunities: opportunities.map(presentOpportunity),
    events: events.map(presentEvent),
    connectedPlatforms: connected as PlatformId[],
    stories: program ? storySummary(program, actions, now) : null,
    readiness: await readiness(workspaceId, program, connected),
    learnings: latestLearnings(all),
    tasks: latestTasks(all),
    visibility: await latestVisibility(workspaceId),
  };
}

/* ───────────────────────── program ───────────────────────── */

function checkSettings(workspaceId: string, settings: ProgramSettings): void {
  if (!isValidTimeZone(settings.timezone))
    throw new HttpError(400, "That time zone isn't recognised.");
  if (settings.mode === "full" && !isFullAutopilotEnabled(workspaceId)) {
    throw new HttpError(400, "Full Autopilot isn't available for this workspace yet.");
  }
  if (settings.contentTypes.includes("video") && settings.videoCapPerWeek < 1) {
    throw new HttpError(400, "Set how many videos a week Autopilot may make, or leave video out.");
  }
}

/** Signed URLs of a Story's drawn frames, for the approval preview. */
async function storyFrameUrls(
  workspaceId: string,
  item: { meta: Record<string, unknown> },
): Promise<string[] | undefined> {
  if (item.meta.studio_type !== "story") return undefined;
  const paths = (
    Array.isArray(item.meta.asset_storage_paths)
      ? item.meta.asset_storage_paths
      : [item.meta.asset_storage_path]
  ).filter((p): p is string => isWorkspaceStoragePath(p, workspaceId));
  const urls = await Promise.all(paths.slice(0, 7).map((p) => signAssetPath(p)));
  return urls.filter((u): u is string => !!u);
}

function programColumns(settings: ProgramSettings, startsOn: string) {
  return {
    mode: settings.mode,
    goal: settings.goal,
    goal_note: settings.goalNote,
    platforms: [...new Set(settings.platforms)],
    content_types: [...new Set(settings.contentTypes)],
    posts_per_week: settings.postsPerWeek,
    weekdays: [...new Set(settings.weekdays)].sort(),
    timezone: settings.timezone,
    starts_on: startsOn,
    ends_on: addDaysYmd(startsOn, settings.weeks * 7 - 1),
    style_id: settings.styleId ?? null,
    credit_cap_per_week: settings.creditCapPerWeek,
    video_cap_per_week: settings.contentTypes.includes("video") ? settings.videoCapPerWeek : 0,
    act_on_opportunities: settings.actOnOpportunities,
    automations: [...new Set(settings.automations ?? [])],
    stories: settings.stories,
    ...(settings.strategy ? { strategy: settings.strategy } : {}),
  };
}

async function log(
  caller: Caller,
  kind: string,
  summary: string,
  extra: {
    programId?: string | null;
    actionId?: string | null;
    opportunityId?: string | null;
    data?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await store.addEvent({
    workspace_id: caller.workspaceId,
    program_id: extra.programId ?? null,
    action_id: extra.actionId ?? null,
    opportunity_id: extra.opportunityId ?? null,
    kind,
    summary: summary.slice(0, 480),
    data: extra.data ?? {},
    actor: "user",
    actor_id: caller.userId,
  });
  await recordAudit({
    workspaceId: caller.workspaceId,
    userId: caller.userId,
    action: `autopilot.${kind}`,
    entity: extra.actionId ?? extra.opportunityId ?? extra.programId ?? "autopilot",
    payload: extra.data,
  });
}

export async function startProgram(caller: Caller, settings: ProgramSettings): Promise<void> {
  const { workspaceId, userId, role } = caller;
  checkSettings(workspaceId, settings);
  await requireBillingFeature({ workspaceId, userId, role, feature: "autopilot", spending: true });
  if (await store.liveProgram(workspaceId)) {
    throw new HttpError(409, "Autopilot is already set up for this workspace.");
  }
  const now = new Date();
  const startsOn = ymdInZone(now, settings.timezone);
  let program: ProgramRow;
  try {
    program = await store.insertProgram({
      workspace_id: workspaceId,
      status: "running",
      ...programColumns(settings, startsOn),
      acting_user_id: userId,
      created_by: userId,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/duplicate key|one_live/i.test(text)) {
      throw new HttpError(409, "Autopilot is already set up for this workspace.");
    }
    if (/style is not in its workspace/i.test(text))
      throw new HttpError(400, "That style isn't in this workspace.");
    throw error;
  }
  const [plan] = await store.insertActions([
    {
      workspace_id: workspaceId,
      program_id: program.id,
      kind: "plan",
      status: "planned",
      dedupe_key: `plan:${program.id}:1`,
      cycle: 1,
      title: "Plan the week",
      next_attempt_at: now.toISOString(),
    },
  ]);
  await enqueueScan(store, workspaceId, now);
  await log(caller, "program_started", "Autopilot started.", {
    programId: program.id,
    data: { mode: program.mode, goal: program.goal, weeks: settings.weeks },
  });
  if (plan) kick(plan.id);
}

export async function updateProgram(caller: Caller, settings: ProgramSettings): Promise<void> {
  const { workspaceId } = caller;
  checkSettings(workspaceId, settings);
  const program = await store.liveProgram(workspaceId);
  if (!program) throw new HttpError(404, "Autopilot isn't set up yet.");
  const columns = programColumns(settings, program.starts_on);
  try {
    await store.updateProgram(program.id, columns);
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/style is not in its workspace/i.test(text))
      throw new HttpError(400, "That style isn't in this workspace.");
    throw error;
  }
  await log(
    caller,
    "program_changed",
    "Autopilot settings changed. They apply from the next plan.",
    {
      programId: program.id,
      data: { mode: columns.mode, posts_per_week: columns.posts_per_week },
    },
  );
}

export async function setPaused(caller: Caller, paused: boolean): Promise<void> {
  const program = await store.liveProgram(caller.workspaceId);
  if (!program) throw new HttpError(404, "Autopilot isn't set up yet.");
  if (paused) {
    const ok = await store.updateProgram(
      program.id,
      { status: "paused", pause_reason: "user" },
      "running",
    );
    if (ok) {
      await log(
        caller,
        "program_paused",
        "Autopilot paused. Posts already scheduled will still go out.",
        {
          programId: program.id,
        },
      );
    }
    return;
  }
  await requireBillingFeature({ ...caller, feature: "autopilot", spending: true });
  // Whoever resumes it becomes the member it acts for.
  const ok = await store.updateProgram(
    program.id,
    { status: "running", pause_reason: null, acting_user_id: caller.userId },
    "paused",
  );
  if (ok) await log(caller, "program_resumed", "Autopilot resumed.", { programId: program.id });
}

export async function stopProgram(caller: Caller): Promise<void> {
  const program = await store.liveProgram(caller.workspaceId);
  if (!program) throw new HttpError(404, "Autopilot isn't set up yet.");
  const stopped = await store.updateProgram(program.id, {
    status: "stopped",
    finished_at: new Date().toISOString(),
  });
  if (!stopped) return;
  const open = await store.listActions(caller.workspaceId, {
    statuses: [...CANCELLABLE_STATUSES],
    limit: 300,
  });
  let cancelled = 0;
  for (const action of open) {
    if (action.program_id !== program.id) continue;
    if (await store.transition(action, "cancelled", { finished_at: new Date().toISOString() }))
      cancelled++;
  }
  await log(
    caller,
    "program_stopped",
    "Autopilot stopped. Drafts stay in your content; posts already scheduled will still go out.",
    { programId: program.id, data: { cancelled } },
  );
}

/** Assist mode: say yes to the plan, so the pieces in it get made. */
export async function approvePlan(caller: Caller): Promise<{ approved: number }> {
  const program = await store.liveProgram(caller.workspaceId);
  if (!program) throw new HttpError(404, "Autopilot isn't set up yet.");
  await requireBillingFeature({ ...caller, feature: "autopilot", spending: true });
  const proposed = await store.listActions(caller.workspaceId, {
    statuses: ["proposed"],
    limit: 100,
  });
  let approved = 0;
  for (const action of proposed) {
    if (await store.transition(action, "planned")) approved++;
  }
  if (approved) {
    await log(
      caller,
      "plan_approved",
      `Plan approved: ${approved} ${approved === 1 ? "piece" : "pieces"}.`,
      {
        programId: program.id,
        data: { approved },
      },
    );
  }
  return { approved };
}

/* ───────────────────────── actions ───────────────────────── */

async function loadAction(workspaceId: string, id: string): Promise<ActionRow> {
  const action = await store.getAction(workspaceId, id);
  if (!action || action.kind !== "content") throw new HttpError(404, "That piece wasn't found.");
  return action;
}

export async function decideAction(
  caller: Caller,
  actionId: string,
  decision: "approve" | "skip",
): Promise<void> {
  const action = await loadAction(caller.workspaceId, actionId);
  const now = new Date().toISOString();

  if (decision === "skip") {
    if (action.status === "needs_approval") {
      for (const id of action.content_item_ids) await rejectContent(caller.workspaceId, id);
      if (!(await store.transition(action, "rejected", { finished_at: now }))) {
        throw new HttpError(409, "That piece just changed. Refresh and try again.");
      }
    } else if (action.status === "proposed" || action.status === "planned") {
      if (!(await store.transition(action, "cancelled", { finished_at: now }))) {
        throw new HttpError(409, "That piece just changed. Refresh and try again.");
      }
    } else {
      throw new HttpError(409, "That piece can't be skipped any more.");
    }
    await log(caller, "piece_skipped", `Skipped the ${describePiece(action)}: ${action.title}`, {
      programId: action.program_id,
      actionId: action.id,
    });
    return;
  }

  if (action.status !== "needs_approval") {
    throw new HttpError(409, "That piece isn't waiting for approval.");
  }
  const items = await loadContent(caller.workspaceId, action.content_item_ids);
  if (!items.length) throw new HttpError(404, "The draft for this piece was deleted.");
  for (const item of items) {
    if (item.status === "pending" || item.status === "draft") {
      await approveContent(caller.workspaceId, item.id, ["pending", "draft"]);
    }
  }
  // The content item is the approval; the action only records who said yes.
  const moved = await store.transition(action, "approved", {
    approved_by: caller.userId,
    approved_via: "user",
    next_attempt_at: now,
  });
  if (!moved) throw new HttpError(409, "That piece just changed. Refresh and try again.");
  await log(caller, "piece_approved", `Approved: ${action.title}`, {
    programId: action.program_id,
    actionId: action.id,
    data: { content_item_ids: action.content_item_ids },
  });
  kick(action.id);
}

export async function retryAction(caller: Caller, actionId: string): Promise<void> {
  const action = await loadAction(caller.workspaceId, actionId);
  if (action.status !== "failed") throw new HttpError(409, "There's nothing to retry here.");
  await requireBillingFeature({ ...caller, feature: "autopilot", spending: true });
  const now = new Date().toISOString();
  const items = await loadContent(caller.workspaceId, action.content_item_ids);

  if (items.some((i) => i.status === "failed" || i.status === "partial_failed")) {
    throw new HttpError(
      409,
      "The post itself failed to send. Open it in your content to send it again.",
    );
  }
  const readyToSchedule = items.length > 0 && items.every((i) => i.status === "approved");
  const moved = readyToSchedule
    ? await store.transition(action, "approved", {
        next_attempt_at: now,
        last_error: null,
        attempts: 0,
      })
    : await store.transition(action, "planned", {
        next_attempt_at: now,
        last_error: null,
        attempts: 0,
        studio_job_id: null,
        content_item_ids: [],
        generation_attempt: action.generation_attempt + 1,
      });
  if (!moved) throw new HttpError(409, "That piece just changed. Refresh and try again.");
  await log(caller, "piece_retried", `Trying again: ${action.title}`, {
    programId: action.program_id,
    actionId: action.id,
  });
  kick(action.id);
}

/* ───────────────────────── opportunities ───────────────────────── */

export async function decideOpportunity(
  caller: Caller,
  args: {
    id: string;
    decision: "create" | "dismiss";
    format?: OpportunityFormat;
    platform?: PlatformId;
  },
): Promise<{ created: number }> {
  const opportunity = await store.getOpportunity(caller.workspaceId, args.id);
  if (!opportunity) throw new HttpError(404, "That opportunity wasn't found.");
  const now = new Date();

  if (args.decision === "dismiss") {
    const ok = await store.updateOpportunity(
      opportunity.id,
      { status: "dismissed", decided_by: caller.userId, decided_at: now.toISOString() },
      "new",
    );
    if (ok) {
      await log(caller, "opportunity_dismissed", `Dismissed: ${opportunity.title}`, {
        opportunityId: opportunity.id,
      });
    }
    return { created: 0 };
  }

  if (opportunity.status !== "new")
    throw new HttpError(409, "This opportunity was already handled.");
  if (Date.parse(opportunity.expires_at) <= now.getTime()) {
    throw new HttpError(409, "This opportunity is too old to act on.");
  }
  await requireBillingFeature({ ...caller, feature: "autopilot", spending: true });
  const program = await store.liveProgram(caller.workspaceId);
  const format =
    args.format ??
    ((OPPORTUNITY_FORMATS as readonly string[]).includes(opportunity.suggested_type)
      ? (opportunity.suggested_type as OpportunityFormat)
      : "social");
  const made = await actionsFromOpportunity(store, {
    opportunity,
    program: program?.status === "running" ? program : null,
    format,
    platforms: args.platform ? [args.platform] : [],
    requestedBy: caller.userId,
    now,
    cycle:
      program?.status === "running"
        ? Math.max(1, weekOf(program, ymdInZone(now, program.timezone)))
        : 0,
  });
  await store.updateOpportunity(
    opportunity.id,
    { status: "accepted", decided_by: caller.userId, decided_at: now.toISOString() },
    "new",
  );
  if (made.length) {
    await log(
      caller,
      "opportunity_accepted",
      `Making ${made.length === 1 ? `a ${describePiece(made[0])}` : `${made.length} pieces`} for: ${opportunity.title}`,
      {
        opportunityId: opportunity.id,
        actionId: made[0].id,
        data: { format, pieces: made.length },
      },
    );
    kick(made[0].id);
  }
  return { created: made.length };
}

/* ───────────────────────── agency ───────────────────────── */

type OverviewRow = {
  workspace_id: string;
  program_id: string | null;
  status: string | null;
  pause_reason: string | null;
  mode: string | null;
  ends_on: string | null;
  needs_approval: number | string;
  plan_waiting: number | string;
  new_opportunities: number | string;
  failures: number | string;
  missed: number | string;
  performance_warnings: number | string;
  next_action_at: string | null;
  next_action_title: string | null;
};

/**
 * One row per workspace the caller belongs to. The RPC runs with the caller's
 * own rights, so it cannot describe a workspace they are not a member of.
 * Workspaces with Autopilot switched off are left out.
 */
export async function getAgencyAutopilot(userClient: {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}): Promise<AgencyAutopilotRow[]> {
  const { data, error } = await userClient.rpc("autopilot_overview");
  if (error) throw new Error(error.message);
  return ((data ?? []) as OverviewRow[])
    .filter((row) => isAutopilotEnabled(row.workspace_id))
    .map((row) => ({
      workspaceId: row.workspace_id,
      programId: row.program_id,
      status: row.status as AgencyAutopilotRow["status"],
      pauseReason: row.pause_reason,
      mode: row.mode as AgencyAutopilotRow["mode"],
      endsOn: row.ends_on,
      needsApproval: Number(row.needs_approval ?? 0),
      planWaiting: Number(row.plan_waiting ?? 0),
      newOpportunities: Number(row.new_opportunities ?? 0),
      failures: Number(row.failures ?? 0),
      missed: Number(row.missed ?? 0),
      performanceWarnings: Number(row.performance_warnings ?? 0),
      nextActionAt: row.next_action_at,
      nextActionTitle: row.next_action_title,
    }));
}
