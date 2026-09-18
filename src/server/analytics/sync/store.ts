// store.ts — what the analytics sync runner needs from storage. Implemented
// by Supabase (store.server.ts, service role) and in memory (store.memory.ts)
// so the runner is tested without a database.
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";

export type SyncRunRow = Tables<"analytics_sync_runs">;
export type SourceRow = Tables<"analytics_sources">;
export type RunPatch = TablesUpdate<"analytics_sync_runs">;
export type SourcePatch = TablesUpdate<"analytics_sources">;

export type Ga4DailyRow = {
  source_id: string;
  workspace_id: string;
  date: string;
  sessions: number;
  total_users: number;
  new_users: number;
  engaged_sessions: number;
  screen_page_views: number;
  key_events: number;
  session_duration_seconds: number;
  bounced_sessions: number;
};

export type Ga4DimensionRow = {
  source_id: string;
  workspace_id: string;
  date: string;
  dimension: "channel" | "source_medium" | "landing_page" | "country" | "device";
  value: string;
  sessions: number;
  total_users: number;
  screen_page_views: number;
  key_events: number;
};

export type GscDailyRow = {
  source_id: string;
  workspace_id: string;
  date: string;
  clicks: number;
  impressions: number;
  position_weighted: number;
};

export type GscDimensionRow = {
  source_id: string;
  workspace_id: string;
  date: string;
  dimension: "query" | "page" | "country" | "device";
  value: string;
  clicks: number;
  impressions: number;
  position_weighted: number;
};

export type Ga4PeriodTotalRow = {
  source_id: string;
  workspace_id: string;
  date_from: string;
  date_to: string;
  total_users: number;
};

export type FactTable = "analytics_ga4_dimension_daily" | "analytics_gsc_dimension_daily";

export interface AnalyticsSyncStore {
  claimRuns(
    worker: string,
    max: number,
    leaseSeconds: number,
    runId?: string,
  ): Promise<SyncRunRow[]>;
  getRun(id: string): Promise<SyncRunRow | null>;
  /** Lease-guarded update: false when the lease was lost to another worker. */
  updateRun(id: string, worker: string, patch: RunPatch): Promise<boolean>;
  getSource(id: string): Promise<SourceRow | null>;
  updateSource(id: string, patch: SourcePatch): Promise<void>;
  getConnection(id: string): Promise<{ id: string; workspace_id: string; status: string } | null>;
  upsertGa4Daily(rows: Ga4DailyRow[]): Promise<void>;
  upsertGscDaily(rows: GscDailyRow[]): Promise<void>;
  /** Replace a dimension's rows for a date span (top-N sets change between fetches). */
  replaceDimensionRows(
    table: FactTable,
    sourceId: string,
    dimension: string,
    from: string,
    to: string,
    rows: Array<Ga4DimensionRow | GscDimensionRow>,
  ): Promise<void>;
  upsertGa4PeriodTotals(rows: Ga4PeriodTotalRow[]): Promise<void>;
  /** Insert a queued run unless one is already queued/running for the source. */
  enqueueRun(row: {
    workspace_id: string;
    source_id: string;
    trigger: SyncRunRow["trigger"];
    range_start: string;
    range_end: string;
    requested_by?: string | null;
  }): Promise<{ run: SyncRunRow; created: boolean }>;
  /** Active sources whose data isn't synced through `before` (per-source dates checked by caller). */
  listActiveSources(limit: number): Promise<SourceRow[]>;
}
