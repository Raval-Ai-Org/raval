// service.server.ts — what a person can do with their audience, and the cron
// entry. Every function here is called after the workspace and role were
// verified by the RPC layer.
//
// Nothing in this file writes to content_items: a score is about a piece, it
// never changes it, so checking a piece can never un-approve it.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isActiveRun,
  MAX_TWINS,
  OVERALL_SLUG,
  type AccuracyView,
  type AudienceView,
  type PredictionRow,
  type PredictionView,
  type RunKind,
  type RunRow,
  type RunView,
  type ScoreMap,
  type Subject,
  type TournamentOutput,
  type TwinInput,
  type VariantDraft,
} from "@/lib/audience/contracts";
import { subjectHash } from "@/lib/audience/score";
import { AUTO_SCORE_TYPES, subjectFromContent, type ContentLike } from "@/lib/audience/subject";
import {
  applyUserTraits,
  panelTwins,
  presentTwin,
  slugify,
  twinsFingerprint,
} from "@/lib/audience/twins";
import type { CreditAction } from "@/lib/billing/catalog";
import { isAudienceAutoScoreEnabled, isAudienceEnabled } from "@/lib/feature-flags";
import { recordAudit } from "@/server/audit.server";
import { roleAtLeast, type WorkspaceRole } from "@/server/api-auth";
import { beginAsyncCharge, settleAsyncChargeSoon } from "@/server/billing/async-charges.server";
import { requireBillingFeature } from "@/server/billing/feature.server";
import { HttpError } from "@/server/http-error";
import { consumeRateLimit } from "@/server/rate-limit";
import { invalidateAudienceContext } from "./context.server";
import { runSweep, saveTwinDrafts, scoreSubjects, SCORE_BATCH, type SweepResult } from "./engine";
import { realPorts } from "./simulate.server";
import { supabaseAudienceStore as store } from "./store.server";
import { seedDrafts } from "./twins.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const WORKER = `audience-${process.pid}-${randomUUID().slice(0, 8)}`;

export type Caller = { workspaceId: string; userId: string; role: WorkspaceRole };

/** Formats where "Use this version" can drop text straight into the editor. */
const COMPARE_TYPES: readonly string[] = ["social", "image", "video"];

/** Off means "doesn't exist": 404, exactly like an unknown route. */
export function assertAudienceEnabled(workspaceId: string): void {
  if (!isAudienceEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

/* ───────────────────────── cron + kick ───────────────────────── */

/** Cron entry, called from the run-schedules hook. Audience adds no cron job. */
export function runDueAudience(
  opts: { budgetMs?: number; max?: number } = {},
): Promise<SweepResult> {
  return runSweep(store, realPorts, { worker: WORKER, ...opts });
}

/** Continue one run after the response is sent, so a click feels instant. */
function kick(runId: string): void {
  after(async () => {
    try {
      await runSweep(store, realPorts, {
        worker: WORKER,
        onlyId: runId,
        budgetMs: 100_000,
        max: 1,
      });
    } catch (error) {
      console.error(`[audience] background step for ${runId} failed`, error);
    }
  });
}

/* ───────────────────────── present ───────────────────────── */

export function presentPrediction(row: PredictionRow): PredictionView {
  const result = row.result ?? ({} as PredictionRow["result"]);
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    depth: row.depth,
    title: row.subject?.title || row.subject?.body?.split("\n")[0]?.slice(0, 80) || "Untitled",
    platform: row.platform,
    overall: row.overall,
    dimensions: row.dimensions,
    why: result.why ?? "",
    fixes: result.fixes ?? [],
    notes: result.notes ?? [],
    confidence: result.confidence ?? "low",
    measuredPosts: result.measuredPosts ?? 0,
    calibrated: row.calibrated,
    pulse: result.pulse ?? null,
    createdAt: row.created_at,
  };
}

async function presentRun(run: RunRow): Promise<RunView> {
  const [events, predictions] = await Promise.all([
    store.listEvents(run.workspace_id, run.id, 30),
    run.kind === "pulse" && run.status === "succeeded"
      ? store.listPredictions(run.workspace_id, { runId: run.id, limit: 1 })
      : Promise.resolve([]),
  ]);
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    stage: run.stage,
    progress: run.progress,
    contentItemId: run.content_item_id,
    events: events.map((e) => ({ kind: e.kind, summary: e.summary, at: e.created_at })),
    error: run.status === "failed" ? (run.last_error ?? "This didn't finish.") : null,
    prediction: predictions[0] ? presentPrediction(predictions[0]) : null,
    tournament:
      run.kind === "tournament" && run.status === "succeeded"
        ? (run.output as unknown as TournamentOutput)
        : null,
    createdAt: run.created_at,
  };
}

/* ───────────────────────── content ───────────────────────── */

type ContentRow = ContentLike & { id: string; workspace_id: string };

async function loadContent(workspaceId: string, ids: string[]): Promise<ContentRow[]> {
  if (!ids.length) return [];
  const { data, error } = await db
    .from("content_items")
    .select("id, workspace_id, kind, channel, title, body, meta")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentRow[];
}

async function subjectOf(workspaceId: string, contentItemId: string) {
  const [item] = await loadContent(workspaceId, [contentItemId]);
  if (!item) throw new HttpError(404, "That piece of content was not found.");
  const scored = subjectFromContent(item);
  if (!scored) throw new HttpError(422, "There is nothing to check in this piece yet.");
  return scored;
}

/* ───────────────────────── groups ───────────────────────── */

/**
 * Make sure there is someone to ask. The first time, groups are read straight
 * from Brand DNA (no model call), so a score works with no setup.
 */
async function ensureTwins(workspaceId: string, userId: string | null): Promise<boolean> {
  const held = await store.listTwins(workspaceId, { includeArchived: true });
  if (held.some((t) => t.kind === "group")) return panelTwins(held).length > 0;
  const drafts = await seedDrafts(workspaceId);
  if (!drafts.length) return false;
  await saveTwinDrafts(store, workspaceId, drafts, userId);
  invalidateAudienceContext(workspaceId);
  return true;
}

const NO_AUDIENCE =
  "Tell Mellox who your audience is first. Add it in Brand DNA or on the Audience page.";

async function accuracy(workspaceId: string): Promise<AccuracyView> {
  const [outcomes, cells] = await Promise.all([
    store.listOutcomes(workspaceId, 60),
    store.listCalibration(workspaceId),
  ]);
  const all = cells.find((c) => c.platform === "all" && c.content_type === "all");
  const compared = outcomes.filter((o) => o.actual !== null);
  return {
    measured: outcomes.length,
    compared: compared.length,
    averageGap: all && all.n > 0 ? Math.round(all.mae) : null,
    learned: all?.learned ?? [],
    outcomes: outcomes.slice(0, 12).map((o) => ({
      id: o.id,
      title: o.title || "Untitled",
      platform: o.platform,
      predicted: o.predicted,
      actual: o.actual,
      views: Number(o.metrics?.views ?? 0),
      measuredAt: o.measured_at,
    })),
  };
}

export async function getAudienceView(caller: Caller): Promise<AudienceView> {
  const { workspaceId } = caller;
  const [twins, building, recent, acc, seeds] = await Promise.all([
    store.listTwins(workspaceId),
    store.listRuns(workspaceId, { kind: "twins", limit: 1 }),
    store.listPredictions(workspaceId, { limit: 8 }),
    accuracy(workspaceId),
    seedDrafts(workspaceId).catch(() => []),
  ]);
  const latest = building[0];
  const overall = twins.find((t) => t.kind === "overall");
  return {
    twins: twins.filter((t) => t.kind === "group").map(presentTwin),
    overall: overall?.profile.length ? presentTwin(overall) : null,
    canBuild: seeds.length > 0 || twins.some((t) => t.kind === "group"),
    canEdit: roleAtLeast(caller.role, "editor"),
    // A finished build is only worth showing when it failed.
    building:
      latest && (isActiveRun(latest.status) || latest.status === "failed")
        ? await presentRun(latest)
        : null,
    recent: recent.map(presentPrediction),
    accuracy: acc,
  };
}

/** Build or refresh the groups from Brand DNA and stored research. Included. */
export async function buildAudience(caller: Caller, key: string): Promise<RunView> {
  await requireBillingFeature({ ...caller, feature: "audience", spending: true });
  const active = await store.listRuns(caller.workspaceId, {
    kind: "twins",
    active: true,
    limit: 1,
  });
  if (active[0]) return presentRun(active[0]);
  const { run, created } = await store.insertRun({
    workspace_id: caller.workspaceId,
    kind: "twins",
    idempotency_key: `twins:${key}`,
    created_by: caller.userId,
  });
  if (created) {
    await recordAudit({
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      action: "audience.build",
      entity: `audience_run:${run.id}`,
    });
    kick(run.id);
  }
  return presentRun(run);
}

export async function saveTwin(caller: Caller, id: string | null, input: TwinInput) {
  const { workspaceId, userId } = caller;
  const all = await store.listTwins(workspaceId, { includeArchived: true });
  const held = id ? all.find((t) => t.id === id) : null;
  if (id && (!held || held.kind !== "group" || held.status !== "active")) {
    throw new HttpError(404, "That audience group was not found.");
  }
  if (!held && all.filter((t) => t.kind === "group" && t.status === "active").length >= MAX_TWINS) {
    throw new HttpError(409, `You can have up to ${MAX_TWINS} audience groups.`);
  }
  let slug = held?.slug ?? slugify(input.name);
  if (!held) {
    const taken = new Set(all.map((t) => t.slug));
    for (let n = 2; taken.has(slug) || slug === OVERALL_SLUG; n++) {
      slug = `${slugify(input.name).slice(0, 54)}-${n}`;
    }
  }
  const row = await store.upsertTwin(
    workspaceId,
    {
      slug,
      name: input.name,
      segment: input.segment,
      summary: input.summary,
      weight: input.weight,
      profile: applyUserTraits(held?.profile ?? [], input.traits),
      // Once a person has shaped a group, a rebuild keeps their wording.
      origin: "user",
      origin_ref: held?.origin_ref ?? null,
    },
    userId,
  );
  invalidateAudienceContext(workspaceId);
  await recordAudit({
    workspaceId,
    userId,
    action: held ? "audience.group_updated" : "audience.group_added",
    entity: `audience_twin:${row.id}`,
    payload: { name: row.name },
  });
  return presentTwin(row);
}

export async function archiveTwin(caller: Caller, id: string): Promise<void> {
  if (!(await store.archiveTwin(caller.workspaceId, id, caller.userId))) {
    throw new HttpError(404, "That audience group was not found.");
  }
  invalidateAudienceContext(caller.workspaceId);
  await recordAudit({
    workspaceId: caller.workspaceId,
    userId: caller.userId,
    action: "audience.group_removed",
    entity: `audience_twin:${id}`,
  });
}

/* ───────────────────────── quick score ───────────────────────── */

/** The Mellox Score for one saved piece. Included in the plan. */
export async function predictContent(
  caller: Caller,
  contentItemId: string,
): Promise<PredictionView> {
  await requireBillingFeature({ ...caller, feature: "audience", spending: true });
  const { subject, contentType } = await subjectOf(caller.workspaceId, contentItemId);
  if (!(await ensureTwins(caller.workspaceId, caller.userId)))
    throw new HttpError(422, NO_AUDIENCE);
  const [row] = await scoreSubjects(
    { store, ports: realPorts },
    { workspaceId: caller.workspaceId, userId: caller.userId },
    [{ subject, contentType, contentItemId }],
  );
  if (!row) throw new HttpError(502, "The score didn't come back. Try again.");
  return presentPrediction(row);
}

/**
 * The score that follows a generation by itself. Never throws, never charges,
 * never touches the piece: a failure only means there is no score yet.
 */
export async function autoScore(args: {
  workspaceId: string;
  userId: string | null;
  contentItemIds: string[];
}): Promise<number> {
  const { workspaceId, userId } = args;
  try {
    if (!isAudienceAutoScoreEnabled(workspaceId) || !args.contentItemIds.length) return 0;
    const items = (await loadContent(workspaceId, args.contentItemIds.slice(0, SCORE_BATCH)))
      .map((item) => ({ item, scored: subjectFromContent(item) }))
      .filter(
        (
          row,
        ): row is {
          item: ContentRow;
          scored: NonNullable<ReturnType<typeof subjectFromContent>>;
        } => row.scored !== null && AUTO_SCORE_TYPES.includes(row.scored.contentType),
      );
    if (!items.length) return 0;
    // Its only bound, since nobody is charged for it.
    const limit = await consumeRateLimit("audience-score", `ws:${workspaceId}`);
    if (!limit.ok) return 0;
    if (!(await ensureTwins(workspaceId, userId))) return 0;
    const rows = await scoreSubjects(
      { store, ports: realPorts },
      { workspaceId, userId },
      items.map(({ item, scored }) => ({ ...scored, contentItemId: item.id })),
    );
    return rows.filter(Boolean).length;
  } catch (error) {
    console.error(`[audience] auto score for ${workspaceId} failed`, error);
    return 0;
  }
}

/** The score that still belongs to each piece's current text. */
async function currentPredictions(
  workspaceId: string,
  contentItemIds: string[],
): Promise<Map<string, PredictionRow>> {
  const ids = [...new Set(contentItemIds)].slice(0, 200);
  const out = new Map<string, PredictionRow>();
  if (!ids.length) return out;
  const [items, predictions, twins] = await Promise.all([
    loadContent(workspaceId, ids),
    store.listPredictions(workspaceId, { contentItemIds: ids, limit: 600 }),
    store.listTwins(workspaceId),
  ]);
  if (!predictions.length) return out;
  const fingerprint = twinsFingerprint(twins);
  const hashes = new Map<string, string>();
  for (const item of items) {
    const scored = subjectFromContent(item);
    if (scored) hashes.set(item.id, subjectHash(scored.subject));
  }
  // Newest first; a deeper check of the same text wins over a quick score.
  for (const row of predictions) {
    const id = row.content_item_id!;
    if (hashes.get(id) !== row.subject_hash || row.twins_fingerprint !== fingerprint) continue;
    const held = out.get(id);
    if (!held || (held.depth === "score" && row.depth === "pulse")) out.set(id, row);
  }
  return out;
}

export async function getScores(caller: Caller, contentItemIds: string[]): Promise<ScoreMap> {
  const map: ScoreMap = {};
  for (const [id, row] of await currentPredictions(caller.workspaceId, contentItemIds)) {
    map[id] = { overall: row.overall, depth: row.depth };
  }
  return map;
}

export type ContentAudience = {
  /** NULL when the piece has no score, or was edited since. */
  prediction: PredictionView | null;
  /** A check or comparison in progress, or the latest finished comparison. */
  run: RunView | null;
  canCompare: boolean;
  canCheck: boolean;
};

export async function getContentAudience(
  caller: Caller,
  contentItemId: string,
): Promise<ContentAudience> {
  const { workspaceId } = caller;
  const [items, current, runs] = await Promise.all([
    loadContent(workspaceId, [contentItemId]),
    currentPredictions(workspaceId, [contentItemId]),
    store.listRuns(workspaceId, { contentItemId, limit: 5 }),
  ]);
  const scored = items[0] ? subjectFromContent(items[0]) : null;
  const hash = scored ? subjectHash(scored.subject) : null;
  const active = runs.find((r) => isActiveRun(r.status));
  // A finished comparison is only shown while the piece still reads the same.
  const compared = runs.find(
    (r) =>
      r.kind === "tournament" &&
      r.status === "succeeded" &&
      r.input.subject &&
      subjectHash(r.input.subject) === hash,
  );
  const failed = runs[0]?.status === "failed" ? runs[0] : undefined;
  const run = active ?? compared ?? failed;
  const prediction = current.get(contentItemId);
  return {
    prediction: prediction ? presentPrediction(prediction) : null,
    run: run ? await presentRun(run) : null,
    canCheck: scored !== null,
    canCompare: scored !== null && COMPARE_TYPES.includes(scored.contentType),
  };
}

/* ───────────────────────── charged runs ───────────────────────── */

async function startCharged(
  caller: Caller,
  args: {
    kind: Exclude<RunKind, "twins">;
    action: CreditAction;
    key: string;
    contentItemId: string | null;
    input: RunRow["input"];
  },
): Promise<RunView> {
  const { workspaceId, userId, role } = caller;
  await requireBillingFeature({ workspaceId, userId, role, feature: "audience", spending: true });
  if (!(await ensureTwins(workspaceId, userId))) throw new HttpError(422, NO_AUDIENCE);

  // A second click on the same piece joins the run in progress: no new charge.
  if (args.contentItemId) {
    const active = (
      await store.listRuns(workspaceId, {
        contentItemId: args.contentItemId,
        active: true,
        limit: 5,
      })
    ).find((r) => r.kind === args.kind);
    if (active) return presentRun(active);
  }
  const requestKey = `${args.kind}:${args.key}`;
  const charge = await beginAsyncCharge({
    workspaceId,
    userId,
    role,
    kind: "audience_run",
    action: args.action,
    requestKey,
    route: "audience.run",
  });
  let run: RunRow;
  try {
    const inserted = await store.insertRun({
      workspace_id: workspaceId,
      kind: args.kind,
      idempotency_key: requestKey,
      input: args.input,
      content_item_id: args.contentItemId,
      created_by: userId,
    });
    if (!inserted.created) {
      // The same click arrived twice: one run, one charge.
      await charge.release();
      return presentRun(inserted.run);
    }
    run = inserted.run;
    await charge.link("audience_run", run.id);
  } catch (error) {
    await charge.release().catch(() => undefined);
    throw error;
  }
  kick(run.id);
  return presentRun(run);
}

/** Ask a simulated panel of the audience about one saved piece. */
export async function startPulse(
  caller: Caller,
  contentItemId: string,
  key: string,
): Promise<RunView> {
  const { subject, contentType } = await subjectOf(caller.workspaceId, contentItemId);
  return startCharged(caller, {
    kind: "pulse",
    action: "audience_pulse",
    key,
    contentItemId,
    input: { subject, contentType },
  });
}

/** Write other versions of one saved piece and let the audience rank them. */
export async function startComparison(
  caller: Caller,
  contentItemId: string,
  key: string,
): Promise<RunView> {
  const { subject, contentType } = await subjectOf(caller.workspaceId, contentItemId);
  if (!COMPARE_TYPES.includes(contentType)) {
    throw new HttpError(422, "Comparing versions works for posts with a caption.");
  }
  return startCharged(caller, {
    kind: "tournament",
    action: "audience_tournament",
    key,
    contentItemId,
    input: { subject, contentType },
  });
}

/** Rank versions the caller already has (video concepts, hooks). Nothing is written. */
export async function startRanking(
  caller: Caller,
  args: {
    kind: Subject["kind"];
    platform: string;
    variants: (VariantDraft & { ref: string })[];
    key: string;
  },
): Promise<RunView> {
  const variants = args.variants.filter((v) => v.body.trim().length >= 10).slice(0, 5);
  if (variants.length < 2) throw new HttpError(422, "There need to be at least two to compare.");
  return startCharged(caller, {
    kind: "tournament",
    action: "audience_tournament",
    key: args.key,
    contentItemId: null,
    input: {
      subject: { kind: args.kind, platform: args.platform, title: "", body: variants[0].body },
      contentType: args.kind,
      variants: variants.map(({ label, title, body }) => ({ label, title, body })),
      variantRefs: variants.map((v) => v.ref),
    },
  });
}

export async function getRun(caller: Caller, runId: string): Promise<RunView> {
  const run = await store.getRun(caller.workspaceId, runId);
  if (!run) throw new HttpError(404, "Not found");
  return presentRun(run);
}

export async function cancelRun(caller: Caller, runId: string): Promise<RunView> {
  const held = await store.getRun(caller.workspaceId, runId);
  if (!held) throw new HttpError(404, "Not found");
  // A person stops their own run; an admin can stop anyone's.
  if (held.created_by !== caller.userId && !roleAtLeast(caller.role, "admin")) {
    throw new HttpError(403, "Only the person who started this can stop it.");
  }
  const run = (await store.requestCancel(caller.workspaceId, runId)) ?? held;
  // Cancelled before a worker took it: nobody else will release the hold.
  if (run.status === "cancelled") settleAsyncChargeSoon("audience_run", run.id);
  return presentRun(run);
}

/* ───────────────────────── for other systems ───────────────────────── */

/** Measured audience learnings, for the next Autopilot plan. Empty when off. */
export async function audienceLearnings(workspaceId: string): Promise<string[]> {
  if (!isAudienceEnabled(workspaceId)) return [];
  try {
    const cell = await store.getCalibration(workspaceId, "all", "all");
    return (cell?.learned ?? []).slice(0, 3);
  } catch {
    return [];
  }
}

export async function listRecentPredictions(caller: Caller, limit = 20): Promise<PredictionView[]> {
  return (await store.listPredictions(caller.workspaceId, { limit })).map(presentPrediction);
}
