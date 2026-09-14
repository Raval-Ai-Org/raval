// contracts.ts — the JSON shapes the AI Visibility API returns to the browser.
// Type-only; the server builds them in src/server/geo/present.ts and the
// UI in src/components/app/geo consumes them.

import type { ProbeSummary } from "./probes";
import type {
  Effort,
  FixSafety,
  GeoCategoryId,
  PageAnalysis,
  PageState,
  Priority,
  ScanReport,
  Severity,
} from "./types";

export type GeoScanStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type GeoScanStage = "queued" | "discovering" | "crawling" | "analyzing" | "probing" | "done";
export type GeoScanMode = "quick" | "full";
export type FindingWorkflowState = "open" | "in_progress" | "resolved" | "dismissed";

export type StoredScanReport = Omit<ScanReport, "pageScores">;

export type GeoScanView = {
  id: string;
  url: string;
  origin: string;
  host: string;
  mode: GeoScanMode;
  trigger: "manual" | "scheduled" | "rescan" | "chat";
  status: GeoScanStatus;
  stage: GeoScanStage;
  progress: {
    discovered: number;
    fetched: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  maxPages: number;
  overallScore: number | null;
  categoryScores: Partial<Record<GeoCategoryId, number>>;
  report: StoredScanReport | null;
  probes: ProbeSummary | { error: string } | null;
  probesRequested: boolean;
  previousScanId: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type GeoScanSummary = Pick<
  GeoScanView,
  | "id"
  | "url"
  | "host"
  | "mode"
  | "trigger"
  | "status"
  | "overallScore"
  | "categoryScores"
  | "createdAt"
  | "completedAt"
> & { pagesCrawled: number; findings: number };

export type GeoFindingView = {
  id: string;
  ruleId: string;
  category: GeoCategoryId;
  status: "warn" | "fail";
  severity: Severity;
  priority: Priority;
  priorityScore: number;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  pageId: string | null;
  pageUrl: string | null;
  fingerprint: string;
  pointImpact: number;
  fixId: string | null;
  safety: FixSafety;
  effort: Effort;
  state: FindingWorkflowState;
  note: string | null;
};

export type GeoPageView = {
  id: string;
  url: string;
  finalUrl: string | null;
  depth: number;
  state: PageState;
  statusCode: number | null;
  fetchMs: number | null;
  skipReason: string | null;
  score: number | null;
  categoryScores: Partial<Record<GeoCategoryId, number>>;
  issues: number;
  title: string | null;
  pageType: PageAnalysis["pageType"] | null;
};

export type GeoPageDetail = {
  page: GeoPageView;
  analysis: PageAnalysis | null;
  findings: GeoFindingView[];
};

export type GeoMonitor = {
  id: string;
  url: string;
  cadence: "daily" | "weekly";
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
};
