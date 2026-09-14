// service.server.ts — AI Visibility scan lifecycle: create, drive, resume,
// cancel. The only module routes, server functions, the scheduler and the
// cron hook use to touch scans.
//
// Background model (no queue infrastructure — the studio_jobs pattern):
//   • create      inserts a queued row (plan page cap, one full crawl per
//                 workspace, idempotency key)
//   • quick scan  driven inline inside the request (homepage only, ~5–15 s)
//   • full scan   kicked with next/server `after()` so the response returns
//                 immediately; the crawl continues in the same process
//   • cron        /api/public/hooks/geo-scans claims any scan whose lease has
//                 expired (process restart, deploy, a yielded slice) — every
//                 minute, so a scan always finishes
//   • watchdog    reading a scan whose lease expired re-kicks it, so local
//                 development works without pg_cron
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { normalizeUrl } from "@/lib/crawl/html";
import { isGeoProbesEnabled } from "@/lib/feature-flags";
import type { GeoScanView } from "@/lib/geo/contracts";
import { getPlanLimits } from "@/server/plans";
import { runWithScope } from "@/server/request-context";
import { assertPublicUrl } from "@/server/safe-fetch";
import { getDefaultFetcher, siteHost } from "./crawler.server";
import { presentScan, SCAN_VIEW_COLS } from "./present";
import { runGeoProbes } from "./probes.server";
import { advanceScan, LEASE_SECONDS, type SliceResult } from "./scan-runner.server";
import {
  createSupabaseGeoStore,
  type ScanMode,
  type ScanRow,
  type ScanTrigger,
} from "./store.server";

const WORKER = `geo-${process.pid}-${randomUUID().slice(0, 8)}`;
const SCAN_ROW_COLS =
  "id, workspace_id, created_by, url, origin, host, mode, trigger, status, stage, config, site, progress, overall_score, cancel_requested, attempt_count, lease_until, locked_by, error, created_at, started_at, completed_at";

export class GeoScanConflictError extends Error {
  constructor(readonly activeScanId: string) {
    super("A site scan is already running for this workspace. Wait for it to finish or cancel it.");
    this.name = "GeoScanConflictError";
  }
}

export type CreateScanInput = {
  workspaceId: string;
  userId: string | null;
  url: string;
  mode: ScanMode;
  trigger: ScanTrigger;
  probes?: boolean;
  idempotencyKey?: string;
  scheduledJobId?: string;
};

async function activeFullScan(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("geo_scans")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("mode", "full")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** Validate and enqueue a scan. Throws SsrfBlockedError / TypeError for bad URLs. */
export async function createScan(input: CreateScanInput): Promise<ScanRow> {
  const url = assertPublicUrl(normalizeUrl(input.url));
  url.hash = "";

  const { data: ws, error: wsError } = await supabaseAdmin
    .from("workspaces")
    .select("plan")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (wsError) throw new Error(wsError.message);
  if (!ws) throw new Error("Workspace not found");
  const limits = getPlanLimits(ws.plan);

  if (input.idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from("geo_scans")
      .select(SCAN_ROW_COLS)
      .eq("workspace_id", input.workspaceId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) return existing as unknown as ScanRow;
  }

  if (input.mode === "full") {
    const active = await activeFullScan(input.workspaceId);
    if (active) throw new GeoScanConflictError(active);
  }

  const config = {
    maxPages: input.mode === "quick" ? 1 : limits.geoMaxPages,
    maxDepth: input.mode === "quick" ? 0 : 5,
    probes: input.mode === "full" && input.probes === true && isGeoProbesEnabled(input.workspaceId),
  };
  const { data, error } = await supabaseAdmin
    .from("geo_scans")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      url: url.toString(),
      origin: url.origin,
      host: siteHost(url.toString()),
      mode: input.mode,
      trigger: input.trigger,
      config,
      idempotency_key: input.idempotencyKey ?? null,
      scheduled_job_id: input.scheduledJobId ?? null,
    })
    .select(SCAN_ROW_COLS)
    .single();
  if (error) {
    // Lost a race with another create: the partial unique index fired.
    if (error.code === "23505" && input.mode === "full") {
      const active = await activeFullScan(input.workspaceId);
      if (active) throw new GeoScanConflictError(active);
    }
    throw new Error(error.message);
  }
  return data as unknown as ScanRow;
}

/** Claim one scan and advance it until it finishes or the budget runs out. */
export async function driveScan(
  scanId: string,
  opts: { budgetMs: number },
): Promise<SliceResult | "not_claimed"> {
  const store = createSupabaseGeoStore(supabaseAdmin);
  const deadline = Date.now() + opts.budgetMs;
  const [scan] = await store.claimScans(WORKER, 1, LEASE_SECONDS, scanId);
  if (!scan) return "not_claimed";
  return runSlice(scan, deadline);
}

function runSlice(scan: ScanRow, deadline: number): Promise<SliceResult> {
  const store = createSupabaseGeoStore(supabaseAdmin);
  return runWithScope(
    { workspaceId: scan.workspace_id, userId: scan.created_by ?? undefined, route: "geo.scan" },
    () =>
      advanceScan(scan, {
        store,
        fetcher: getDefaultFetcher(),
        worker: WORKER,
        deadline,
        probes: scan.config?.probes ? runGeoProbes : undefined,
        log: (message, detail) => console.error(message, detail),
      }),
  );
}

/** Continue a scan after the current response is sent. */
export function kickScan(scanId: string, budgetMs = 240_000): void {
  after(async () => {
    try {
      await driveScan(scanId, { budgetMs });
    } catch (error) {
      console.error(`[geo] background slice for ${scanId} failed`, error);
    }
  });
}

/** Cron: resume scans with expired leases, sequentially, within the budget. */
export async function runDueGeoScans(opts: { budgetMs?: number; max?: number } = {}) {
  const store = createSupabaseGeoStore(supabaseAdmin);
  const deadline = Date.now() + (opts.budgetMs ?? 90_000);
  const max = opts.max ?? 3;
  const results: Record<string, number> = { done: 0, yield: 0, lost_lease: 0 };
  let claimed = 0;
  while (claimed < max && Date.now() < deadline - 10_000) {
    const [scan] = await store.claimScans(WORKER, 1, LEASE_SECONDS);
    if (!scan) break;
    claimed++;
    const result = await runSlice(scan, deadline);
    results[result] = (results[result] ?? 0) + 1;
  }
  return { claimed, ...results };
}

function leaseExpired(row: { lease_until: string | null }): boolean {
  return !row.lease_until || Date.parse(row.lease_until) < Date.now();
}

/** Read a scan through the caller's RLS client; re-kick it when its worker is gone. */
export async function loadScanView(
  supabase: UserSupabaseClient,
  workspaceId: string,
  scanId: string,
  opts: { resume?: boolean } = {},
): Promise<GeoScanView | null> {
  const { data, error } = await supabase
    .from("geo_scans")
    .select(SCAN_VIEW_COLS)
    .eq("id", scanId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as { status: string; lease_until: string | null };
  if (opts.resume && (row.status === "queued" || row.status === "running") && leaseExpired(row)) {
    kickScan(scanId);
  }
  return presentScan(data as Record<string, unknown>);
}

export async function requestCancel(workspaceId: string, scanId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("geo_scans")
    .update({ cancel_requested: true })
    .eq("id", scanId)
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "running"])
    .select("id, lease_until")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  // No live worker: finish the cancellation here instead of waiting for a claim.
  if (leaseExpired(data)) {
    await supabaseAdmin
      .from("geo_scans")
      .update({
        status: "cancelled",
        stage: "done",
        completed_at: new Date().toISOString(),
        lease_until: null,
      })
      .eq("id", scanId)
      .in("status", ["queued", "running"]);
    await supabaseAdmin
      .from("geo_scan_pages")
      .update({ state: "skipped", skip_reason: "Scan cancelled" })
      .eq("scan_id", scanId)
      .eq("state", "pending");
  }
  return true;
}
