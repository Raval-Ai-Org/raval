// store.memory.ts — in-memory GeoStore for unit tests of the scan runner.
// Mirrors the Supabase store's semantics that matter to the state machine:
// lease-guarded scan updates, unique (scan, url) pages, pending ordering.
import type { GeoFinding } from "@/lib/geo/types";
import type { AuditRunRow, GeoStore, PageRow, ScanRow } from "./store.server";

export type MemoryGeoStore = GeoStore & {
  scans: Map<string, ScanRow & Record<string, unknown>>;
  pages: Map<
    string,
    PageRow & { scan_id: string; created: number; score?: number; issues?: number }
  >;
  findings: Map<string, (GeoFinding & { pageId: string | null })[]>;
  auditRuns: AuditRunRow[];
};

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function createMemoryGeoStore(): MemoryGeoStore {
  const scans = new Map<string, ScanRow & Record<string, unknown>>();
  const pages = new Map<
    string,
    PageRow & { scan_id: string; created: number; score?: number; issues?: number }
  >();
  const findings = new Map<string, (GeoFinding & { pageId: string | null })[]>();
  const auditRuns: AuditRunRow[] = [];
  const pagesOf = (scanId: string) =>
    [...pages.values()]
      .filter((p) => p.scan_id === scanId)
      .sort((a, b) => a.depth - b.depth || a.created - b.created);

  return {
    scans,
    pages,
    findings,
    auditRuns,

    async claimScans(worker, max, leaseSeconds, scanId) {
      const now = Date.now();
      const claimable = [...scans.values()]
        .filter(
          (s) =>
            (s.status === "queued" || s.status === "running") &&
            (!scanId || s.id === scanId) &&
            (!s.lease_until || Date.parse(s.lease_until) < now),
        )
        .slice(0, max);
      for (const s of claimable) {
        s.lease_until = new Date(now + leaseSeconds * 1000).toISOString();
        s.locked_by = worker;
        s.attempt_count += 1;
        if (s.status === "queued") s.status = "running";
        s.started_at ??= new Date(now).toISOString();
      }
      return claimable.map((s) => ({ ...s }));
    },

    async getScan(scanId) {
      const s = scans.get(scanId);
      return s ? { ...s } : null;
    },

    async updateScan(scanId, worker, patch) {
      const s = scans.get(scanId);
      if (!s || s.locked_by !== worker) return false;
      Object.assign(s, patch);
      return true;
    },

    async renewLease(scanId, worker, leaseSeconds) {
      const s = scans.get(scanId);
      if (!s || s.locked_by !== worker || (s.status !== "queued" && s.status !== "running"))
        return false;
      s.lease_until = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      return true;
    },

    async insertPages(scan, list) {
      let inserted = 0;
      for (const p of list) {
        if (pagesOf(scan.id).some((x) => x.url === p.url)) continue;
        const pid = id("page");
        pages.set(pid, {
          id: pid,
          scan_id: scan.id,
          created: ++seq,
          url: p.url,
          final_url: null,
          depth: p.depth,
          state: "pending",
          status_code: null,
          content_type: null,
          fetch_ms: null,
          skip_reason: null,
          x_robots_tag: null,
          analysis: null,
        });
        inserted++;
      }
      return inserted;
    },

    async countPages(scanId) {
      const list = pagesOf(scanId);
      const n = (state: string) => list.filter((p) => p.state === state).length;
      return {
        total: list.length,
        discovered: list.length,
        pending: n("pending"),
        fetched: n("fetched"),
        failed: n("failed"),
        skipped: n("skipped"),
      };
    },

    async findPage(scanId, url) {
      return pagesOf(scanId).find((p) => p.url === url) ?? null;
    },

    async nextPending(scanId, limit) {
      return pagesOf(scanId)
        .filter((p) => p.state === "pending")
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },

    async updatePage(pageId, patch) {
      const p = pages.get(pageId);
      if (p) Object.assign(p, patch);
    },

    async skipPending(scanId, reason) {
      let n = 0;
      for (const p of pagesOf(scanId)) {
        if (p.state === "pending") {
          p.state = "skipped";
          p.skip_reason = reason;
          n++;
        }
      }
      return n;
    },

    async loadPages(scanId) {
      return pagesOf(scanId).map((p) => ({ ...p }));
    },

    async replaceFindings(scan, list) {
      findings.set(scan.id, list);
    },

    async updatePageScores(updates) {
      for (const u of updates) {
        const p = pages.get(u.id);
        if (p) Object.assign(p, { score: u.score, issues: u.issues });
      }
    },

    async findPreviousScan(workspaceId, host, before, excludeId) {
      const prev = [...scans.values()]
        .filter(
          (s) =>
            s.workspace_id === workspaceId &&
            s.host === host &&
            s.status === "succeeded" &&
            s.id !== excludeId &&
            s.created_at < before,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return prev?.id ?? null;
    },

    async recordAuditRun(row) {
      auditRuns.push(row);
    },
  };
}
