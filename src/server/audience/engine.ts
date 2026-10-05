// engine.ts — the audience worker and the quick score. Store-agnostic: the
// tests run it against store.memory.ts with fake ports, production against
// Postgres and the model gateway.
//
// A run moves through bounded stages, one per lease. What a stage paid for is
// written to `state` as soon as it arrives, so a retry or a crashed worker
// never asks the model for the same answer twice.
//
// The model proposes; pure code (src/lib/audience) decides every number.
import {
  MAX_TWINS,
  type CalibrationRow,
  type Dimensions,
  type OutcomeRow,
  type PredictionResult,
  type PredictionRow,
  type RunEventRow,
  type RunInput,
  type RunKind,
  type RunRow,
  type Subject,
  type TournamentOutput,
  type Trait,
  type TwinRow,
  type VariantDraft,
} from "@/lib/audience/contracts";
import { applyCalibration, MIN_PAIRS, type Calibration } from "@/lib/audience/calibration";
import {
  aggregatePulse,
  cleanJudgement,
  cleanTwinAnswer,
  panelPlan,
  rankVersions,
  segmentSpread,
  tournamentConfidence,
  type TwinAnswer,
  type TwinJudgement,
  type VersionInput,
} from "@/lib/audience/panel";
import {
  applyCaps,
  checkSubject,
  cleanDimensions,
  confidenceFor,
  overallOf,
  SCORE_VERSION,
  subjectHash,
} from "@/lib/audience/score";
import {
  mergeTraits,
  panelTwins,
  sameTraits,
  twinsFingerprint,
  type TwinDraft,
} from "@/lib/audience/twins";

export const LEASE_SECONDS = 150;
const MAX_ERRORS = 3;
const MIN = 60_000;
/** Paid calls in flight at once inside one run. */
const CONCURRENCY = 3;
/** Versions written for a comparison (plus the original). */
export const WRITTEN_VERSIONS = 3;
export const MAX_VERSIONS = 5;
/** Pieces scored by one quick-score call. */
export const SCORE_BATCH = 6;

/* ───────────────────────── store ───────────────────────── */

export type NewRun = Pick<RunRow, "workspace_id" | "kind" | "idempotency_key"> & {
  input?: RunInput;
  content_item_id?: string | null;
  created_by?: string | null;
};

export type RunPatch = Partial<
  Pick<
    RunRow,
    | "status"
    | "stage"
    | "progress"
    | "state"
    | "output"
    | "attempts"
    | "next_attempt_at"
    | "last_error"
    | "finished_at"
  >
>;

export type NewPrediction = Omit<PredictionRow, "id" | "created_at">;
export type NewOutcome = Omit<OutcomeRow, "id" | "measured_at">;

export interface AudienceStore {
  claim(worker: string, max: number, leaseSeconds: number, id?: string): Promise<RunRow[]>;
  /** Compare-and-set on the lease holder. False when the lease was lost. */
  updateRun(
    run: RunRow,
    worker: string,
    patch: RunPatch,
    opts?: { keepLease?: boolean },
  ): Promise<boolean>;
  /** Insert, or return the run that already has this key. */
  insertRun(row: NewRun): Promise<{ run: RunRow; created: boolean }>;
  getRun(workspaceId: string, id: string): Promise<RunRow | null>;
  listRuns(
    workspaceId: string,
    opts?: { kind?: RunKind; active?: boolean; contentItemId?: string; limit?: number },
  ): Promise<RunRow[]>;
  /** Ask an active run to stop. A queued run is cancelled at once. */
  requestCancel(workspaceId: string, id: string): Promise<RunRow | null>;

  addEvent(
    event: Pick<RunEventRow, "workspace_id" | "run_id" | "kind" | "summary"> & {
      data?: Record<string, unknown>;
    },
  ): Promise<void>;
  listEvents(workspaceId: string, runId: string, limit?: number): Promise<RunEventRow[]>;

  listTwins(workspaceId: string, opts?: { includeArchived?: boolean }): Promise<TwinRow[]>;
  getTwin(workspaceId: string, id: string): Promise<TwinRow | null>;
  /** Insert or update by (workspace, slug); an update bumps `version`. */
  upsertTwin(
    workspaceId: string,
    draft: TwinDraft & { kind?: TwinRow["kind"] },
    userId: string | null,
  ): Promise<TwinRow>;
  archiveTwin(workspaceId: string, id: string, userId: string): Promise<boolean>;

  findPrediction(
    workspaceId: string,
    key: { subjectHash: string; fingerprint: string; depth: "score" | "pulse" },
  ): Promise<PredictionRow | null>;
  /** Upsert on the cache key. */
  savePrediction(row: NewPrediction): Promise<PredictionRow>;
  getPrediction(workspaceId: string, id: string): Promise<PredictionRow | null>;
  listPredictions(
    workspaceId: string,
    opts?: { contentItemIds?: string[]; runId?: string; limit?: number },
  ): Promise<PredictionRow[]>;

  getCalibration(
    workspaceId: string,
    platform: string,
    contentType: string,
  ): Promise<CalibrationRow | null>;
  listCalibration(workspaceId: string): Promise<CalibrationRow[]>;
  saveCalibration(row: Omit<CalibrationRow, "updated_at">): Promise<void>;
  /** Insert once per (prediction, horizon); false when it already exists. */
  insertOutcome(row: NewOutcome): Promise<boolean>;
  listOutcomes(workspaceId: string, limit?: number): Promise<OutcomeRow[]>;
  setOutcomeActual(workspaceId: string, id: string, actual: number): Promise<void>;
}

/* ───────────────────────── ports ───────────────────────── */

export type Actor = { workspaceId: string; userId: string | null };

export type ScorePiece = { index: number; subject: Subject };

export interface AudiencePorts {
  now(): Date;
  /** The feature flag for one workspace. */
  enabled(workspaceId: string): boolean;
  /** Groups proposed from stored brand, market and competitor data. */
  buildTwins(actor: Actor, existing: TwinRow[]): Promise<TwinDraft[]>;
  /** One call: raw `{pieces: [{index, dimensions, why, fixes}]}`. */
  score(actor: Actor, twins: TwinRow[], pieces: ScorePiece[]): Promise<unknown>;
  /** One call for one group: raw reaction JSON. */
  react(actor: Actor, twin: TwinRow, subject: Subject, people: number): Promise<unknown>;
  synthesize(
    actor: Actor,
    args: {
      subject: Subject;
      overall: number;
      dimensions: Dimensions;
      answers: TwinAnswer[];
    },
  ): Promise<{ why: string; fixes: string[] }>;
  writeVariants(
    actor: Actor,
    twins: TwinRow[],
    subject: Subject,
    count: number,
  ): Promise<VariantDraft[]>;
  /** One call for one group: raw judgement JSON over every version. */
  judge(
    actor: Actor,
    twin: TwinRow,
    versions: VersionInput[],
    people: number,
    subject: Subject,
  ): Promise<unknown>;
  /** A run reached its end: settle its charge, drop cached context. */
  finished(run: RunRow): void;
  /** The audience changed: generators must not read a stale block. */
  changed(workspaceId: string): void;
}

export type Ctx = { store: AudienceStore; ports: AudiencePorts; worker: string };

/* ───────────────────────── helpers ───────────────────────── */

const inMs = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 480) || "Unknown error";
}

function lines(value: unknown, max: number, each = 220): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, each))
    .filter(Boolean)
    .slice(0, max);
}

const sentence = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(runners);
}

/** Thrown inside a stage when the worker no longer owns the run. */
class LeaseLost extends Error {}
/** Thrown inside a stage for a problem a retry cannot fix. */
class Fatal extends Error {}

async function mustUpdate(
  ctx: Ctx,
  run: RunRow,
  patch: RunPatch,
  opts?: { keepLease?: boolean },
): Promise<void> {
  if (!(await ctx.store.updateRun(run, ctx.worker, patch, opts))) throw new LeaseLost();
  Object.assign(run, patch);
}

async function cancelled(ctx: Ctx, run: RunRow): Promise<boolean> {
  const latest = await ctx.store.getRun(run.workspace_id, run.id);
  return !latest || latest.cancel_requested || latest.status === "cancelled";
}

async function finish(
  ctx: Ctx,
  run: RunRow,
  status: "succeeded" | "failed" | "cancelled",
  patch: RunPatch = {},
): Promise<void> {
  const done = await ctx.store.updateRun(run, ctx.worker, {
    ...patch,
    status,
    stage: status === "succeeded" ? "done" : status,
    finished_at: ctx.ports.now().toISOString(),
  });
  if (!done) return;
  Object.assign(run, patch, { status });
  ctx.ports.finished(run);
}

async function fail(ctx: Ctx, run: RunRow, reason: string): Promise<void> {
  await finish(ctx, run, "failed", { last_error: reason.slice(0, 480) });
  await ctx.store.addEvent({
    workspace_id: run.workspace_id,
    run_id: run.id,
    kind: "run_failed",
    summary: reason.slice(0, 280),
  });
}

const actorOf = (run: RunRow): Actor => ({ workspaceId: run.workspace_id, userId: run.created_by });

/* ───────────────────────── groups ───────────────────────── */

/**
 * Bring proposed groups into the stored ones. A group a person wrote keeps
 * its name, summary and share; only its traits gain what is new. New groups
 * are added until the limit.
 */
export async function saveTwinDrafts(
  store: AudienceStore,
  workspaceId: string,
  drafts: TwinDraft[],
  userId: string | null,
): Promise<{ saved: TwinRow[]; added: number; updated: number }> {
  const existing = await store.listTwins(workspaceId, { includeArchived: true });
  const bySlug = new Map(existing.map((t) => [t.slug, t]));
  const byRef = new Map(existing.filter((t) => t.origin_ref).map((t) => [t.origin_ref!, t]));
  let groups = existing.filter((t) => t.kind === "group" && t.status === "active").length;
  const saved: TwinRow[] = [];
  let added = 0;
  let updated = 0;
  for (const draft of drafts) {
    const held = (draft.origin_ref && byRef.get(draft.origin_ref)) || bySlug.get(draft.slug);
    if (held) {
      // Archived on purpose: a rebuild does not bring it back.
      if (held.status === "archived" || held.kind !== "group") continue;
      const profile = mergeTraits(held.profile, draft.profile);
      const mine = held.origin === "user";
      const next: TwinDraft = {
        slug: held.slug,
        name: mine ? held.name : draft.name,
        segment: mine ? held.segment : draft.segment || held.segment,
        summary: mine ? held.summary : draft.summary || held.summary,
        weight: mine ? held.weight : draft.weight,
        profile,
        origin: held.origin,
        origin_ref: held.origin_ref ?? draft.origin_ref,
      };
      const same =
        next.name === held.name &&
        next.segment === held.segment &&
        next.summary === held.summary &&
        next.weight === held.weight &&
        sameTraits(profile, held.profile);
      if (same) {
        saved.push(held);
        continue;
      }
      saved.push(await store.upsertTwin(workspaceId, next, userId));
      updated++;
    } else if (groups < MAX_TWINS) {
      saved.push(await store.upsertTwin(workspaceId, draft, userId));
      groups++;
      added++;
    }
  }
  return { saved, added, updated };
}

async function runTwins(ctx: Ctx, run: RunRow): Promise<void> {
  const { store, ports } = ctx;
  await mustUpdate(
    ctx,
    run,
    { status: "running", stage: "reading", progress: { done: 0, total: 1 } },
    { keepLease: true },
  );
  const existing = await store.listTwins(run.workspace_id);
  const drafts = await ports.buildTwins(actorOf(run), existing);
  if (await cancelled(ctx, run)) return finish(ctx, run, "cancelled");
  if (!drafts.length)
    throw new Fatal("There isn't enough in Brand DNA to describe your audience yet.");
  const result = await saveTwinDrafts(store, run.workspace_id, drafts, run.created_by);
  ports.changed(run.workspace_id);
  await store.addEvent({
    workspace_id: run.workspace_id,
    run_id: run.id,
    kind: "groups_saved",
    summary: `${result.saved.length} audience ${result.saved.length === 1 ? "group is" : "groups are"} ready.`,
    data: { added: result.added, updated: result.updated },
  });
  await finish(ctx, run, "succeeded", {
    progress: { done: 1, total: 1 },
    output: { groups: result.saved.length, added: result.added, updated: result.updated },
  });
}

/* ───────────────────────── scoring one result ───────────────────────── */

async function calibrationFor(
  store: AudienceStore,
  workspaceId: string,
  platform: string,
  contentType: string,
): Promise<Pick<Calibration, "n" | "bias"> | null> {
  // The exact platform and format when it has enough posts behind it,
  // otherwise everything this workspace has measured.
  const exact =
    platform && contentType ? await store.getCalibration(workspaceId, platform, contentType) : null;
  const row =
    exact && exact.n >= MIN_PAIRS ? exact : await store.getCalibration(workspaceId, "all", "all");
  return row ? { n: row.n, bias: Number(row.bias) } : null;
}

function allTraits(twins: TwinRow[]): Trait[] {
  return twins.flatMap((t) => t.profile);
}

/* ───────────────────────── quick score ───────────────────────── */

export type ScoreItem = { subject: Subject; contentType: string; contentItemId: string | null };

/**
 * The Mellox Score for up to SCORE_BATCH pieces: free checks plus one cheap
 * model call for everything not already scored. The same text with the same
 * audience is answered from the stored result. Returns one row per item, or
 * null where the model gave nothing usable.
 */
export async function scoreSubjects(
  ctx: Pick<Ctx, "store" | "ports">,
  actor: Actor,
  items: ScoreItem[],
): Promise<(PredictionRow | null)[]> {
  const { store, ports } = ctx;
  const all = await store.listTwins(actor.workspaceId);
  const twins = panelTwins(all);
  if (!twins.length) return items.map(() => null);
  const fingerprint = twinsFingerprint(all);
  const out: (PredictionRow | null)[] = items.map(() => null);
  const todo: { at: number; item: ScoreItem; hash: string }[] = [];

  for (const [at, item] of items.slice(0, SCORE_BATCH).entries()) {
    const hash = subjectHash(item.subject);
    // A deeper check of the same text is the better answer.
    const held =
      (await store.findPrediction(actor.workspaceId, {
        subjectHash: hash,
        fingerprint,
        depth: "pulse",
      })) ??
      (await store.findPrediction(actor.workspaceId, {
        subjectHash: hash,
        fingerprint,
        depth: "score",
      }));
    if (held) {
      out[at] =
        item.contentItemId && held.content_item_id !== item.contentItemId
          ? await store.savePrediction({ ...stripRow(held), content_item_id: item.contentItemId })
          : held;
    } else {
      todo.push({ at, item, hash });
    }
  }
  if (!todo.length) return out;

  const raw = await ports.score(
    actor,
    [...twins, ...all.filter((t) => t.kind === "overall")],
    todo.map((t, index) => ({ index, subject: t.item.subject })),
  );
  const pieces = raw && typeof raw === "object" ? (raw as { pieces?: unknown }).pieces : null;
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const p = piece && typeof piece === "object" ? (piece as Record<string, unknown>) : {};
    if (typeof p.index === "number" && !byIndex.has(p.index)) byIndex.set(p.index, p);
  }

  for (const [index, entry] of todo.entries()) {
    const piece = byIndex.get(index);
    if (!piece || !piece.dimensions || typeof piece.dimensions !== "object") continue;
    const { subject, contentType, contentItemId } = entry.item;
    const checks = checkSubject(subject);
    const dimensions = applyCaps(cleanDimensions(piece.dimensions), checks.caps);
    const raw = overallOf(dimensions);
    const adjusted = applyCalibration(
      raw,
      await calibrationFor(store, actor.workspaceId, subject.platform, contentType),
    );
    const result: PredictionResult = {
      why: sentence(piece.why, 320),
      fixes: lines(piece.fixes, 3),
      notes: checks.notes,
      confidence: confidenceFor({
        depth: "score",
        traits: allTraits(twins),
        measuredPosts: adjusted.measuredPosts,
      }),
      measuredPosts: adjusted.measuredPosts,
      raw,
    };
    out[entry.at] = await store.savePrediction({
      workspace_id: actor.workspaceId,
      content_item_id: contentItemId,
      run_id: null,
      variant_index: null,
      subject,
      subject_hash: entry.hash,
      twins_fingerprint: fingerprint,
      depth: "score",
      platform: subject.platform,
      content_type: contentType,
      overall: adjusted.overall,
      dimensions,
      result,
      score_version: SCORE_VERSION,
      calibrated: adjusted.calibrated,
      created_by: actor.userId,
    });
  }
  return out;
}

function stripRow(row: PredictionRow): NewPrediction {
  const { id: _id, created_at: _at, ...rest } = row;
  return rest;
}

/* ───────────────────────── deeper check ───────────────────────── */

type PulseState = { answers?: Record<string, TwinAnswer>; missed?: string[] };

async function runPulse(ctx: Ctx, run: RunRow): Promise<void> {
  const { store, ports } = ctx;
  const subject = run.input.subject;
  if (!subject?.body) throw new Fatal("There is nothing to check.");
  const all = await store.listTwins(run.workspace_id);
  const twins = panelTwins(all);
  if (!twins.length) throw new Fatal("Set up your audience first.");
  const seats = new Map(panelPlan(twins).map((s) => [s.twinId, s.people]));
  const state = (run.state ?? {}) as PulseState;
  const answers: Record<string, TwinAnswer> = { ...(state.answers ?? {}) };
  const missed = new Set(state.missed ?? []);
  const checks = checkSubject(subject);
  const total = twins.length + 1;

  if (run.stage !== "summarizing") {
    await mustUpdate(
      ctx,
      run,
      {
        status: "running",
        stage: "asking",
        progress: { done: Object.keys(answers).length, total },
      },
      { keepLease: true },
    );
    const waiting = twins.filter((t) => !answers[t.id] && !missed.has(t.id));
    let stop = false;
    await pool(waiting, CONCURRENCY, async (twin) => {
      if (stop || (await cancelled(ctx, run))) {
        stop = true;
        return;
      }
      const people = seats.get(twin.id) ?? 4;
      const raw = await ports.react(actorOf(run), twin, subject, people);
      const answer = cleanTwinAnswer(raw, twin, people);
      if (answer) {
        answer.dimensions = applyCaps(answer.dimensions, checks.caps);
        answers[twin.id] = answer;
      } else {
        missed.add(twin.id);
      }
      // Saved at once: a retry never pays for this group again.
      await mustUpdate(
        ctx,
        run,
        {
          state: { answers: { ...answers }, missed: [...missed] },
          progress: { done: Object.keys(answers).length + missed.size, total },
        },
        { keepLease: true },
      );
      if (answer) {
        await store.addEvent({
          workspace_id: run.workspace_id,
          run_id: run.id,
          kind: "group_answered",
          summary: `${twin.name} answered (${answer.people.length} simulated ${answer.people.length === 1 ? "person" : "people"}).`,
          data: { twinId: twin.id },
        });
      }
    });
    if (stop || (await cancelled(ctx, run))) return finish(ctx, run, "cancelled");
    // Most of the audience must have answered, or the result would mislead.
    if (Object.keys(answers).length * 2 < twins.length) {
      throw new Fatal("Too few audience groups answered. Nothing was charged.");
    }
    // The next stage gets its own lease. The answers are written once more in
    // full: the per-answer saves above can land out of order.
    await mustUpdate(ctx, run, {
      stage: "summarizing",
      state: { answers: { ...answers }, missed: [...missed] },
      next_attempt_at: ports.now().toISOString(),
    });
    return;
  }

  const ordered = twins.map((t) => answers[t.id]).filter(Boolean);
  const aggregate = aggregatePulse(ordered);
  if (!aggregate) throw new Fatal("Too few audience groups answered. Nothing was charged.");
  await mustUpdate(ctx, run, { status: "running" }, { keepLease: true });

  let words = { why: "", fixes: [] as string[] };
  try {
    words = await ports.synthesize(actorOf(run), {
      subject,
      overall: aggregate.overall,
      dimensions: aggregate.dimensions,
      answers: ordered,
    });
  } catch (error) {
    // The reactions are real and paid for; a missing summary must not lose them.
    console.error(`[audience] summary for ${run.id} failed`, message(error));
  }
  if (await cancelled(ctx, run)) return finish(ctx, run, "cancelled");

  const contentType = run.input.contentType ?? "";
  const adjusted = applyCalibration(
    aggregate.overall,
    await calibrationFor(store, run.workspace_id, subject.platform, contentType),
  );
  const spread = segmentSpread(aggregate.pulse.segments);
  const result: PredictionResult = {
    why:
      sentence(words.why, 480) ||
      (spread >= 25
        ? "Your audience groups react differently to this one."
        : (aggregate.pulse.objections[0] ?? aggregate.pulse.strengths[0] ?? "")),
    fixes: lines(words.fixes, 3),
    notes: checks.notes,
    confidence: confidenceFor({
      depth: "pulse",
      traits: allTraits(twins),
      measuredPosts: adjusted.measuredPosts,
    }),
    measuredPosts: adjusted.measuredPosts,
    raw: aggregate.overall,
    pulse: aggregate.pulse,
  };
  const prediction = await store.savePrediction({
    workspace_id: run.workspace_id,
    content_item_id: run.content_item_id,
    run_id: run.id,
    variant_index: null,
    subject,
    subject_hash: subjectHash(subject),
    twins_fingerprint: twinsFingerprint(all),
    depth: "pulse",
    platform: subject.platform,
    content_type: contentType,
    overall: adjusted.overall,
    dimensions: aggregate.dimensions,
    result,
    score_version: SCORE_VERSION,
    calibrated: adjusted.calibrated,
    created_by: run.created_by,
  });
  await store.addEvent({
    workspace_id: run.workspace_id,
    run_id: run.id,
    kind: "result_ready",
    summary: `Score ${prediction.overall} from ${aggregate.pulse.people} simulated people.`,
  });
  await finish(ctx, run, "succeeded", {
    progress: { done: total, total },
    output: { predictionId: prediction.id, overall: prediction.overall },
  });
}

/* ───────────────────────── comparing versions ───────────────────────── */

type TournamentState = {
  versions?: VersionInput[];
  judgements?: Record<string, TwinJudgement>;
  missed?: string[];
};

function suppliedVersions(input: RunInput): VersionInput[] {
  const refs = input.variantRefs ?? [];
  return (input.variants ?? [])
    .map((v, i) => ({
      ref: refs[i] ?? null,
      label: sentence(v.label, 60) || `Version ${i + 1}`,
      title: sentence(v.title, 200),
      body: typeof v.body === "string" ? v.body.trim().slice(0, 6000) : "",
      isOriginal: false,
    }))
    .filter((v) => v.body)
    .slice(0, MAX_VERSIONS);
}

function comparisonSummary(
  output: Pick<TournamentOutput, "variants" | "winnerIndex" | "tooClose">,
): string {
  const winner = output.variants.find((v) => v.index === output.winnerIndex);
  if (!winner) return "";
  if (output.tooClose) {
    const second = output.variants.find((v) => v.rank === 2);
    return `"${winner.label}" and "${second?.label ?? "the next one"}" are too close to call. Pick the one that sounds most like you.`;
  }
  const lead = winner.isOriginal
    ? "Your original is the strongest"
    : `"${winner.label}" is the strongest`;
  return winner.why ? `${lead}. ${winner.why}` : `${lead}.`;
}

async function runTournament(ctx: Ctx, run: RunRow): Promise<void> {
  const { store, ports } = ctx;
  const all = await store.listTwins(run.workspace_id);
  const twins = panelTwins(all);
  if (!twins.length) throw new Fatal("Set up your audience first.");
  const state = (run.state ?? {}) as TournamentState;
  const subject = run.input.subject;
  let versions = state.versions ?? [];

  if (!versions.length) {
    const supplied = suppliedVersions(run.input);
    if (supplied.length >= 2) {
      versions = supplied;
    } else {
      if (!subject?.body) throw new Fatal("There is nothing to compare.");
      await mustUpdate(
        ctx,
        run,
        { status: "running", stage: "writing", progress: { done: 0, total: twins.length + 1 } },
        { keepLease: true },
      );
      const written = (await ports.writeVariants(actorOf(run), twins, subject, WRITTEN_VERSIONS))
        .map((v) => ({
          ref: null,
          label: sentence(v.label, 60),
          title: subject.title,
          body: typeof v.body === "string" ? v.body.trim().slice(0, 6000) : "",
          isOriginal: false,
        }))
        .filter((v) => v.label && v.body.length >= 20)
        .slice(0, MAX_VERSIONS - 1);
      if (!written.length)
        throw new Fatal("No other versions could be written. Nothing was charged.");
      versions = [
        {
          ref: null,
          label: "Your original",
          title: subject.title,
          body: subject.body,
          isOriginal: true,
        },
        ...written,
      ];
    }
    if (await cancelled(ctx, run)) return finish(ctx, run, "cancelled");
    await store.addEvent({
      workspace_id: run.workspace_id,
      run_id: run.id,
      kind: "versions_ready",
      summary: `${versions.length} versions are ready to compare.`,
    });
    // Judging gets its own lease; the written versions are kept.
    await mustUpdate(ctx, run, {
      status: "running",
      stage: "judging",
      state: { versions },
      progress: { done: 1, total: twins.length + 1 },
      next_attempt_at: ports.now().toISOString(),
    });
    return;
  }

  const total = twins.length + 1;
  const judgements: Record<string, TwinJudgement> = { ...(state.judgements ?? {}) };
  const missed = new Set(state.missed ?? []);
  const seats = new Map(panelPlan(twins).map((s) => [s.twinId, s.people]));
  const kind = subject?.kind ?? "concept";
  const platform = subject?.platform ?? "";
  const caps = versions.map(
    (v) => checkSubject({ kind, platform, title: v.title, body: v.body }).caps,
  );
  await mustUpdate(ctx, run, { status: "running", stage: "judging" }, { keepLease: true });

  const waiting = twins.filter((t) => !judgements[t.id] && !missed.has(t.id));
  let stop = false;
  await pool(waiting, CONCURRENCY, async (twin) => {
    if (stop || (await cancelled(ctx, run))) {
      stop = true;
      return;
    }
    const people = seats.get(twin.id) ?? 4;
    const raw = await ports.judge(
      actorOf(run),
      twin,
      versions,
      people,
      subject ?? { kind, platform, title: "", body: versions[0].body },
    );
    const judgement = cleanJudgement(raw, twin, versions.length, people);
    if (judgement) {
      judgement.scores = judgement.scores.map((d, i) => applyCaps(d, caps[i]));
      judgements[twin.id] = judgement;
    } else {
      missed.add(twin.id);
    }
    await mustUpdate(
      ctx,
      run,
      {
        state: { versions, judgements: { ...judgements }, missed: [...missed] },
        progress: { done: 1 + Object.keys(judgements).length + missed.size, total },
      },
      { keepLease: true },
    );
    if (judgement) {
      await store.addEvent({
        workspace_id: run.workspace_id,
        run_id: run.id,
        kind: "group_answered",
        summary: `${twin.name} compared the versions.`,
        data: { twinId: twin.id },
      });
    }
  });
  if (stop || (await cancelled(ctx, run))) return finish(ctx, run, "cancelled");

  const used = twins.map((t) => judgements[t.id]).filter(Boolean);
  if (used.length * 2 < twins.length) {
    throw new Fatal("Too few audience groups answered. Nothing was charged.");
  }
  const ranked = rankVersions(versions, used);
  const base = confidenceFor({ depth: "pulse", traits: allTraits(twins), measuredPosts: 0 });
  const output: TournamentOutput = {
    ...ranked,
    summary: comparisonSummary(ranked),
    // Versions are compared with each other, not with real results, so this
    // is never more than "fairly sure".
    confidence: tournamentConfidence(ranked.tooClose, base),
  };
  await store.addEvent({
    workspace_id: run.workspace_id,
    run_id: run.id,
    kind: "result_ready",
    summary: output.tooClose
      ? "The top two are too close to call."
      : "A strongest version was found.",
  });
  await finish(ctx, run, "succeeded", {
    progress: { done: total, total },
    output: output as unknown as Record<string, unknown>,
  });
}

/* ───────────────────────── advance + sweep ───────────────────────── */

export async function advance(ctx: Ctx, run: RunRow): Promise<void> {
  if (!ctx.ports.enabled(run.workspace_id)) {
    await ctx.store.updateRun(run, ctx.worker, {
      next_attempt_at: inMs(ctx.ports.now(), 30 * MIN),
    });
    return;
  }
  if (run.cancel_requested) return finish(ctx, run, "cancelled");
  try {
    if (run.kind === "twins") return await runTwins(ctx, run);
    if (run.kind === "pulse") return await runPulse(ctx, run);
    return await runTournament(ctx, run);
  } catch (error) {
    if (error instanceof LeaseLost) return;
    if (error instanceof Fatal) return fail(ctx, run, error.message);
    throw error;
  }
}

export type SweepResult = { claimed: number; advanced: number; failed: number; deferred: number };

/**
 * Claim what is due and move each run one stage. With `onlyId` the same run is
 * claimed again until it ends or the budget is used, so a click finishes in one go.
 */
export async function runSweep(
  store: AudienceStore,
  ports: AudiencePorts,
  opts: { worker: string; budgetMs?: number; max?: number; onlyId?: string },
): Promise<SweepResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 40_000;
  const ctx: Ctx = { store, ports, worker: opts.worker };
  const result: SweepResult = { claimed: 0, advanced: 0, failed: 0, deferred: 0 };

  for (let round = 0; round < 6; round++) {
    const claimed = await store.claim(opts.worker, opts.max ?? 6, LEASE_SECONDS, opts.onlyId);
    if (!claimed.length) break;
    result.claimed += claimed.length;
    for (const run of claimed) {
      if (Date.now() - started > budgetMs) {
        await store.updateRun(run, opts.worker, {});
        result.deferred++;
        continue;
      }
      try {
        await advance(ctx, run);
        result.advanced++;
      } catch (error) {
        result.failed++;
        const attempts = run.attempts + 1;
        const reason = message(error);
        console.error(`[audience] ${run.kind}/${run.stage} ${run.id} failed:`, reason);
        if (attempts >= MAX_ERRORS) {
          await fail(ctx, { ...run, attempts }, "This didn't finish. Nothing was charged.").catch(
            () => undefined,
          );
        } else {
          await store
            .updateRun(run, opts.worker, {
              attempts,
              last_error: reason,
              // Soon: a person is usually watching this run.
              next_attempt_at: inMs(ports.now(), attempts * 20_000),
            })
            .catch(() => false);
        }
      }
    }
    if (!opts.onlyId || Date.now() - started > budgetMs) break;
  }
  return result;
}
