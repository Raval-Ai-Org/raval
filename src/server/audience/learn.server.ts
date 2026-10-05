// learn.server.ts — closing the loop. A published piece that had a score gets
// one frozen real result a week after it went out; real results then correct
// future scores and become the "measured" part of the audience.
//
// Nothing here publishes or syncs: the publisher and its metrics sync are
// untouched. This only reads what they stored.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  calibrate,
  engagementRate,
  learnedPatterns,
  MIN_PAIRS,
  outcomeReady,
  OUTCOME_AFTER_DAYS,
  percentileAmong,
  readMetrics,
  type MeasuredPost,
  type Pair,
} from "@/lib/audience/calibration";
import { OVERALL_SLUG, type OutcomeRow, type PredictionRow } from "@/lib/audience/contracts";
import { openingOf } from "@/lib/audience/score";
import { makeTrait } from "@/lib/audience/twins";
import { isAudienceEnabled } from "@/lib/feature-flags";
import { invalidateAudienceContext } from "./context.server";
import { supabaseAudienceStore as store } from "./store.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const DAY = 86_400_000;
/** Posts older than this are no longer picked up for a first result. */
const LOOKBACK_DAYS = 45;
/** The workspace's own posts a result is compared with. */
const BASELINE_DAYS = 180;

type Publication = {
  workspace_id: string;
  content_item_id: string;
  platform: string;
  metrics: unknown;
  delivered_at: string | null;
  metrics_synced_at: string | null;
};

/** The publication of an item that the most people saw. */
function best(rows: Publication[]): Publication {
  return [...rows].sort((a, b) => readMetrics(b.metrics).views - readMetrics(a.metrics).views)[0];
}

/** The prediction a person had in front of them before the piece went out. */
function predictionFor(rows: PredictionRow[], deliveredAt: string): PredictionRow | null {
  const before = rows.filter((p) => p.created_at <= deliveredAt);
  if (!before.length) return null;
  return (
    before.find((p) => p.depth === "pulse") ??
    [...before].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  );
}

async function baseline(workspaceId: string, now: Date): Promise<Map<string, number[]>> {
  const { data, error } = await db
    .from("content_publications")
    .select("content_item_id, platform, metrics")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("delivered_at", new Date(now.getTime() - BASELINE_DAYS * DAY).toISOString())
    .lte("delivered_at", new Date(now.getTime() - OUTCOME_AFTER_DAYS * DAY).toISOString())
    .limit(600);
  if (error) throw new Error(error.message);
  const byPlatform = new Map<string, Map<string, number>>();
  for (const row of (data ?? []) as Pick<
    Publication,
    "content_item_id" | "platform" | "metrics"
  >[]) {
    const rate = engagementRate(readMetrics(row.metrics));
    if (rate === null) continue;
    const items = byPlatform.get(row.platform) ?? new Map<string, number>();
    items.set(row.content_item_id, Math.max(rate, items.get(row.content_item_id) ?? 0));
    byPlatform.set(row.platform, items);
  }
  return new Map([...byPlatform].map(([platform, items]) => [platform, [...items.values()]]));
}

/** Recompute everything derived from a workspace's frozen results. */
export async function relearn(workspaceId: string, now = new Date()): Promise<void> {
  const outcomes = await store.listOutcomes(workspaceId, 300);
  if (!outcomes.length) return;

  // 1. Place results that could not be compared yet.
  const waiting = outcomes.filter((o) => o.actual === null);
  if (waiting.length) {
    const posts = await baseline(workspaceId, now);
    for (const outcome of waiting) {
      const actual = percentileAmong(outcome.engagement, posts.get(outcome.platform) ?? []);
      if (actual === null) continue;
      await store.setOutcomeActual(workspaceId, outcome.id, actual);
      outcome.actual = actual;
    }
  }

  // 2. How far predictions were from real results.
  const compared = outcomes.filter((o): o is OutcomeRow & { actual: number } => o.actual !== null);
  const cells = new Map<string, Pair[]>();
  for (const o of compared) {
    const key = `${o.platform}␟${o.content_type}`;
    cells.set(key, [...(cells.get(key) ?? []), { predicted: o.predicted, actual: o.actual }]);
  }
  for (const [key, pairs] of cells) {
    const [platform, contentType] = key.split("␟");
    if (!platform || !contentType) continue;
    await store.saveCalibration({
      workspace_id: workspaceId,
      platform,
      content_type: contentType,
      ...calibrate(pairs),
      learned: [],
    });
  }

  // 3. What this audience really responds to, in plain sentences.
  const predictions = await store.listPredictions(workspaceId, {
    contentItemIds: outcomes.map((o) => o.content_item_id).filter((id): id is string => !!id),
    limit: 400,
  });
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const measured: MeasuredPost[] = outcomes.map((o) => {
    const body = byId.get(o.prediction_id)?.subject.body;
    return {
      title: o.title,
      platform: o.platform,
      contentType: o.content_type,
      engagement: o.engagement,
      ...(body ? { length: body.length, question: openingOf(body).includes("?") } : {}),
    };
  });
  const learned = outcomes.length >= MIN_PAIRS ? learnedPatterns(measured) : [];
  await store.saveCalibration({
    workspace_id: workspaceId,
    platform: "all",
    content_type: "all",
    ...calibrate(compared.map((o) => ({ predicted: o.predicted, actual: o.actual }))),
    learned,
  });

  // 4. Measured patterns become part of the audience itself.
  const twins = await store.listTwins(workspaceId);
  const overall = twins.find((t) => t.kind === "overall");
  const held = (overall?.profile ?? []).map((t) => t.text);
  if (JSON.stringify(held) !== JSON.stringify(learned) && (learned.length || overall)) {
    await store.upsertTwin(
      workspaceId,
      {
        slug: OVERALL_SLUG,
        kind: "overall",
        name: "What your results show",
        segment: "",
        summary: "",
        weight: 100,
        profile: learned.map((text) => makeTrait("pattern", text, "measured")),
        origin: "system",
        origin_ref: null,
      },
      null,
    );
    invalidateAudienceContext(workspaceId);
  }
}

export type CollectResult = { frozen: number; workspaces: number };

/**
 * Freeze a real result for every scored piece whose week is up. Writes nothing
 * for a post that is too young, was not read after its week, or was seen by
 * too few people.
 */
export async function collectOutcomes(
  opts: { limit?: number; now?: Date } = {},
): Promise<CollectResult> {
  const now = opts.now ?? new Date();
  const { data, error } = await db
    .from("content_publications")
    .select("workspace_id, content_item_id, platform, metrics, delivered_at, metrics_synced_at")
    .eq("status", "published")
    .not("metrics_synced_at", "is", null)
    .lte("delivered_at", new Date(now.getTime() - OUTCOME_AFTER_DAYS * DAY).toISOString())
    .gte("delivered_at", new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString())
    .order("delivered_at", { ascending: false })
    .limit(opts.limit ?? 400);
  if (error) throw new Error(error.message);

  const byItem = new Map<string, Publication[]>();
  for (const row of (data ?? []) as Publication[]) {
    if (!isAudienceEnabled(row.workspace_id)) continue;
    byItem.set(row.content_item_id, [...(byItem.get(row.content_item_id) ?? []), row]);
  }
  const touched = new Set<string>();
  // Results still waiting for enough posts to be compared with get another look.
  const { data: unplaced } = await db
    .from("audience_outcomes")
    .select("workspace_id")
    .is("actual", null)
    .gte("measured_at", new Date(now.getTime() - 60 * DAY).toISOString())
    .limit(200);
  for (const row of (unplaced ?? []) as { workspace_id: string }[]) {
    if (isAudienceEnabled(row.workspace_id)) touched.add(row.workspace_id);
  }

  let frozen = 0;
  if (byItem.size) frozen = await freeze(byItem, now, touched);
  for (const workspaceId of touched) {
    await relearn(workspaceId, now).catch((cause) =>
      console.error(`[audience] relearn for ${workspaceId} failed`, cause),
    );
  }
  return { frozen, workspaces: touched.size };
}

async function freeze(
  byItem: Map<string, Publication[]>,
  now: Date,
  touched: Set<string>,
): Promise<number> {
  const ids = [...byItem.keys()];
  const [predicted, done, items] = await Promise.all([
    db.from("audience_predictions").select("*").in("content_item_id", ids).limit(2000),
    db.from("audience_outcomes").select("content_item_id").in("content_item_id", ids),
    db.from("content_items").select("id, title, workspace_id").in("id", ids),
  ]);
  if (predicted.error) throw new Error(predicted.error.message);
  const settled = new Set(
    ((done.data ?? []) as { content_item_id: string }[]).map((r) => r.content_item_id),
  );
  const titles = new Map(
    ((items.data ?? []) as { id: string; title: string | null; workspace_id: string }[]).map(
      (r) => [r.id, r],
    ),
  );
  const predictions = new Map<string, PredictionRow[]>();
  for (const row of (predicted.data ?? []) as PredictionRow[]) {
    if (!row.content_item_id) continue;
    predictions.set(row.content_item_id, [...(predictions.get(row.content_item_id) ?? []), row]);
  }

  let frozen = 0;
  for (const [itemId, rows] of byItem) {
    if (settled.has(itemId) || !predictions.has(itemId)) continue;
    const publication = best(rows);
    const item = titles.get(itemId);
    // The row, the publication and the prediction must be one workspace's.
    if (!item || item.workspace_id !== publication.workspace_id) continue;
    if (
      !outcomeReady({
        deliveredAt: publication.delivered_at,
        metricsSyncedAt: publication.metrics_synced_at,
        now,
      })
    ) {
      continue;
    }
    const metrics = readMetrics(publication.metrics);
    const engagement = engagementRate(metrics);
    if (engagement === null) continue;
    const prediction = predictionFor(
      predictions.get(itemId)!.filter((p) => p.workspace_id === publication.workspace_id),
      publication.delivered_at!,
    );
    if (!prediction) continue;
    const inserted = await store.insertOutcome({
      workspace_id: publication.workspace_id,
      prediction_id: prediction.id,
      content_item_id: itemId,
      platform: publication.platform,
      content_type: prediction.content_type,
      title: (item.title ?? prediction.subject.title ?? "").slice(0, 200),
      horizon: "d7",
      metrics,
      engagement: Math.round(engagement * 100000) / 100000,
      predicted: prediction.overall,
      actual: null,
      delivered_at: publication.delivered_at,
    });
    if (inserted) {
      frozen++;
      touched.add(publication.workspace_id);
    }
  }
  return frozen;
}

let lastCollect = 0;

/** Cron entry: at most twice an hour per instance. Duplicates are harmless (unique rows). */
export async function collectOutcomesIfDue(): Promise<CollectResult | null> {
  if (Date.now() - lastCollect < 30 * 60_000) return null;
  lastCollect = Date.now();
  return collectOutcomes();
}
