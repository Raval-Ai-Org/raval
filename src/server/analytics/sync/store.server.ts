// store.server.ts — Supabase (service role) implementation of the analytics
// sync store. Only the worker, cron and explicit service paths use it.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AnalyticsSyncStore, SyncRunRow } from "./store";

const BATCH = 500;

function chunks<T>(rows: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function createSupabaseAnalyticsStore(db: SupabaseClient<Database>): AnalyticsSyncStore {
  return {
    async claimRuns(worker, max, leaseSeconds, runId) {
      const { data, error } = await db.rpc("claim_analytics_sync_runs", {
        p_worker: worker,
        p_max: max,
        p_lease_seconds: leaseSeconds,
        ...(runId ? { p_id: runId } : {}),
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as SyncRunRow[];
    },

    async getRun(id) {
      const { data, error } = await db
        .from("analytics_sync_runs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateRun(id, worker, patch) {
      const { data, error } = await db
        .from("analytics_sync_runs")
        .update(patch)
        .eq("id", id)
        .eq("locked_by", worker)
        .select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    async getSource(id) {
      const { data, error } = await db
        .from("analytics_sources")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateSource(id, patch) {
      const { error } = await db.from("analytics_sources").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },

    async getConnection(id) {
      const { data, error } = await db
        .from("workspace_connections")
        .select("id, workspace_id, status")
        .eq("id", id)
        .eq("provider", "google")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async upsertGa4Daily(rows) {
      for (const batch of chunks(rows)) {
        const { error } = await db.from("analytics_ga4_daily").upsert(
          batch.map((r) => ({ ...r, synced_at: new Date().toISOString() })),
          {
            onConflict: "source_id,date",
          },
        );
        if (error) throw new Error(error.message);
      }
    },

    async upsertGscDaily(rows) {
      for (const batch of chunks(rows)) {
        const { error } = await db.from("analytics_gsc_daily").upsert(
          batch.map((r) => ({ ...r, synced_at: new Date().toISOString() })),
          {
            onConflict: "source_id,date",
          },
        );
        if (error) throw new Error(error.message);
      }
    },

    async replaceDimensionRows(table, sourceId, dimension, from, to, rows) {
      const { error: delError } = await db
        .from(table)
        .delete()
        .eq("source_id", sourceId)
        .eq("dimension", dimension)
        .gte("date", from)
        .lte("date", to);
      if (delError) throw new Error(delError.message);
      for (const batch of chunks(rows)) {
        const { error } = await db
          .from(table)
          .upsert(batch as never, { onConflict: "source_id,date,dimension,value" });
        if (error) throw new Error(error.message);
      }
    },

    async upsertGa4PeriodTotals(rows) {
      if (!rows.length) return;
      const { error } = await db.from("analytics_ga4_period_totals").upsert(
        rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })),
        {
          onConflict: "source_id,date_from,date_to",
        },
      );
      if (error) throw new Error(error.message);
    },

    async enqueueRun(row) {
      const { data, error } = await db
        .from("analytics_sync_runs")
        .insert({ ...row, cursor_date: row.range_start, status: "queued" })
        .select("*")
        .single();
      if (!error && data) return { run: data, created: true };
      // 23505: a run is already queued/running for this source — reuse it.
      if (error?.code === "23505") {
        const { data: existing, error: readError } = await db
          .from("analytics_sync_runs")
          .select("*")
          .eq("source_id", row.source_id)
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (readError) throw new Error(readError.message);
        if (existing) return { run: existing, created: false };
      }
      throw new Error(error?.message ?? "Couldn't queue the analytics sync.");
    },

    async listActiveSources(limit) {
      const { data, error } = await db
        .from("analytics_sources")
        .select("*")
        .eq("status", "active")
        .order("last_synced_date", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  };
}
