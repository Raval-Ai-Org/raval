import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ServerFnContext } from "@/server/server-fn";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { compareScans as diffScans, type ComparableFinding } from "@/lib/geo/compare";
import type {
  DismissReason,
  FindingWorkflowState,
  GeoFindingView,
  GeoMonitor,
  GeoPageDetail,
  GeoPageView,
  GeoScanSummary,
} from "@/lib/geo/contracts";
import type { GeoCategoryId, PageAnalysis } from "@/lib/geo/types";

const uuid = z.string().uuid();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Writes need the editor role; reads are scoped by RLS to the caller's workspaces. */
async function requireEditor(context: ServerFnContext, workspaceId: string) {
  await requireWorkspaceRole(context, workspaceId, "editor");
}

async function loadStates(context: ServerFnContext, workspaceId: string) {
  const { data, error } = await context.supabase
    .from("geo_finding_states")
    .select(
      "fingerprint, state, note, resolved_via, verified_at, reopened_at, dismiss_reason, reviewed_at",
    )
    .eq("workspace_id", workspaceId)
    .limit(10_000);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((r) => [
      r.fingerprint,
      {
        state: r.state as FindingWorkflowState,
        note: r.note as string | null,
        resolution: (r.resolved_via as "verified" | "manual_legacy" | null) ?? null,
        verifiedAt: r.verified_at ?? null,
        reopenedAt: r.reopened_at ?? null,
        dismissReason: (r.dismiss_reason as DismissReason | null) ?? null,
        reviewedAt: r.reviewed_at ?? null,
      },
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Scans                                                              */
/* ------------------------------------------------------------------ */

export const listScans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        host: z.string().max(255).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<GeoScanSummary[]> => {
    const { presentSummary, SCAN_SUMMARY_COLS } = await import("@/server/geo/present");
    let q = context.supabase
      .from("geo_scans")
      .select(SCAN_SUMMARY_COLS)
      .eq("workspace_id", data.workspaceId)
      // Verification rescans (a few pages) aren't site scores.
      .neq("mode", "targeted")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30);
    if (data.host) q = q.eq("host", data.host);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => presentSummary(r as Record<string, unknown>));
  });

export const getScanFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GeoFindingView[]> => {
    const { FINDING_COLS, presentFinding } = await import("@/server/geo/present");
    const [{ data: rows, error }, states] = await Promise.all([
      context.supabase
        .from("geo_findings")
        .select(FINDING_COLS)
        .eq("workspace_id", data.workspaceId)
        .eq("scan_id", data.scanId)
        .order("priority_score", { ascending: false })
        .order("point_impact", { ascending: false })
        .limit(5000),
      loadStates(context, data.workspaceId),
    ]);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => presentFinding(r as Record<string, unknown>, states));
  });

export const getScanPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GeoPageView[]> => {
    const { PAGE_LIST_COLS, presentPage } = await import("@/server/geo/present");
    const { data: rows, error } = await context.supabase
      .from("geo_scan_pages")
      .select(PAGE_LIST_COLS)
      .eq("workspace_id", data.workspaceId)
      .eq("scan_id", data.scanId)
      .order("depth", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => presentPage(r as Record<string, unknown>));
  });

export const getScanPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, pageId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GeoPageDetail> => {
    const { FINDING_COLS, presentFinding, presentPage } = await import("@/server/geo/present");
    const { data: row, error } = await context.supabase
      .from("geo_scan_pages")
      .select(
        "id, url, final_url, depth, state, status_code, fetch_ms, skip_reason, score, category_scores, issues, analysis",
      )
      .eq("workspace_id", data.workspaceId)
      .eq("id", data.pageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Page not found");
    const [{ data: findingRows, error: findingsError }, states] = await Promise.all([
      context.supabase
        .from("geo_findings")
        .select(FINDING_COLS)
        .eq("workspace_id", data.workspaceId)
        .eq("page_id", data.pageId)
        .order("priority_score", { ascending: false })
        .limit(200),
      loadStates(context, data.workspaceId),
    ]);
    if (findingsError) throw new Error(findingsError.message);
    return {
      page: presentPage(row as Record<string, unknown>),
      analysis: (row.analysis as unknown as PageAnalysis | null) ?? null,
      findings: (findingRows ?? []).map((r) =>
        presentFinding(r as Record<string, unknown>, states),
      ),
    };
  });

export const compareScans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, baseScanId: uuid, targetScanId: uuid }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const load = async (scanId: string) => {
      const [{ data: scan, error }, { data: findings, error: findingsError }] = await Promise.all([
        context.supabase
          .from("geo_scans")
          .select("id, created_at, overall_score, category_scores, status")
          .eq("workspace_id", data.workspaceId)
          .eq("id", scanId)
          .maybeSingle(),
        context.supabase
          .from("geo_findings")
          .select("fingerprint, rule_id, title, detail, severity, category, page_url, point_impact")
          .eq("workspace_id", data.workspaceId)
          .eq("scan_id", scanId)
          .limit(5000),
      ]);
      if (error || findingsError) throw new Error((error ?? findingsError)!.message);
      if (!scan) throw new Error("Scan not found");
      if (scan.status !== "succeeded") throw new Error("Only completed scans can be compared");
      const categories = Object.entries((scan.category_scores ?? {}) as Record<string, number>).map(
        ([id, score]) => ({ id: id as GeoCategoryId, score }),
      );
      return {
        id: scan.id,
        createdAt: scan.created_at,
        overall: scan.overall_score,
        categories,
        findings: (findings ?? []).map((f): ComparableFinding => ({
          fingerprint: f.fingerprint,
          ruleId: f.rule_id,
          title: f.title,
          detail: f.detail,
          severity: f.severity as ComparableFinding["severity"],
          category: f.category as GeoCategoryId,
          pageUrl: f.page_url,
          pointImpact: Number(f.point_impact),
        })),
      };
    };
    const [base, target] = await Promise.all([load(data.baseScanId), load(data.targetScanId)]);
    return diffScans(base, target);
  });

/* ------------------------------------------------------------------ */
/* Finding workflow                                                   */
/* ------------------------------------------------------------------ */

export const setFindingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        fingerprint: z.string().min(3).max(800),
        // "resolved" is set only by a verification scan (src/server/geo/fixes/verify.server.ts).
        state: z.enum(["open", "in_progress", "dismissed"]),
        note: z.string().max(1000).nullable().optional(),
        // Ignoring a finding requires saying why.
        dismissReason: DISMISS_REASON.nullable().optional(),
      })
      .refine(
        (v) => v.state !== "dismissed" || Boolean(v.dismissReason),
        "Choose a reason to ignore this finding",
      )
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    return writeFindingStates(context, data.workspaceId, [data.fingerprint], {
      state: data.state,
      note: data.note ?? null,
      dismissReason: data.state === "dismissed" ? (data.dismissReason ?? null) : null,
    }).then(() => ({ fingerprint: data.fingerprint, state: data.state }));
  });

const DISMISS_REASON = z.enum(["false_positive", "not_relevant", "wont_fix", "handled_elsewhere"]);

async function writeFindingStates(
  context: ServerFnContext,
  workspaceId: string,
  fingerprints: string[],
  change: {
    state: "open" | "in_progress" | "dismissed";
    note: string | null;
    dismissReason: string | null;
  },
) {
  const now = new Date().toISOString();
  // Resolved findings stay resolved: only a verification scan changes them.
  const { data: resolved } = await context.supabase
    .from("geo_finding_states")
    .select("fingerprint")
    .eq("workspace_id", workspaceId)
    .eq("state", "resolved")
    .in("fingerprint", fingerprints);
  const skip = new Set((resolved ?? []).map((r) => r.fingerprint));
  const rows = fingerprints
    .filter((fp) => !skip.has(fp))
    .map((fingerprint) => ({
      workspace_id: workspaceId,
      fingerprint,
      state: change.state,
      note: change.note,
      dismiss_reason: change.dismissReason,
      resolved_via: null,
      verified_at: null,
      verification_id: null,
      updated_by: context.userId,
      updated_at: now,
    }));
  if (!rows.length) return { updated: 0, skippedResolved: skip.size };
  const { error } = await context.supabase
    .from("geo_finding_states")
    .upsert(rows, { onConflict: "workspace_id,fingerprint" });
  if (error) throw new Error(error.message);
  return { updated: rows.length, skippedResolved: skip.size };
}

/** One write for many findings (no silent caps, no partial client-side loops). */
export const bulkSetFindingStates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        fingerprints: z.array(z.string().min(3).max(800)).min(1).max(500),
        state: z.enum(["open", "in_progress", "dismissed"]),
        note: z.string().max(1000).nullable().optional(),
        dismissReason: DISMISS_REASON.nullable().optional(),
      })
      .refine(
        (v) => v.state !== "dismissed" || Boolean(v.dismissReason),
        "Choose a reason to ignore these findings",
      )
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    return writeFindingStates(context, data.workspaceId, [...new Set(data.fingerprints)], {
      state: data.state,
      note: data.note ?? null,
      dismissReason: data.state === "dismissed" ? (data.dismissReason ?? null) : null,
    });
  });

/** Mark findings reviewed (someone looked at the evidence) without changing their state. */
export const markFindingsReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        fingerprints: z.array(z.string().min(3).max(800)).min(1).max(500),
        reviewed: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const fingerprints = [...new Set(data.fingerprints)];
    const now = new Date().toISOString();
    const { data: existing, error: readError } = await context.supabase
      .from("geo_finding_states")
      .select("fingerprint, state")
      .eq("workspace_id", data.workspaceId)
      .in("fingerprint", fingerprints);
    if (readError) throw new Error(readError.message);
    const known = new Map((existing ?? []).map((r) => [r.fingerprint, r.state]));
    const review = {
      reviewed_at: data.reviewed ? now : null,
      reviewed_by: data.reviewed ? context.userId : null,
    };
    const updates = fingerprints.filter((fp) => known.has(fp));
    if (updates.length) {
      const { error } = await context.supabase
        .from("geo_finding_states")
        .update({ ...review, updated_by: context.userId, updated_at: now })
        .eq("workspace_id", data.workspaceId)
        .in("fingerprint", updates);
      if (error) throw new Error(error.message);
    }
    const inserts = fingerprints
      .filter((fp) => !known.has(fp))
      .map((fingerprint) => ({
        workspace_id: data.workspaceId,
        fingerprint,
        state: "open",
        ...review,
        updated_by: context.userId,
        updated_at: now,
      }));
    if (inserts.length) {
      const { error } = await context.supabase.from("geo_finding_states").insert(inserts);
      if (error) throw new Error(error.message);
    }
    return { updated: fingerprints.length, reviewed: data.reviewed };
  });

/* ------------------------------------------------------------------ */
/* Monitoring (scheduled rescans on scheduled_jobs)                   */
/* ------------------------------------------------------------------ */

const MONITOR_COLS =
  "id, cadence, active, next_run_at, last_run_at, last_run_status, last_run_error, meta";

function presentMonitor(row: Record<string, any>): GeoMonitor {
  return {
    id: row.id,
    url: String(row.meta?.url ?? ""),
    cadence: row.cadence === "daily" ? "daily" : "weekly",
    active: row.active === true,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? null,
    lastRunStatus: row.last_run_status ?? null,
    lastRunError: row.last_run_error ?? null,
    probes: row.meta?.probes === true,
    lastScoreDelta:
      typeof row.meta?.last_score_delta === "number" ? row.meta.last_score_delta : null,
  };
}

export const listMonitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GeoMonitor[]> => {
    const { data: rows, error } = await context.supabase
      .from("scheduled_jobs")
      .select(MONITOR_COLS)
      .eq("workspace_id", data.workspaceId)
      .eq("task_type", "geo-scan")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => presentMonitor(r as Record<string, unknown>));
  });

export const saveMonitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        id: uuid.optional(),
        url: z.string().trim().min(1).max(2000),
        cadence: z.enum(["daily", "weekly"]),
        active: z.boolean().default(true),
        probes: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<GeoMonitor> => {
    await requireEditor(context, data.workspaceId);
    const { isGeoProbesEnabled } = await import("@/lib/feature-flags");
    const probes = data.probes && isGeoProbesEnabled(data.workspaceId);
    const [{ assertPublicUrl }, { normalizeUrl }] = await Promise.all([
      import("@/server/safe-fetch"),
      import("@/lib/crawl/html"),
    ]);
    let url: URL;
    try {
      url = assertPublicUrl(normalizeUrl(data.url));
    } catch {
      throw new Error("That URL can't be monitored — use a public http(s) address.");
    }
    const host = url.hostname.replace(/^www\./, "");
    const fields = {
      title: `AI Visibility · ${host}`,
      cadence: data.cadence,
      active: data.active,
      meta: { url: url.toString(), probes } as never,
    };
    const query = data.id
      ? context.supabase
          .from("scheduled_jobs")
          .update(fields)
          .eq("id", data.id)
          .eq("workspace_id", data.workspaceId)
          .eq("task_type", "geo-scan")
      : context.supabase.from("scheduled_jobs").insert({
          ...fields,
          workspace_id: data.workspaceId,
          task_type: "geo-scan",
          agent: "scout",
          timezone: "UTC",
          // First run a few minutes out, so saving a monitor never collides with a manual scan.
          next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          created_by: context.userId,
        });
    const { data: row, error } = await query.select(MONITOR_COLS).single();
    if (error || !row) throw new Error(error?.message ?? "Couldn't save the monitor");
    return presentMonitor(row as Record<string, unknown>);
  });

export const deleteMonitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireEditor(context, data.workspaceId);
    const { error } = await context.supabase
      .from("scheduled_jobs")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspaceId)
      .eq("task_type", "geo-scan");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Settings the UI needs (plan cap, probe availability)               */
/* ------------------------------------------------------------------ */

export const getGeoSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const [{ getPlanLimits }, { isGeoProbesEnabled }] = await Promise.all([
      import("@/server/plans"),
      import("@/lib/feature-flags"),
    ]);
    const { data: ws, error } = await context.supabase
      .from("workspaces")
      .select("plan")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ws) throw new Error("Workspace not found");
    const limits = getPlanLimits(ws.plan);
    return {
      plan: limits.id,
      planLabel: limits.label,
      maxPages: limits.geoMaxPages,
      probesAvailable: isGeoProbesEnabled(data.workspaceId),
    };
  });
