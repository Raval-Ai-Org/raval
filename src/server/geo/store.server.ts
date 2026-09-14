// store.server.ts — persistence for AI Visibility scans.
//
// The scan runner talks to this interface, not to Supabase, so its state
// machine is unit-tested against an in-memory store (store.memory.ts) and runs
// in production against the service-role client below. Only the worker
// writes; user-facing reads go through RLS in src/server/fns/geo.ts.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  CrawledPage,
  GeoFinding,
  PageAnalysis,
  PageState,
  SiteArtifacts,
} from "@/lib/geo/types";

export type ScanStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ScanStage = "queued" | "discovering" | "crawling" | "analyzing" | "probing" | "done";
export type ScanMode = "quick" | "full";
export type ScanTrigger = "manual" | "scheduled" | "rescan" | "chat";

export type ScanConfig = { maxPages: number; maxDepth: number; probes: boolean };
export type ScanProgress = {
  discovered: number;
  fetched: number;
  failed: number;
  skipped: number;
  pending: number;
};

export type ScanRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  url: string;
  origin: string;
  host: string;
  mode: ScanMode;
  trigger: ScanTrigger;
  status: ScanStatus;
  stage: ScanStage;
  config: ScanConfig;
  site: SiteArtifacts | Record<string, never>;
  progress: Partial<ScanProgress>;
  overall_score: number | null;
  cancel_requested: boolean;
  attempt_count: number;
  lease_until: string | null;
  locked_by: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type PageRow = {
  id: string;
  url: string;
  final_url: string | null;
  depth: number;
  state: PageState;
  status_code: number | null;
  content_type: string | null;
  fetch_ms: number | null;
  skip_reason: string | null;
  x_robots_tag: string | null;
  analysis: PageAnalysis | null;
};

export type PagePatch = Partial<Omit<PageRow, "id" | "url" | "depth">> & { fetched_at?: string };

export type ScanPatch = Partial<{
  status: ScanStatus;
  stage: ScanStage;
  origin: string;
  host: string;
  site: SiteArtifacts;
  progress: Partial<ScanProgress>;
  overall_score: number | null;
  category_scores: Record<string, number>;
  report: unknown;
  probes: unknown;
  previous_scan_id: string | null;
  error: string | null;
  lease_until: string | null;
  locked_by: string | null;
  completed_at: string | null;
}>;

export type AuditRunRow = {
  workspace_id: string;
  url: string;
  score: number;
  subscores: Record<string, number>;
  meta: Record<string, unknown>;
  created_by: string | null;
};

export interface GeoStore {
  claimScans(
    worker: string,
    max: number,
    leaseSeconds: number,
    scanId?: string,
  ): Promise<ScanRow[]>;
  getScan(scanId: string): Promise<ScanRow | null>;
  /** Writes only while `worker` still holds the lease; false when it was lost. */
  updateScan(scanId: string, worker: string, patch: ScanPatch): Promise<boolean>;
  renewLease(scanId: string, worker: string, leaseSeconds: number): Promise<boolean>;
  insertPages(scan: ScanRow, pages: { url: string; depth: number }[]): Promise<number>;
  countPages(scanId: string): Promise<ScanProgress & { total: number }>;
  findPage(scanId: string, url: string): Promise<PageRow | null>;
  nextPending(scanId: string, limit: number): Promise<PageRow[]>;
  updatePage(pageId: string, patch: PagePatch): Promise<void>;
  skipPending(scanId: string, reason: string): Promise<number>;
  loadPages(scanId: string): Promise<PageRow[]>;
  replaceFindings(
    scan: ScanRow,
    findings: (GeoFinding & { pageId: string | null })[],
  ): Promise<void>;
  updatePageScores(
    updates: {
      id: string;
      score: number;
      categoryScores: Record<string, number>;
      issues: number;
    }[],
  ): Promise<void>;
  findPreviousScan(
    workspaceId: string,
    host: string,
    before: string,
    excludeId: string,
  ): Promise<string | null>;
  recordAuditRun(row: AuditRunRow): Promise<void>;
}

export function pageRowToCrawled(row: PageRow): CrawledPage {
  return {
    url: row.url,
    finalUrl: row.final_url,
    depth: row.depth,
    state: row.state,
    statusCode: row.status_code,
    contentType: row.content_type,
    fetchMs: row.fetch_ms,
    skipReason: row.skip_reason,
    xRobotsTag: row.x_robots_tag,
    analysis: row.analysis,
  };
}

const PAGE_COLS =
  "id, url, final_url, depth, state, status_code, content_type, fetch_ms, skip_reason, x_robots_tag, analysis";
const SCAN_COLS =
  "id, workspace_id, created_by, url, origin, host, mode, trigger, status, stage, config, site, progress, overall_score, cancel_requested, attempt_count, lease_until, locked_by, error, created_at, started_at, completed_at";

const asJson = (v: unknown) => v as Json;

/** Supabase implementation (service role — bypasses RLS; callers authorize). */
export function createSupabaseGeoStore(db: SupabaseClient<Database>): GeoStore {
  return {
    async claimScans(worker, max, leaseSeconds, scanId) {
      const { data, error } = await db.rpc("claim_geo_scans", {
        p_worker: worker,
        p_max: max,
        p_lease_seconds: leaseSeconds,
        ...(scanId ? { p_scan_id: scanId } : {}),
      });
      if (error) throw new Error(`claim_geo_scans failed: ${error.message}`);
      return (data ?? []) as unknown as ScanRow[];
    },

    async getScan(scanId) {
      const { data, error } = await db
        .from("geo_scans")
        .select(SCAN_COLS)
        .eq("id", scanId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as ScanRow) ?? null;
    },

    async updateScan(scanId, worker, patch) {
      const { data, error } = await db
        .from("geo_scans")
        .update(patch as never)
        .eq("id", scanId)
        .eq("locked_by", worker)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async renewLease(scanId, worker, leaseSeconds) {
      const { data, error } = await db
        .from("geo_scans")
        .update({ lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString() })
        .eq("id", scanId)
        .eq("locked_by", worker)
        .in("status", ["queued", "running"])
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async insertPages(scan, pages) {
      if (!pages.length) return 0;
      const rows = pages.map((p) => ({
        scan_id: scan.id,
        workspace_id: scan.workspace_id,
        url: p.url,
        depth: p.depth,
      }));
      const { data, error } = await db
        .from("geo_scan_pages")
        .upsert(rows, { onConflict: "scan_id,url", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async countPages(scanId) {
      const count = async (state?: PageState) => {
        let q = db
          .from("geo_scan_pages")
          .select("id", { count: "exact", head: true })
          .eq("scan_id", scanId);
        if (state) q = q.eq("state", state);
        const { count: n, error } = await q;
        if (error) throw new Error(error.message);
        return n ?? 0;
      };
      const [total, pending, fetched, failed, skipped] = await Promise.all([
        count(),
        count("pending"),
        count("fetched"),
        count("failed"),
        count("skipped"),
      ]);
      return { total, discovered: total, pending, fetched, failed, skipped };
    },

    async findPage(scanId, url) {
      const { data, error } = await db
        .from("geo_scan_pages")
        .select(PAGE_COLS)
        .eq("scan_id", scanId)
        .eq("url", url)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as PageRow) ?? null;
    },

    async nextPending(scanId, limit) {
      const { data, error } = await db
        .from("geo_scan_pages")
        .select(PAGE_COLS)
        .eq("scan_id", scanId)
        .eq("state", "pending")
        .order("depth", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PageRow[];
    },

    async updatePage(pageId, patch) {
      const { error } = await db
        .from("geo_scan_pages")
        .update({
          ...patch,
          analysis: patch.analysis === undefined ? undefined : asJson(patch.analysis),
        } as never)
        .eq("id", pageId);
      if (error) throw new Error(error.message);
    },

    async skipPending(scanId, reason) {
      const { data, error } = await db
        .from("geo_scan_pages")
        .update({ state: "skipped", skip_reason: reason })
        .eq("scan_id", scanId)
        .eq("state", "pending")
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },

    async loadPages(scanId) {
      const out: PageRow[] = [];
      const pageSize = 200;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await db
          .from("geo_scan_pages")
          .select(PAGE_COLS)
          .eq("scan_id", scanId)
          .order("depth", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        out.push(...((data ?? []) as unknown as PageRow[]));
        if (!data || data.length < pageSize) break;
      }
      return out;
    },

    async replaceFindings(scan, findings) {
      const { error: delError } = await db.from("geo_findings").delete().eq("scan_id", scan.id);
      if (delError) throw new Error(delError.message);
      for (let i = 0; i < findings.length; i += 500) {
        const rows = findings.slice(i, i + 500).map((f) => ({
          scan_id: scan.id,
          workspace_id: scan.workspace_id,
          page_id: f.pageId,
          page_url: f.pageUrl,
          rule_id: f.ruleId,
          category: f.category,
          status: f.status,
          severity: f.severity,
          priority: f.priority,
          priority_score: f.priorityScore,
          title: f.title,
          detail: f.detail.slice(0, 2000),
          evidence: asJson(f.evidence),
          fingerprint: f.fingerprint,
          point_impact: f.pointImpact,
          fix_id: f.fixId,
          safety: f.safety,
          effort: f.effort,
        }));
        const { error } = await db.from("geo_findings").insert(rows);
        if (error) throw new Error(error.message);
      }
    },

    async updatePageScores(updates) {
      // Small, bounded fan-out: ≤ plan page cap, a few at a time.
      for (let i = 0; i < updates.length; i += 20) {
        await Promise.all(
          updates.slice(i, i + 20).map(async (u) => {
            const { error } = await db
              .from("geo_scan_pages")
              .update({
                score: u.score,
                category_scores: asJson(u.categoryScores),
                issues: u.issues,
              })
              .eq("id", u.id);
            if (error) throw new Error(error.message);
          }),
        );
      }
    },

    async findPreviousScan(workspaceId, host, before, excludeId) {
      const { data, error } = await db
        .from("geo_scans")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("host", host)
        .eq("status", "succeeded")
        .neq("id", excludeId)
        .lt("created_at", before)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },

    async recordAuditRun(row) {
      const { error } = await db.from("geo_audit_runs").insert({
        workspace_id: row.workspace_id,
        url: row.url,
        score: row.score,
        subscores: asJson(row.subscores),
        meta: asJson(row.meta),
        created_by: row.created_by,
      });
      if (error) throw new Error(error.message);
    },
  };
}
