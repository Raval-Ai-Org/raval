// present.ts — fix proposal and verification rows → browser contracts
// (src/lib/geo/fix-contracts.ts). File contents never leave as raw "after"
// text: the browser gets the diff it needs to review the change.
import "server-only";
import type {
  ChecksSummary,
  FixBatchItem,
  FixBatchStatus,
  FixBatchView,
  FixProposalView,
  ProposalFileView,
  ProposalStatus,
  ProposalValidation,
  RuleCheckState,
  VerificationStatus,
  VerificationView,
} from "@/lib/geo/fix-contracts";

export const PROPOSAL_COLS =
  "id, workspace_id, scan_id, finding_id, fingerprint, rule_id, fix_id, page_url, site_origin, provider, connection_id, source_id, repo_full_name, repo_external_id, framework, base_branch, base_sha, head_branch, strategy, files, files_purged_at, explanation, validation, content_hash, model, status, error, commit_sha, pr_number, pr_url, pr_state, pr_merged_at, checks, last_synced_at, created_by, approved_by, approved_at, created_at, updated_at, batch_id";

export const BATCH_COLS =
  "id, workspace_id, scan_id, site_origin, host, provider, connection_id, source_id, repo_full_name, repo_external_id, framework, base_branch, base_sha, head_branch, status, progress, items, files, files_purged_at, explanation, validation, content_hash, error, commit_sha, pr_number, pr_url, pr_state, pr_merged_at, checks, last_synced_at, created_by, approved_by, approved_at, created_at, updated_at";

export const VERIFICATION_COLS =
  "id, workspace_id, proposal_id, batch_id, origin, fingerprints, rule_ids, urls, baseline_scan_id, scan_id, status, attempts, max_attempts, next_attempt_at, lease_until, locked_by, before, after, outcome_detail, created_by, created_at, updated_at, completed_at";

export type StoredProposalFile = {
  path: string;
  action: "create" | "update";
  baseBlobSha: string | null;
  after?: string;
  diff?: string;
  additions?: number;
  deletions?: number;
  explanation?: string;
};

export type ProposalRow = {
  id: string;
  workspace_id: string;
  scan_id: string | null;
  finding_id: string | null;
  fingerprint: string;
  rule_id: string;
  fix_id: string;
  page_url: string | null;
  site_origin: string;
  provider: "github";
  connection_id: string | null;
  source_id: string | null;
  repo_full_name: string | null;
  repo_external_id: string | null;
  framework: string | null;
  base_branch: string | null;
  base_sha: string | null;
  head_branch: string | null;
  strategy: string | null;
  files: StoredProposalFile[];
  files_purged_at: string | null;
  explanation: string | null;
  validation: ProposalValidation | Record<string, never>;
  content_hash: string | null;
  model: string | null;
  status: ProposalStatus;
  error: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  pr_merged_at: string | null;
  checks: ChecksSummary | null;
  last_synced_at: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  batch_id: string | null;
};

export type StoredBatchItem = Omit<FixBatchItem, "proposalStatus"> & { proposalId: string | null };

export type BatchRow = {
  id: string;
  workspace_id: string;
  scan_id: string | null;
  site_origin: string;
  host: string;
  provider: "github";
  connection_id: string | null;
  source_id: string | null;
  repo_full_name: string | null;
  repo_external_id: string | null;
  framework: string | null;
  base_branch: string | null;
  base_sha: string | null;
  head_branch: string | null;
  status: FixBatchStatus;
  progress: { total?: number; done?: number; current?: string | null };
  items: StoredBatchItem[];
  files: StoredProposalFile[];
  files_purged_at: string | null;
  explanation: string | null;
  validation: ProposalValidation | Record<string, never>;
  content_hash: string | null;
  error: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  pr_merged_at: string | null;
  checks: ChecksSummary | null;
  last_synced_at: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VerificationRow = {
  id: string;
  workspace_id: string;
  proposal_id: string | null;
  batch_id: string | null;
  origin: string;
  fingerprints: string[];
  rule_ids: string[];
  urls: string[];
  baseline_scan_id: string | null;
  scan_id: string | null;
  status: VerificationStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  locked_by: string | null;
  before: Record<string, RuleCheckState>;
  after: {
    checks?: Record<string, RuleCheckState>;
    regressions?: VerificationView["regressions"];
  };
  outcome_detail: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const GITHUB_URL = /^https:\/\/github\.com\//;

export function presentVerification(row: VerificationRow): VerificationView {
  const pending = row.status === "scheduled" || row.status === "running";
  return {
    id: row.id,
    proposalId: row.proposal_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: pending ? row.next_attempt_at : null,
    urls: row.urls ?? [],
    fingerprints: row.fingerprints ?? [],
    before: row.before ?? {},
    after: row.after?.checks ?? {},
    regressions: row.after?.regressions ?? [],
    outcomeDetail: row.outcome_detail,
    scanId: row.scan_id,
    baselineScanId: row.baseline_scan_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function presentProposal(
  row: ProposalRow,
  verification: VerificationRow | null,
): FixProposalView {
  const files: ProposalFileView[] = (row.files ?? []).map((f) => ({
    path: f.path,
    action: f.action,
    diff: row.files_purged_at ? null : (f.diff ?? null),
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    explanation: f.explanation ?? "",
  }));
  const validation =
    row.validation && "checks" in row.validation
      ? (row.validation as ProposalValidation)
      : { ok: false, checks: [] };
  return {
    id: row.id,
    status: row.status,
    fingerprint: row.fingerprint,
    ruleId: row.rule_id,
    fixId: row.fix_id,
    pageUrl: row.page_url,
    scanId: row.scan_id,
    repoFullName: row.repo_full_name,
    framework: row.framework,
    strategy: row.strategy,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    headBranch: row.head_branch,
    files,
    filesPurged: Boolean(row.files_purged_at),
    explanation: row.explanation,
    validation,
    contentHash: row.status === "draft" ? row.content_hash : null,
    model: row.model,
    error: row.error,
    commitSha: row.commit_sha,
    pr:
      row.pr_number && row.pr_url && GITHUB_URL.test(row.pr_url)
        ? {
            number: row.pr_number,
            url: row.pr_url,
            state: row.pr_state ?? "open",
            mergedAt: row.pr_merged_at,
          }
        : null,
    checks: row.checks,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    verification: verification ? presentVerification(verification) : null,
    batchId: row.batch_id ?? null,
  };
}

export function presentBatch(
  row: BatchRow,
  verification: VerificationRow | null,
  proposalStatusByFingerprint: Map<string, FixProposalView["status"]>,
): FixBatchView {
  const validation =
    row.validation && "checks" in row.validation
      ? (row.validation as ProposalValidation)
      : { ok: false, checks: [] };
  return {
    id: row.id,
    status: row.status,
    scanId: row.scan_id,
    host: row.host,
    repoFullName: row.repo_full_name,
    framework: row.framework,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    headBranch: row.head_branch,
    progress: {
      total: row.progress?.total ?? row.items.length,
      done: row.progress?.done ?? 0,
      current: row.progress?.current ?? null,
    },
    items: (row.items ?? []).map((i) => ({
      findingId: i.findingId,
      fingerprint: i.fingerprint,
      ruleId: i.ruleId,
      title: i.title,
      pageUrl: i.pageUrl,
      status: i.status,
      reason: i.reason,
      files: i.files ?? [],
      proposalStatus: proposalStatusByFingerprint.get(i.fingerprint) ?? null,
    })),
    files: (row.files ?? []).map((f) => ({
      path: f.path,
      action: f.action,
      diff: row.files_purged_at ? null : (f.diff ?? null),
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      explanation: f.explanation ?? "",
    })),
    filesPurged: Boolean(row.files_purged_at),
    explanation: row.explanation,
    validation,
    contentHash: row.status === "draft" ? row.content_hash : null,
    error: row.error,
    commitSha: row.commit_sha,
    pr:
      row.pr_number && row.pr_url && GITHUB_URL.test(row.pr_url)
        ? {
            number: row.pr_number,
            url: row.pr_url,
            state: row.pr_state ?? "open",
            mergedAt: row.pr_merged_at,
          }
        : null,
    checks: row.checks,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    verification: verification ? presentVerification(verification) : null,
  };
}
