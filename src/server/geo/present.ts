// present.ts — database rows → API contracts (src/lib/geo/contracts.ts).
import "server-only";
import { strategyForRule } from "./fixes/strategies";
import type {
  DismissReason,
  FindingResolution,
  FindingWorkflowState,
  GeoFindingView,
  GeoPageView,
  GeoScanSummary,
  GeoScanView,
} from "@/lib/geo/contracts";

export const SCAN_VIEW_COLS =
  "id, workspace_id, url, origin, host, mode, trigger, status, stage, config, progress, overall_score, category_scores, report, probes, previous_scan_id, error, cancel_requested, lease_until, created_at, started_at, completed_at";

export const SCAN_SUMMARY_COLS =
  "id, url, host, mode, trigger, status, overall_score, category_scores, created_at, completed_at, counts:report->counts";

export const FINDING_COLS =
  "id, rule_id, category, status, severity, priority, priority_score, title, detail, evidence, page_id, page_url, fingerprint, point_impact, fix_id, safety, effort";

export const PAGE_LIST_COLS =
  "id, url, final_url, depth, state, status_code, fetch_ms, skip_reason, score, category_scores, issues, title:analysis->>title, page_type:analysis->>pageType";

type Row = Record<string, any>;

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" ? v : v == null ? fallback : Number(v);

export function presentScan(row: Row): GeoScanView {
  const progress = (row.progress ?? {}) as Row;
  const config = (row.config ?? {}) as Row;
  return {
    id: row.id,
    url: row.url,
    origin: row.origin,
    host: row.host,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    stage: row.stage,
    progress: {
      discovered: num(progress.discovered),
      fetched: num(progress.fetched),
      failed: num(progress.failed),
      skipped: num(progress.skipped),
      pending: num(progress.pending),
      rendered: num(progress.rendered),
      renderNeeded: num(progress.renderNeeded),
    },
    maxPages: num(config.maxPages, 1),
    overallScore: row.overall_score ?? null,
    categoryScores: row.category_scores ?? {},
    report: row.report ?? null,
    probes: row.probes ?? null,
    probesRequested: config.probes === true,
    previousScanId: row.previous_scan_id ?? null,
    error: row.error ?? null,
    cancelRequested: row.cancel_requested === true,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

export function presentSummary(row: Row): GeoScanSummary {
  const counts = (row.counts ?? {}) as Row;
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    overallScore: row.overall_score ?? null,
    categoryScores: row.category_scores ?? {},
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
    pagesCrawled: num(counts.pagesCrawled),
    findings: num(counts.findings),
  };
}

export type FindingStateRecord = {
  state: FindingWorkflowState;
  note: string | null;
  resolution: FindingResolution;
  verifiedAt: string | null;
  reopenedAt: string | null;
  dismissReason?: DismissReason | null;
  reviewedAt?: string | null;
};

export function presentFinding(row: Row, states: Map<string, FindingStateRecord>): GeoFindingView {
  const state = states.get(row.fingerprint);
  const strategy = strategyForRule(row.rule_id);
  return {
    id: row.id,
    ruleId: row.rule_id,
    category: row.category,
    status: row.status,
    severity: row.severity,
    priority: row.priority,
    priorityScore: num(row.priority_score),
    title: row.title,
    detail: row.detail,
    evidence: row.evidence ?? {},
    pageId: row.page_id ?? null,
    pageUrl: row.page_url ?? null,
    fingerprint: row.fingerprint,
    pointImpact: num(row.point_impact),
    fixId: row.fix_id ?? null,
    safety: row.safety,
    effort: row.effort,
    state: state?.state ?? "open",
    note: state?.note ?? null,
    resolution: state?.state === "resolved" ? (state.resolution ?? "manual_legacy") : null,
    verifiedAt: state?.verifiedAt ?? null,
    reopenedAt: state?.reopenedAt ?? null,
    dismissReason: state?.state === "dismissed" ? (state.dismissReason ?? null) : null,
    reviewedAt: state?.reviewedAt ?? null,
    fixMode: strategy.mode,
    verifyScope: strategy.verifyScope,
  };
}

export function presentPage(row: Row): GeoPageView {
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url ?? null,
    depth: num(row.depth),
    state: row.state,
    statusCode: row.status_code ?? null,
    fetchMs: row.fetch_ms ?? null,
    skipReason: row.skip_reason ?? null,
    score: row.score ?? null,
    categoryScores: row.category_scores ?? {},
    issues: num(row.issues),
    title: row.title ?? row.analysis?.title ?? null,
    pageType: row.page_type ?? row.analysis?.pageType ?? null,
  };
}
