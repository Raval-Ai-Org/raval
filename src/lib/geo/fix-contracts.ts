// fix-contracts.ts — the JSON shapes of the AI Visibility fix workflow
// (finding → proposal → pull request → verification). Type-only and
// browser-safe; built by src/server/geo/fixes/present.ts.

import type { ConnectionView, SourceView } from "@/lib/connectors/types";

/** How a finding can be fixed. `github_pr` only when Mellox can really write the change. */
export type FixMethod = "github_pr" | "manual";

/** What's missing before Mellox can propose a pull request for a finding. */
export type FixRequirement =
  /** Everything is in place: generate a proposal. */
  | "ready"
  /** The server has no GitHub App configured. */
  | "not_configured"
  /** No GitHub connection in this workspace. */
  | "connect"
  /** The connection was revoked or suspended on GitHub. */
  | "reconnect"
  /** Connected, but no repository is linked to this website yet. */
  | "select_repository"
  /** The linked repository is no longer accessible. */
  | "access_lost"
  /** Mellox hasn't yet proven that the linked repository builds this website. */
  | "verify_ownership"
  /** The evidence says the linked repository does not build this website. */
  | "ownership_mismatch"
  /** The repository's framework or layout can't be edited safely for this fix. */
  | "unsupported"
  /** This finding has no automated fix (manual steps only). */
  | "manual_only";

export type ProposalStatus =
  | "draft"
  | "applying"
  | "pr_open"
  | "merged"
  | "closed"
  | "verifying"
  | "verified"
  | "not_verified"
  | "failed"
  | "discarded"
  | "stale"
  | "access_lost";

export type ValidationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "skipped";
  detail: string;
};

export type ProposalValidation = { ok: boolean; checks: ValidationCheck[] };

export type ProposalFileView = {
  path: string;
  action: "create" | "update";
  /** Unified diff of before → after. Null once retention purged the contents. */
  diff: string | null;
  additions: number;
  deletions: number;
  explanation: string;
};

export type ChecksSummary =
  | { available: false; reason: "permission" | "error"; checkedAt: string }
  | {
      available: true;
      checkedAt: string;
      state: "pending" | "success" | "failure" | "none";
      total: number;
      passed: number;
      failed: number;
      pending: number;
      runs: { name: string; status: string; conclusion: string | null; url: string | null }[];
    };

export type RuleCheckState = {
  /** pass / warn / fail / na on the verified page, or "missing" when the page couldn't be analysed. */
  status: "pass" | "warn" | "fail" | "na" | "missing";
  detail: string;
  pageUrl: string | null;
};

export type VerificationStatus =
  "scheduled" | "running" | "verified" | "not_verified" | "failed" | "cancelled";

export type VerificationView = {
  id: string;
  proposalId: string | null;
  status: VerificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  urls: string[];
  fingerprints: string[];
  before: Record<string, RuleCheckState>;
  after: Record<string, RuleCheckState>;
  /** Findings on the verified pages that the baseline scan didn't have. */
  regressions: { fingerprint: string; ruleId: string; title: string; pageUrl: string | null }[];
  outcomeDetail: string | null;
  scanId: string | null;
  baselineScanId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type FixProposalView = {
  id: string;
  status: ProposalStatus;
  fingerprint: string;
  ruleId: string;
  fixId: string;
  pageUrl: string | null;
  scanId: string | null;
  repoFullName: string | null;
  framework: string | null;
  strategy: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  headBranch: string | null;
  files: ProposalFileView[];
  filesPurged: boolean;
  explanation: string | null;
  validation: ProposalValidation;
  /** Binds approval to exactly these contents. */
  contentHash: string | null;
  model: string | null;
  error: string | null;
  commitSha: string | null;
  pr: {
    number: number;
    url: string;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
  } | null;
  checks: ChecksSummary | null;
  lastSyncedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  verification: VerificationView | null;
  /** Set when this fix is part of a "Fix all" pull request (approved there). */
  batchId: string | null;
};

export type FixTargetPreview = {
  strategy: "static_file" | "code_edit";
  scope: "page" | "site";
  files: { path: string; action: "create" | "update" }[];
  reason: string;
};

export type FixAvailability = {
  fingerprint: string;
  ruleId: string;
  fixId: string | null;
  method: FixMethod;
  requirement: FixRequirement;
  /** Plain-language explanation of the requirement. */
  reason: string;
  provider: "github";
  configured: boolean;
  connection: ConnectionView | null;
  source: SourceView | null;
  /** Other repositories linked in this workspace (to pick a different one). */
  sources: SourceView[];
  target: FixTargetPreview | null;
  canManageConnections: boolean;
  canPropose: boolean;
  proposal: FixProposalView | null;
  verifications: VerificationView[];
};

/** GitHub setup state for a website, shared by single fixes and "Fix all". */
export type FixSetup = Pick<
  FixAvailability,
  | "requirement"
  | "reason"
  | "configured"
  | "connection"
  | "source"
  | "sources"
  | "canManageConnections"
  | "canPropose"
>;

export type FixBatchStatus =
  | "generating"
  | "draft"
  | "applying"
  | "pr_open"
  | "merged"
  | "verifying"
  | "completed"
  | "closed"
  | "failed"
  | "discarded"
  | "stale"
  | "access_lost";

export type FixBatchItem = {
  findingId: string;
  fingerprint: string;
  ruleId: string;
  title: string;
  pageUrl: string | null;
  /** generated = included in the pull request; skipped / failed carry a reason. */
  status: "pending" | "generated" | "skipped" | "failed";
  reason: string | null;
  files: string[];
  /** Live status of this finding's fix after the PR is opened. */
  proposalStatus: ProposalStatus | null;
};

export type FixBatchView = {
  id: string;
  status: FixBatchStatus;
  scanId: string | null;
  host: string;
  repoFullName: string | null;
  framework: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  headBranch: string | null;
  progress: { total: number; done: number; current: string | null };
  items: FixBatchItem[];
  files: ProposalFileView[];
  filesPurged: boolean;
  explanation: string | null;
  validation: ProposalValidation;
  /** Binds the single approval to exactly these combined contents. */
  contentHash: string | null;
  error: string | null;
  commitSha: string | null;
  pr: {
    number: number;
    url: string;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
  } | null;
  checks: ChecksSummary | null;
  lastSyncedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  verification: VerificationView | null;
};

export type FixAllPreflight = {
  scanId: string;
  host: string;
  origin: string;
  setup: FixSetup;
  /** Findings Mellox can try to fix automatically, highest priority first. */
  fixable: {
    findingId: string;
    fingerprint: string;
    ruleId: string;
    title: string;
    pageUrl: string | null;
    priority: string;
  }[];
  /** Open findings that need manual work. */
  manualCount: number;
  /** Findings that already have a fix in progress. */
  inProgressCount: number;
  maxFindings: number;
  /** The live or most recent "Fix all" run for this website. */
  batch: FixBatchView | null;
};
