// service.server.ts — scheduling analytics syncs.
//
//   enqueueSync        idempotent (one queued/running run per source); a source
//                      that was never backfilled gets the 180-day initial run
//   kickRun            advance a run right after the response via after()
//   runDueAnalyticsSyncs  cron: enqueue daily incrementals, then drive due runs
//
// Dates are calendar days in the source's zone: the GA4 property's time zone,
// America/Los_Angeles for Search Console (Google reports it in Pacific Time).
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addDays, BACKFILL_DAYS, todayIn } from "@/lib/analytics/ranges";
import { googleApiFor } from "../google/tokens.server";
import { advanceRun, LEASE_SECONDS, type RunnerDeps } from "./runner.server";
import type { AnalyticsSyncStore, SourceRow, SyncRunRow } from "./store";
import { createSupabaseAnalyticsStore } from "./store.server";

/** Daily runs re-fetch this many recent days: GA4 and Search Console keep revising them. */
export const REFRESH_DAYS = 4;
/** After a failed run, wait this long before the cron queues another automatically. */
const FAILED_COOLDOWN_MS = 6 * 3600_000;

const WORKER = `analytics-${process.pid}-${randomUUID().slice(0, 8)}`;

export function sourceTimeZone(source: Pick<SourceRow, "kind" | "time_zone">): string {
  return source.kind === "gsc_site" ? "America/Los_Angeles" : source.time_zone || "UTC";
}

/** Yesterday in the source's zone — the last complete day. */
export function lastCompleteDay(
  source: Pick<SourceRow, "kind" | "time_zone">,
  now = new Date(),
): string {
  return addDays(todayIn(sourceTimeZone(source), now), -1);
}

export function syncWindow(
  source: Pick<SourceRow, "kind" | "time_zone" | "backfill_completed_at">,
  trigger: SyncRunRow["trigger"],
  now = new Date(),
): { trigger: SyncRunRow["trigger"]; range_start: string; range_end: string } {
  const end = lastCompleteDay(source, now);
  const effective = source.backfill_completed_at ? trigger : "initial";
  const days = effective === "initial" ? BACKFILL_DAYS : REFRESH_DAYS;
  return { trigger: effective, range_start: addDays(end, -(days - 1)), range_end: end };
}

function defaultStore(): AnalyticsSyncStore {
  return createSupabaseAnalyticsStore(supabaseAdmin);
}

export async function enqueueSync(
  source: SourceRow,
  trigger: SyncRunRow["trigger"],
  opts: { requestedBy?: string | null; store?: AnalyticsSyncStore; now?: Date } = {},
): Promise<{ run: SyncRunRow; created: boolean }> {
  const store = opts.store ?? defaultStore();
  const window = syncWindow(source, trigger, opts.now);
  return store.enqueueRun({
    workspace_id: source.workspace_id,
    source_id: source.id,
    trigger: window.trigger,
    range_start: window.range_start,
    range_end: window.range_end,
    requested_by: opts.requestedBy ?? null,
  });
}

async function onSucceeded(run: SyncRunRow, source: SourceRow): Promise<void> {
  const { refreshInsightsAfterSync } = await import("../insights.server");
  await refreshInsightsAfterSync(source.workspace_id);
}

function runnerDeps(deadline: number, store: AnalyticsSyncStore): RunnerDeps {
  return { store, apiFor: googleApiFor, worker: WORKER, deadline, onSucceeded };
}

/** Advance one run until it finishes or the budget runs out. */
export async function driveRun(runId: string, opts: { budgetMs: number }): Promise<string> {
  const store = defaultStore();
  const deadline = Date.now() + opts.budgetMs;
  const [claimed] = await store.claimRuns(WORKER, 1, LEASE_SECONDS, runId);
  if (!claimed) return "not_claimed";
  return advanceRun(claimed, runnerDeps(deadline, store));
}

export function kickRun(runId: string, budgetMs = 240_000): void {
  after(async () => {
    try {
      await driveRun(runId, { budgetMs });
    } catch (e) {
      console.error("[analytics] sync kick failed:", e instanceof Error ? e.message : e);
    }
  });
}

/**
 * Cron: queue a daily run for every active source (with an active Google
 * connection) that hasn't synced yesterday, then drive due runs within budget.
 */
export async function runDueAnalyticsSyncs(opts: { budgetMs: number; maxEnqueue?: number }) {
  const started = Date.now();
  const deadline = started + opts.budgetMs;
  const store = defaultStore();
  const now = new Date();

  let enqueued = 0;
  const sources = await store.listActiveSources(opts.maxEnqueue ?? 200);
  if (sources.length) {
    const connectionIds = [...new Set(sources.map((s) => s.connection_id))];
    const [{ data: connections }, { data: recentRuns }] = await Promise.all([
      supabaseAdmin.from("workspace_connections").select("id, status").in("id", connectionIds),
      supabaseAdmin
        .from("analytics_sync_runs")
        .select("source_id, status, completed_at")
        .in(
          "source_id",
          sources.map((s) => s.id),
        )
        .eq("status", "failed")
        .gte("completed_at", new Date(Date.now() - FAILED_COOLDOWN_MS).toISOString()),
    ]);
    const activeConnections = new Set(
      (connections ?? []).filter((c) => c.status === "active").map((c) => c.id),
    );
    const coolingDown = new Set((recentRuns ?? []).map((r) => r.source_id));
    for (const source of sources) {
      if (!activeConnections.has(source.connection_id) || coolingDown.has(source.id)) continue;
      const yesterday = lastCompleteDay(source, now);
      const due =
        !source.backfill_completed_at ||
        !source.last_synced_date ||
        source.last_synced_date < yesterday;
      if (!due) continue;
      const { created } = await enqueueSync(source, "daily", { store, now });
      if (created) enqueued += 1;
    }
  }

  const counts: Record<string, number> = { enqueued };
  while (Date.now() < deadline - 10_000) {
    const [claimed] = await store.claimRuns(WORKER, 1, LEASE_SECONDS);
    if (!claimed) break;
    const result = await advanceRun(claimed, runnerDeps(deadline - 5_000, store));
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return counts;
}
