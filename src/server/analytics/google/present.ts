// present.ts — the only shapes of Google connector data that reach the
// browser. Whitelisted fields; never tokens, never raw Google responses.
import type { Tables } from "@/integrations/supabase/types";
import { runProgress } from "../sync/runner.server";
import type {
  AnalyticsSourceView,
  GoogleConnectionView,
  SyncErrorCode,
  SyncRunView,
} from "@/lib/analytics/types";

export const GOOGLE_CONNECTION_COLS =
  "id, workspace_id, status, account_login, last_error, created_at, permissions" as const;
export const SOURCE_COLS =
  "id, workspace_id, connection_id, kind, external_id, display_name, account_name, site_host, time_zone, status, last_error, last_synced_at, last_synced_date, backfill_completed_at" as const;
export const RUN_COLS =
  "id, source_id, trigger, status, range_start, range_end, cursor_date, error_code, error_message, next_attempt_at, completed_at, created_at" as const;

type ConnRow = Pick<
  Tables<"workspace_connections">,
  "id" | "workspace_id" | "status" | "account_login" | "last_error" | "created_at" | "permissions"
>;
type SourceRow = Pick<
  Tables<"analytics_sources">,
  | "id"
  | "workspace_id"
  | "connection_id"
  | "kind"
  | "external_id"
  | "display_name"
  | "account_name"
  | "site_host"
  | "time_zone"
  | "status"
  | "last_error"
  | "last_synced_at"
  | "last_synced_date"
  | "backfill_completed_at"
>;
type RunRow = Pick<
  Tables<"analytics_sync_runs">,
  | "id"
  | "source_id"
  | "trigger"
  | "status"
  | "range_start"
  | "range_end"
  | "cursor_date"
  | "error_code"
  | "error_message"
  | "next_attempt_at"
  | "completed_at"
  | "created_at"
>;

export function presentRun(run: RunRow | null | undefined): SyncRunView | null {
  if (!run) return null;
  return {
    id: run.id,
    trigger: run.trigger as SyncRunView["trigger"],
    status: run.status as SyncRunView["status"],
    progress: runProgress(run),
    rangeStart: run.range_start,
    rangeEnd: run.range_end,
    errorCode: (run.error_code as SyncErrorCode | null) ?? null,
    errorMessage: run.error_message,
    nextAttemptAt: run.status === "queued" || run.status === "running" ? run.next_attempt_at : null,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  };
}

export function presentSource(
  source: SourceRow,
  run: RunRow | null | undefined,
): AnalyticsSourceView {
  return {
    id: source.id,
    kind: source.kind as AnalyticsSourceView["kind"],
    externalId: source.external_id,
    displayName: source.display_name,
    accountName: source.account_name,
    siteHost: source.site_host,
    timeZone: source.time_zone,
    status: source.status as AnalyticsSourceView["status"],
    lastError: source.last_error,
    lastSyncedAt: source.last_synced_at,
    backfillCompletedAt: source.backfill_completed_at,
    run: presentRun(run),
  };
}

export function presentConnectionView(args: {
  configured: boolean;
  connection: ConnRow | null;
  sources: SourceRow[];
  runs: RunRow[];
}): GoogleConnectionView {
  const latestRun = (sourceId: string) =>
    args.runs
      .filter((r) => r.source_id === sourceId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const ga4 = args.sources.find((s) => s.kind === "ga4_property");
  const gsc = args.sources.find((s) => s.kind === "gsc_site");
  const perms = (args.connection?.permissions ?? {}) as {
    analytics?: unknown;
    searchConsole?: unknown;
  };
  return {
    configured: args.configured,
    connection: args.connection
      ? {
          id: args.connection.id,
          email: args.connection.account_login,
          status: args.connection.status as "active" | "suspended" | "revoked" | "error",
          lastError: args.connection.last_error,
          connectedAt: args.connection.created_at,
          scopes: {
            analytics: perms.analytics === true,
            searchConsole: perms.searchConsole === true,
          },
        }
      : null,
    ga4: ga4 ? presentSource(ga4, latestRun(ga4.id)) : null,
    gsc: gsc ? presentSource(gsc, latestRun(gsc.id)) : null,
  };
}
