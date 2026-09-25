// fix-contracts.ts — the JSON shapes of the AI Visibility fix workflow
// (finding → proposal → pull request → verification). Type-only and
// browser-safe; built by src/server/geo/fixes/present.ts.

import type { ConnectionView, SourceView } from "@/lib/connectors/types";

/**
 * How a finding can be fixed. `github_pr` / `cms_apply` only when Mellox can
 * really write the change (a pull request, or a direct WordPress/Webflow edit).
 */
export type FixMethod = "github_pr" | "cms_apply" | "manual";

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
  | "manual_only"
  /** Webflow is connected without permission to edit the site. */
  | "cms_reconnect"
  /** A CMS is connected but the live site isn't proven to be it. */
  | "cms_unverified";

/** Which connected platform builds the scanned website, as the person sees it. */
export type SiteBindingView = {
  provider: SiteProviderId;
  /** Repository full name, WordPress site URL or Webflow site name. */
  name: string;
  verified: boolean;
  proof: string;
  /** WordPress: where head tags are written. */
  seoBackend: "mellox" | "rankmath" | "jetpack" | "none" | null;
  /** WordPress: the Mellox GEO plugin version when installed. */
  pluginVersion: string | null;
  /** Webflow: write scopes missing from the grant. */
  missingWriteScopes: string[];
  /** The live site shows a "coming soon" placeholder to visitors and crawlers. */
  placeholder: boolean;
};

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
  | "access_lost"
  /** CMS: written to the live site, verification pending. */
  | "applied"
  /** CMS: undone by a person. */
  | "rolled_back";

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

/** Which platform a fix changes: a repository (pull request) or a CMS (direct write). */
export type SiteProviderId = "github" | "wordpress" | "webflow";

/** One field a CMS fix changes, as the person reviews it. */
export type CmsChangeView = {
  label: string;
  /** "WordPress post #12", "Webflow page" … */
  target: string;
  before: string;
  after: string;
  reason: string;
  /** code = JSON-LD, robots.txt, HTML: shown monospaced. */
  format: "text" | "code";
};

/** A value Mellox prepared that the person pastes where the platform's API can't reach. */
export type AssistedStepView = { label: string; where: string; value: string; why: string };

export type CmsProposalView = {
  changes: CmsChangeView[];
  assisted: AssistedStepView[];
  appliedAt: string | null;
  rolledBackAt: string | null;
  /** Undo is offered once applied, until someone edits the fields again. */
  canUndo: boolean;
  /** Webflow: applying publishes the site, which also publishes other staged edits. */
  publishesSite: boolean;
};

export type FixProposalView = {
  id: string;
  status: ProposalStatus;
  provider: SiteProviderId;
  cms: CmsProposalView | null;
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
  provider: SiteProviderId;
  /** The platform that builds this site (null when nothing is connected). */
  site: SiteBindingView | null;
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
  /** The platform proven to serve this website; decides pull request vs direct change. */
  platform: SiteProviderId | null;
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

/* ───────────────────────── site connections (the platform picker) ───────────────────────── */

export type SiteConnectionState =
  /** Connected and proven to serve this website. */
  | "serves_site"
  /** Connected; the link to this website still needs a check. */
  | "needs_check"
  /** Connected, but to a different site (or no site chosen yet). */
  | "connected_other"
  | "not_connected"
  /** This Mellox server can't use the provider (missing configuration). */
  | "unavailable";

export type SiteConnectionTile = {
  provider: SiteProviderId;
  state: SiteConnectionState;
  /** One plain sentence about this provider for this website. */
  detail: string;
  /** The connected site or repository, when there is one. */
  siteName: string | null;
  /** The live page says this platform builds the website. */
  detected: boolean;
};

export type SiteConnections = {
  host: string;
  /** The provider Mellox will use for this website (a proven connection), if any. */
  active: SiteProviderId | null;
  /** The platform the live page identifies (WordPress / Webflow), if any. */
  detected: SiteProviderId | null;
  tiles: SiteConnectionTile[];
  canManage: boolean;
};

/* ───────────────────────── Fix all on WordPress / Webflow ───────────────────────── */

export type CmsFixAllItem = {
  findingId: string;
  title: string;
  pageUrl: string | null;
  priority: string;
  run: {
    id: string;
    status: string;
    statusDetail: string | null;
    /** Ready to apply: the exact changes and the hash that approval binds. */
    proposalId: string | null;
    contentHash: string | null;
    changes: CmsChangeView[];
    publishesSite: boolean;
    assistedCount: number;
    applied: boolean;
  } | null;
};

export type CmsFixAllView = {
  scanId: string;
  host: string;
  provider: "wordpress" | "webflow";
  items: CmsFixAllItem[];
  /** Findings of the same kind left for a later run (one change per field and page at a time). */
  deferred: number;
  maxFindings: number;
  canPropose: boolean;
};
