// contracts.ts — what the Proof Engine server functions return to the
// browser. Types only (plus labels); safe to import anywhere.
import type { DailyPoint } from "./analysis";
import type { ChangeType, ExperimentMetric } from "./constants";
import type { FieldValue } from "./datafile";
import type { ExperimentStatus } from "./state";
import type { Verdict } from "./verdict";

export type { ChangeType, ExperimentMetric, ExperimentStatus, Verdict, DailyPoint, FieldValue };

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  title: "Page title",
  meta_description: "Meta description",
  h1: "Main heading",
  intro: "Intro paragraph",
  faq: "FAQ section",
  cta_text: "Button text",
};

export const METRIC_LABELS: Record<ExperimentMetric, string> = {
  clicks: "Search clicks",
  impressions: "Search impressions",
  ctr: "Click-through rate",
  sessions: "Organic sessions",
  key_events: "Key events",
  revenue: "Revenue",
  ai_referral_sessions: "AI referral sessions",
};

export const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for approval",
  shipping: "Opening pull request",
  awaiting_deploy: "Waiting for deploy",
  running: "Running",
  analyzing: "Running",
  concluded: "Result ready",
  rolling_out: "Rolling out",
  rolling_back: "Rolling back",
  closed: "Closed",
  invalidated: "Stopped",
  cancelled: "Cancelled",
};

export type SetupState = {
  github: {
    connected: boolean;
    sourceId: string | null;
    repository: string | null;
    siteHost: string | null;
    ownershipVerified: boolean;
    framework: string | null;
    supportedFramework: boolean;
  };
  gsc: { connected: boolean; site: string | null; status: string | null };
  ga4: { connected: boolean; property: string | null; currency: string | null };
  /** Plain-language reasons nothing can start yet (empty when ready). */
  blockers: {
    code: string;
    message: string;
    action: "connect_github" | "verify_repo" | "connect_google" | "none";
  }[];
};

export type EligibilityView = {
  metric: ExperimentMetric;
  eligible: boolean;
  reasons: { code: string; message: string }[];
  pagesWithData: number;
  preDays: number;
  total: number;
  topShare: number;
  mde: Record<string, number | null>;
  checkedAt: string;
};

export type IntegrationState =
  | { state: "none"; reason: string | null }
  | { state: "pending"; deliveryId: string; status: string; prUrl: string | null }
  | { state: "ready"; fields: ChangeType[]; templateFiles: string[] };

export type PageGroupView = {
  id: string;
  label: string;
  pattern: string;
  pageCount: number;
  monthlyClicks: number;
  templateFile: string | null;
  detectedAt: string;
  /** Pages already in another active experiment. */
  busyPages: number;
  integration: IntegrationState;
  eligibility: Partial<Record<ExperimentMetric, EligibilityView>>;
};

export type HypothesisView = {
  changeType: ChangeType;
  title: string;
  hypothesis: string;
  why: string;
};

export type ExperimentSummary = {
  id: string;
  name: string;
  status: ExperimentStatus;
  verdict: Verdict | null;
  changeType: ChangeType;
  primaryMetric: ExperimentMetric;
  groupLabel: string | null;
  pattern: string | null;
  siteHost: string;
  createdAt: string;
  liveConfirmedAt: string | null;
  daysLive: number | null;
  lift: number | null;
  liftLow: number | null;
  liftHigh: number | null;
  earlyLift: number | null;
  estimatedMonthlyValue: number | null;
  valueCurrency: string | null;
  invalidReason: string | null;
};

export type DeliveryFileView = {
  path: string;
  action: "create" | "update";
  diff: string;
};

export type DeliveryView = {
  id: string;
  kind: "integration" | "ship" | "rollout" | "rollback";
  status: string;
  contentHash: string | null;
  baseBranch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  files: DeliveryFileView[];
  fields: ChangeType[];
  explanation: string | null;
  problems: string[];
  error: string | null;
  createdAt: string;
  approvedAt: string | null;
  mergedAt: string | null;
  liveAt: string | null;
};

export type PairView = {
  stratum: number;
  treatment: {
    path: string;
    before: string | null;
    after: FieldValue | null;
    excluded: string | null;
  };
  control: { path: string; before: string | null; excluded: string | null };
};

export type CheckpointView = { day: number; verdict: Verdict | null; reason: string };

export type ResultView = {
  asOf: string;
  preDays: number;
  postDays: number;
  pairs: number;
  lift: number | null;
  ci95: [number, number] | null;
  ciAdjusted: [number, number] | null;
  placeboP: number | null;
  daily: DailyPoint[];
  checkpoints: CheckpointView[];
  nextCheckpoint: number | null;
  extraPerMonth: number | null;
  unit: string;
  monthlyValue: number | null;
  currency: string | null;
  valueNote: string | null;
  reason: string | null;
};

export type EventView = { id: string; kind: string; summary: string; createdAt: string };

export type ExperimentDetail = ExperimentSummary & {
  hypothesis: string;
  repository: string | null;
  secondaryMetrics: ExperimentMetric[];
  prePeriod: { start: string | null; end: string | null };
  mdeEstimate: number | null;
  pairs: PairView[];
  excludedCount: number;
  deliveries: DeliveryView[];
  result: ResultView | null;
  /** Draft preparation (reading pages, splitting, writing copy). */
  prepare: { state: "running" | "ready" | "failed"; error: string | null } | null;
  events: EventView[];
  canEdit: boolean;
  /** What the viewer can do next, decided by the server. */
  actions: {
    approve: boolean;
    discard: boolean;
    cancel: boolean;
    rollout: boolean;
    rollback: boolean;
    keep: boolean;
    close: boolean;
    share: boolean;
  };
  shareSlug: string | null;
};

export type ReportBrandingView = {
  displayName: string | null;
  logoUrl: string | null;
  fallbackName: string;
};

export type ExperimentsOverview = {
  setup: SetupState;
  groups: PageGroupView[];
  experiments: ExperimentSummary[];
  limit: { max: number; used: number };
  branding: ReportBrandingView;
  canEdit: boolean;
  canManage: boolean;
  provenMonthlyValue: number | null;
  provenCurrency: string | null;
};

/** The client-facing report (share page). Report fields only. */
export type ExperimentReport = {
  name: string;
  hypothesis: string;
  siteHost: string;
  changeType: ChangeType;
  primaryMetric: ExperimentMetric;
  status: ExperimentStatus;
  verdict: Verdict | null;
  pages: { treatment: number; control: number };
  liveConfirmedAt: string | null;
  concludedAt: string | null;
  daysMeasured: number;
  lift: number | null;
  ci95: [number, number] | null;
  extraPerMonth: number | null;
  unit: string;
  monthlyValue: number | null;
  currency: string | null;
  valueNote: string | null;
  daily: DailyPoint[];
  examples: { path: string; before: string | null; after: string }[];
  branding: { name: string; logoUrl: string | null };
  generatedAt: string;
};
