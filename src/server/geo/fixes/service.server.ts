// service.server.ts — the AI Visibility fix workflow:
//
//   availability   what a finding needs before Mellox can propose a PR
//   preview        repository, branch, framework and the files a fix touches
//   propose        read files → generate change → validate → store a draft
//   approve+apply  exact-content approval → mellox/ branch → commit → PR
//   sync           pull request + CI state; a merge schedules verification
//   discard        drop a draft, or close Mellox's PR and delete its branch
//   verify         a targeted rescan decides whether the finding is resolved
//
// Callers (src/server/fns/geo-fixes.ts) authenticate and check roles. Rows are
// read through the caller's RLS client first, so ids from another workspace
// aren't found; writes use the service role. Nothing here merges a pull
// request, writes to a base branch, or marks a finding resolved.
import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import type { Json } from "@/integrations/supabase/types";
import { ownershipIsCurrent } from "@/lib/connectors/ownership";
import type { ConnectionView, SourceView } from "@/lib/connectors/types";
import type {
  FixAvailability,
  FixProposalView,
  FixTargetPreview,
  RuleCheckState,
} from "@/lib/geo/fix-contracts";
import type { PageAnalysis, SiteArtifacts } from "@/lib/geo/types";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import {
  GitHubAccessError,
  GitHubRateLimitError,
  GitHubRequestError,
} from "@/server/connectors/github/api.server";
import { getGitHubConfigCheck } from "@/server/connectors/github/config.server";
import {
  closePullRequest,
  commitToNewBranch,
  contentHash,
  createPullRequest,
  deleteMelloxBranch,
  getBranch,
  getChecks,
  getPullRequest,
  getTreePaths,
  GitOperationError,
  listBranches,
  readFile,
  type PullRequestInfo,
} from "@/server/connectors/github/git.server";
import { detectFramework } from "@/server/connectors/github/inspect";
import { isValidBaseBranch, proposalBranchName } from "@/server/connectors/github/paths";
import { withAccess } from "@/server/connectors/github/service.server";
import {
  CONNECTION_COLS,
  presentConnection,
  presentSource,
  SOURCE_COLS,
  type ConnectionRow,
  type SourceRow,
} from "@/server/connectors/present";
import { generateChange, type PageFacts } from "./generate.server";
import {
  presentProposal,
  presentVerification,
  PROPOSAL_COLS,
  VERIFICATION_COLS,
  type ProposalRow,
  type StoredProposalFile,
  type VerificationRow,
} from "./present";
import { fixKindForRule, frameworkKind, planFixTarget, type TargetPlan } from "./targets";
import { isAgentFixable } from "./strategies";
import { cmsFieldsForRule } from "@/lib/geo/cms-fixes";
import { geoAgentEnabled } from "@/server/geo/agents/flags";
import type { CrawledPageFacts } from "./text-artifacts";
import { validateProposal } from "./validate";
import { kickVerification, scheduleVerification, verifyDelaysMinutes } from "./verify.server";

export class FixWorkflowError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "FixWorkflowError";
  }
}

export type FixContext = {
  supabase: UserSupabaseClient;
  userId: string;
  workspaceId: string;
  canPropose: boolean;
  canManage: boolean;
};

const LIVE_PROPOSAL = ["draft", "applying", "pr_open", "merged", "verifying", "applied"];
const SYNC_AFTER_MS = 2 * 60_000;

/* ───────────────────────── loading ───────────────────────── */

type FindingRow = {
  id: string;
  scan_id: string;
  rule_id: string;
  fix_id: string | null;
  fingerprint: string;
  page_url: string | null;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  status: "warn" | "fail";
};

type ScanInfo = { id: string; host: string; origin: string; site: SiteArtifacts; status: string };

async function loadFinding(
  ctx: FixContext,
  findingId: string,
): Promise<{ finding: FindingRow; scan: ScanInfo }> {
  const { data, error } = await ctx.supabase
    .from("geo_findings")
    .select("id, scan_id, rule_id, fix_id, fingerprint, page_url, title, detail, evidence, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", findingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Finding not found", 404);
  const { data: scan, error: scanError } = await ctx.supabase
    .from("geo_scans")
    .select("id, host, origin, site, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", data.scan_id)
    .maybeSingle();
  if (scanError) throw new Error(scanError.message);
  if (!scan) throw new FixWorkflowError("Scan not found", 404);
  return {
    finding: data as unknown as FindingRow,
    scan: scan as unknown as ScanInfo,
  };
}

export async function loadConnectors(ctx: FixContext) {
  const [connections, sources] = await Promise.all([
    ctx.supabase
      .from("workspace_connections")
      .select(CONNECTION_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("provider", "github")
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("workspace_sources")
      .select(SOURCE_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("provider", "github")
      .order("created_at", { ascending: false }),
  ]);
  if (connections.error) throw new Error(connections.error.message);
  if (sources.error) throw new Error(sources.error.message);
  return {
    connections: (connections.data ?? []) as unknown as ConnectionRow[],
    sources: (sources.data ?? []) as unknown as SourceRow[],
  };
}

export async function loadSourceWithConnection(ctx: FixContext, sourceId: string) {
  const { connections, sources } = await loadConnectors(ctx);
  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new FixWorkflowError("Repository not found", 404);
  const connection = connections.find((c) => c.id === source.connection_id);
  if (!connection) throw new FixWorkflowError("GitHub connection not found", 404);
  if (connection.status === "revoked" || connection.status === "suspended") {
    throw new FixWorkflowError(
      connection.status === "revoked"
        ? "GitHub access was revoked. Reconnect GitHub in Settings → Connections."
        : "The GitHub installation is suspended. Unsuspend it on GitHub, then verify the connection.",
      409,
    );
  }
  if (source.status === "access_lost") {
    throw new FixWorkflowError(
      `Mellox lost access to ${source.full_name}. Re-grant it on GitHub, then verify the connection.`,
      409,
    );
  }
  return { source, connection };
}

async function latestVerifications(
  ctx: FixContext,
  fingerprint: string,
): Promise<VerificationRow[]> {
  const { data, error } = await ctx.supabase
    .from("geo_verifications")
    .select(VERIFICATION_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .contains("fingerprints", [fingerprint])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VerificationRow[];
}

async function proposalView(row: ProposalRow): Promise<FixProposalView> {
  const { data } = await supabaseAdmin
    .from("geo_verifications")
    .select(VERIFICATION_COLS)
    .eq("proposal_id", row.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return presentProposal(row, (data as unknown as VerificationRow) ?? null);
}

/** Map GitHub / git failures to messages a person can act on. */
export function describeGitError(error: unknown): string {
  if (error instanceof GitOperationError) return error.message;
  if (error instanceof GitHubRateLimitError) return error.message;
  if (error instanceof GitHubAccessError) {
    return error.reason === "not_found"
      ? "GitHub couldn't find the repository or branch — access may have been removed."
      : error.reason === "suspended"
        ? "The GitHub installation is suspended."
        : "Mellox's GitHub App doesn't have permission for this. Check that it can write contents and pull requests on this repository.";
  }
  if (error instanceof GitHubRequestError) {
    if (/protected branch|required status/i.test(error.githubMessage)) {
      return "GitHub refused the change because of branch protection rules.";
    }
    if (/pull request already exists/i.test(error.githubMessage)) {
      return "A pull request for this branch already exists.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "GitHub request failed";
}

/* ───────────────────────── availability ───────────────────────── */

export function normHost(host: string | null) {
  return (host ?? "").toLowerCase().replace(/^www\./, "");
}

/** The source is linked to `host` and a current ownership check proved it builds that host. */
export function sourceOwnsHost(source: SourceRow, host: string): boolean {
  return (
    normHost(source.site_host) === normHost(host) &&
    ownershipIsCurrent({
      status: source.ownership_status,
      checkedHost: source.ownership_site_host,
      checkedAt: source.ownership_checked_at,
      siteHost: host,
    })
  );
}

/** Refuse repository writes for a source that isn't proven to build `host`. */
export function assertSourceOwnsHost(source: SourceRow, host: string) {
  if (normHost(source.site_host) !== normHost(host)) {
    throw new FixWorkflowError(
      `${source.full_name} is linked to ${source.site_host ?? "no website"}, not ${host}. Link the repository to this website first.`,
      409,
    );
  }
  if (!sourceOwnsHost(source, host)) {
    throw new FixWorkflowError(
      source.ownership_status === "mismatch"
        ? `The evidence says ${source.full_name} doesn't build ${host}. Mellox won't change it.`
        : `Mellox hasn't verified that ${source.full_name} builds ${host} (or the check is out of date). Verify the repository first.`,
      409,
    );
  }
}

export async function getFixAvailability(
  ctx: FixContext,
  findingId: string,
): Promise<FixAvailability> {
  const { finding, scan } = await loadFinding(ctx, findingId);
  const [{ connections, sources }, proposals, verifications] = await Promise.all([
    loadConnectors(ctx),
    ctx.supabase
      .from("geo_fix_proposals")
      .select(PROPOSAL_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("fingerprint", finding.fingerprint)
      .order("created_at", { ascending: false })
      .limit(1),
    latestVerifications(ctx, finding.fingerprint),
  ]);
  if (proposals.error) throw new Error(proposals.error.message);
  let proposalRow = ((proposals.data ?? [])[0] as unknown as ProposalRow) ?? null;
  if (proposalRow) proposalRow = await maybeSync(proposalRow);

  const check = getGitHubConfigCheck();
  const configured = check.ok && check.config.installVerification !== "unavailable";
  const kind = fixKindForRule(finding.rule_id);
  const liveConnections = connections.filter((c) => c.status !== "revoked");
  const connection =
    liveConnections.find((c) => c.status === "active") ??
    liveConnections[0] ??
    connections[0] ??
    null;
  const siteSources = sources.filter((s) => normHost(s.site_host) === normHost(scan.host));
  const source = siteSources.find((s) => s.status === "active") ?? siteSources[0] ?? null;

  const { resolveSite, bindingView } = await import("@/server/sites/resolve.server");
  const resolution = await resolveSite(ctx.workspaceId, scan.host, { live: true }).catch(
    () => null,
  );
  const binding = resolution?.binding ?? null;
  const base = {
    fingerprint: finding.fingerprint,
    ruleId: finding.rule_id,
    fixId: finding.fix_id,
    provider: (binding?.provider ?? "github") as FixAvailability["provider"],
    site: binding
      ? bindingView(binding, resolution?.placeholder)
      : (resolution?.candidates
          .map((c) => bindingView(c, resolution.placeholder))
          .find((c) => c.provider !== "github") ?? null),
    configured,
    connection: connection ? presentConnection(connection) : null,
    source: source ? presentSource(source) : null,
    sources: sources.map((s) => presentSource(s)),
    target: null as FixTargetPreview | null,
    canManageConnections: ctx.canManage,
    canPropose: ctx.canPropose,
    proposal: proposalRow ? await proposalView(proposalRow) : null,
    verifications: verifications.map(presentVerification),
  };

  // WordPress / Webflow: the change is written through the platform's API.
  const cmsCandidate =
    binding && binding.provider !== "github"
      ? binding
      : !binding && !source
        ? (resolution?.candidates.find((c) => c.provider !== "github") ?? null)
        : null;
  if (cmsCandidate) {
    const name = cmsCandidate.provider === "webflow" ? "Webflow" : "WordPress";
    const cmsResult = (
      req: FixAvailability["requirement"],
      reason: string,
      method: FixAvailability["method"] = "cms_apply",
    ): FixAvailability => ({ ...base, method, requirement: req, reason });
    if (!cmsFieldsForRule(finding.rule_id).length)
      return cmsResult(
        "manual_only",
        "This finding needs changes Mellox can't make safely on its own. Follow the steps below, then verify the fix.",
        "manual",
      );
    if (!cmsCandidate.verified) return cmsResult("cms_unverified", cmsCandidate.proof);
    if (cmsCandidate.provider === "webflow" && cmsCandidate.missingWriteScopes.length)
      return cmsResult(
        "cms_reconnect",
        "Reconnect Webflow and allow Mellox to edit your site, then try again.",
      );
    if (!geoAgentEnabled())
      return cmsResult("manual_only", "Automatic fixes are turned off on this server.", "manual");
    return cmsResult(
      "ready",
      `Mellox can make this change on ${name} after you approve exactly what changes.`,
    );
  }

  // The GEO Engineer reads the repository itself, so a rule it has a strategy for
  // needs only the GitHub setup — not the one-shot planner's rule/framework list.
  const agentFixable = geoAgentEnabled() && isAgentFixable(finding.rule_id);
  if (!kind && !agentFixable) {
    return {
      ...base,
      method: "manual",
      requirement: "manual_only",
      reason:
        "This finding needs changes Mellox can't make safely on its own. Follow the steps below, then verify the fix.",
    };
  }
  const requirement = (req: FixAvailability["requirement"], reason: string): FixAvailability => ({
    ...base,
    method: "github_pr",
    requirement: req,
    reason,
  });
  if (!configured) {
    return requirement(
      "not_configured",
      check.issues.find((issue) => issue.includes("GITHUB_CLIENT_SECRET")) ??
        "GitHub configuration is incomplete on this Mellox server.",
    );
  }
  if (!liveConnections.length) {
    return requirement(
      connections.length ? "reconnect" : "connect",
      connections.length
        ? "GitHub was disconnected from this workspace. Reconnect it to open a pull request."
        : "Connect the GitHub repository behind this website so Mellox can propose the change as a pull request.",
    );
  }
  if (!connection || connection.status === "suspended" || connection.status === "revoked") {
    return requirement(
      "reconnect",
      "The GitHub installation is suspended or revoked. Reconnect it to continue.",
    );
  }
  if (!source) {
    return requirement(
      "select_repository",
      `Choose the repository that builds ${scan.host}. Mellox links it to this website.`,
    );
  }
  if (source.status === "access_lost") {
    return requirement(
      "access_lost",
      `Mellox lost access to ${source.full_name}. Re-grant it on GitHub, then verify the connection.`,
    );
  }
  if (source.ownership_status === "mismatch") {
    return requirement(
      "ownership_mismatch",
      `The evidence says ${source.full_name} doesn't build ${scan.host}. Link the repository that does.`,
    );
  }
  if (!sourceOwnsHost(source, scan.host)) {
    return requirement(
      "verify_ownership",
      `Before changing code, Mellox checks that ${source.full_name} really builds ${scan.host}.`,
    );
  }
  const framework = source.inspection?.framework ?? null;
  if (!agentFixable && source.inspection && !frameworkKind(framework)) {
    return requirement(
      "unsupported",
      framework
        ? `${source.full_name} is a ${framework} site; Mellox can't edit that framework safely yet. Follow the manual steps.`
        : `Mellox couldn't identify the framework in ${source.full_name}. Follow the manual steps.`,
    );
  }
  return requirement(
    "ready",
    `Mellox can propose this change as a pull request on ${source.full_name}.`,
  );
}

/* ───────────────────────── preview: branch, framework, files ───────────────────────── */

export type RepoSnapshot = {
  branch: { name: string; sha: string; protected: boolean };
  framework: string | null;
  frameworkEvidence: string | null;
  paths: string[];
  truncated: boolean;
};

export async function snapshotRepo(
  connection: ConnectionRow,
  source: SourceRow,
  userId: string,
  branchName: string,
) {
  const installationId = connection.external_account_id;
  return withAccess(connection, userId, async (): Promise<RepoSnapshot> => {
    const branch = await getBranch(installationId, source.full_name, branchName);
    if (!branch)
      throw new FixWorkflowError(
        `Branch “${branchName}” doesn't exist in ${source.full_name}.`,
        404,
      );
    const { paths, truncated } = await getTreePaths(
      installationId,
      source.full_name,
      branch.treeSha,
    );
    const rootEntries = [...new Set(paths.map((p) => p.split("/")[0]))];
    let pkg = null;
    if (paths.includes("package.json")) {
      const file = await readFile(
        installationId,
        source.full_name,
        "package.json",
        branch.name,
      ).catch(() => null);
      try {
        pkg = file ? JSON.parse(file.content) : null;
      } catch {
        pkg = null;
      }
    }
    const { framework, evidence } = detectFramework(rootEntries, pkg);
    return {
      branch: { name: branch.name, sha: branch.sha, protected: branch.protected },
      framework,
      frameworkEvidence: evidence,
      paths,
      truncated,
    };
  });
}

export async function listFixBranches(ctx: FixContext, sourceId: string) {
  const { source, connection } = await loadSourceWithConnection(ctx, sourceId);
  const branches = await withAccess(connection, ctx.userId, () =>
    listBranches(connection.external_account_id, source.full_name),
  );
  return {
    defaultBranch: source.default_branch,
    selectedBranch: source.branch ?? source.default_branch,
    branches: branches.slice(0, 300),
  };
}

export async function previewFix(
  ctx: FixContext,
  args: { findingId: string; sourceId: string; baseBranch: string },
): Promise<{
  framework: string | null;
  frameworkEvidence: string | null;
  branch: RepoSnapshot["branch"];
  target: FixTargetPreview | null;
  unsupportedReason: string | null;
  source: SourceView;
}> {
  if (!isValidBaseBranch(args.baseBranch))
    throw new FixWorkflowError("That branch name isn't valid.");
  const { finding } = await loadFinding(ctx, args.findingId);
  const { source, connection } = await loadSourceWithConnection(ctx, args.sourceId);
  const snap = await snapshotRepo(connection, source, ctx.userId, args.baseBranch);
  const plan = planFixTarget({
    ruleId: finding.rule_id,
    pageUrl: finding.page_url,
    framework: snap.framework,
    paths: snap.paths,
  });
  return {
    framework: snap.framework,
    frameworkEvidence: snap.frameworkEvidence,
    branch: snap.branch,
    target: plan.ok
      ? { strategy: plan.strategy, scope: plan.scope, files: plan.files, reason: plan.reason }
      : null,
    unsupportedReason: plan.ok ? null : plan.reason,
    source: presentSource(source),
  };
}

/* ───────────────────────── propose ───────────────────────── */

type PageRowLite = {
  url: string;
  final_url: string | null;
  state: string;
  status_code: number | null;
  analysis: PageAnalysis | null;
};

export async function loadScanFacts(scanId: string, pageUrl: string | null, origin: string) {
  const { data, error } = await supabaseAdmin
    .from("geo_scan_pages")
    .select("url, final_url, state, status_code, analysis")
    .eq("scan_id", scanId)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PageRowLite[];
  const analysed = rows.filter(
    (r) => r.state === "fetched" && r.analysis && (r.status_code ?? 200) < 400,
  );
  const home = analysed.find((r) => r.analysis!.pageType === "home") ?? analysed[0] ?? null;
  const wanted = pageUrl ?? `${origin}/`;
  const pageRow =
    analysed.find(
      (r) => r.analysis!.url === wanted || r.url === wanted || r.final_url === wanted,
    ) ?? home;
  const a = pageRow?.analysis ?? null;
  const page: PageFacts | null = a
    ? {
        url: a.url,
        title: a.title,
        description: a.metaDescription,
        h1: a.headings
          .filter((h) => h.level === 1)
          .map((h) => h.text)
          .slice(0, 3),
        headings: a.headings.slice(0, 15).map((h) => `h${h.level}: ${h.text}`),
        lang: a.lang,
        excerpt: a.text.excerpt,
        canonical: a.canonicals[0] ?? null,
      }
    : null;
  const ha = home?.analysis ?? null;
  const brandName =
    ha?.schema.organizations[0]?.name ?? ha?.trust.siteName ?? ha?.og["og:site_name"] ?? null;
  const pages: CrawledPageFacts[] = analysed.map((r) => ({
    url: r.analysis!.url,
    title: r.analysis!.title,
    description: r.analysis!.metaDescription,
    pageType: r.analysis!.pageType,
    noindex: Boolean(r.analysis!.robotsMeta?.noindex),
  }));
  return { page, brandName, pages };
}

export async function createProposal(
  ctx: FixContext,
  args: { findingId: string; sourceId: string; baseBranch: string; replaceDraft?: boolean },
): Promise<{ ok: true; proposal: FixProposalView } | { ok: false; reason: string }> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can propose fixes.", 403);
  if (!isValidBaseBranch(args.baseBranch))
    throw new FixWorkflowError("That branch name isn't valid.");
  const { finding, scan } = await loadFinding(ctx, args.findingId);
  const kind = fixKindForRule(finding.rule_id);
  if (!kind) return { ok: false, reason: "This finding needs a manual fix." };

  const { data: live } = await supabaseAdmin
    .from("geo_fix_proposals")
    .select("id, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("fingerprint", finding.fingerprint)
    .in("status", LIVE_PROPOSAL);
  const blocking = (live ?? []).filter((p) => p.status !== "draft" || !args.replaceDraft);
  if (blocking.length) {
    return {
      ok: false,
      reason:
        blocking[0].status === "draft"
          ? "A proposal for this finding is already waiting for review."
          : "A pull request for this finding is already open or being verified.",
    };
  }

  const { source, connection } = await loadSourceWithConnection(ctx, args.sourceId);
  try {
    assertSourceOwnsHost(source, scan.host);
  } catch (error) {
    if (error instanceof FixWorkflowError) return { ok: false, reason: error.message };
    throw error;
  }
  const installationId = connection.external_account_id;
  const snap = await snapshotRepo(connection, source, ctx.userId, args.baseBranch);
  const plan = planFixTarget({
    ruleId: finding.rule_id,
    pageUrl: finding.page_url,
    framework: snap.framework,
    paths: snap.paths,
  });
  if (!plan.ok) return { ok: false, reason: plan.reason };

  const current = await withAccess(connection, ctx.userId, async () => {
    const out: {
      path: string;
      action: "create" | "update";
      content: string | null;
      sha: string | null;
    }[] = [];
    for (const f of plan.files) {
      const file = await readFile(installationId, source.full_name, f.path, snap.branch.name);
      out.push({
        path: f.path,
        action: file ? "update" : "create",
        content: file?.content ?? null,
        sha: file?.sha ?? null,
      });
    }
    return out;
  }).catch((error) => {
    if (error instanceof GitOperationError) return error;
    throw error;
  });
  if (current instanceof GitOperationError) return { ok: false, reason: current.message };

  const facts = await loadScanFacts(scan.id, finding.page_url, scan.origin);
  const generated = await generateChange({
    kind,
    ruleId: finding.rule_id,
    finding: {
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence ?? {},
      pageUrl: finding.page_url,
    },
    plan: plan as Extract<TargetPlan, { ok: true }>,
    framework: snap.framework,
    site: scan.site,
    brandName: facts.brandName,
    logoUrl: null,
    page: facts.page,
    pages: facts.pages,
    current: current.map((c) => ({ path: c.path, action: c.action, content: c.content })),
  });
  if (!generated.ok) return { ok: false, reason: generated.reason };

  const validation = validateProposal({
    kind,
    ruleId: finding.rule_id,
    pageUrl: finding.page_url,
    site: scan.site,
    files: generated.files,
    crawlerReadsFile:
      plan.strategy === "static_file" || generated.files.every((f) => /\.html?$/i.test(f.path)),
  });

  if (args.replaceDraft) {
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "discarded" })
      .eq("workspace_id", ctx.workspaceId)
      .eq("fingerprint", finding.fingerprint)
      .eq("status", "draft");
  }

  const shaByPath = new Map(current.map((c) => [c.path, c.sha]));
  const files: StoredProposalFile[] = generated.files.map((f) => ({
    path: f.path,
    action: f.action,
    baseBlobSha: shaByPath.get(f.path) ?? null,
    after: f.after,
    diff: f.diff,
    additions: f.additions,
    deletions: f.deletions,
    explanation: f.explanation,
  }));
  const hash = contentHash(
    generated.files.map((f) => ({ path: f.path, action: f.action, after: f.after })),
    snap.branch.sha,
  );
  const { data: row, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .insert({
      workspace_id: ctx.workspaceId,
      scan_id: scan.id,
      finding_id: finding.id,
      fingerprint: finding.fingerprint,
      rule_id: finding.rule_id,
      fix_id: finding.fix_id ?? kind,
      page_url: finding.page_url,
      site_origin: scan.origin,
      provider: "github",
      connection_id: connection.id,
      source_id: source.id,
      repo_full_name: source.full_name,
      repo_external_id: source.external_id,
      framework: snap.framework,
      base_branch: snap.branch.name,
      base_sha: snap.branch.sha,
      strategy: plan.strategy,
      files: files as unknown as Json,
      explanation: generated.explanation,
      validation: validation as unknown as Json,
      content_hash: hash,
      model: generated.model,
      status: "draft",
      created_by: ctx.userId,
    })
    .select(PROPOSAL_COLS)
    .single();
  if (error || !row) {
    if (error?.code === "23505")
      return { ok: false, reason: "A proposal for this finding already exists." };
    throw new Error(error?.message ?? "Couldn't save the proposal");
  }
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix.proposed",
    entity: "geo_fix_proposal",
    payload: {
      proposalId: row.id,
      ruleId: finding.rule_id,
      repository: source.full_name,
      baseBranch: snap.branch.name,
      files: files.map((f) => ({ path: f.path, action: f.action })),
      validationOk: validation.ok,
      model: generated.model,
    },
  });
  return { ok: true, proposal: await proposalView(row as unknown as ProposalRow) };
}

/* ───────────────────────── approve & apply ───────────────────────── */

async function loadProposal(ctx: FixContext, proposalId: string): Promise<ProposalRow> {
  const { data, error } = await ctx.supabase
    .from("geo_fix_proposals")
    .select(PROPOSAL_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Proposal not found", 404);
  return data as unknown as ProposalRow;
}

async function patchProposal(id: string, patch: Record<string, unknown>): Promise<ProposalRow> {
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .update(patch as never)
    .eq("id", id)
    .select(PROPOSAL_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't update the proposal");
  if ("status" in patch) await syncAgentRun(id);
  return data as unknown as ProposalRow;
}

/** Keep a GEO agent run in step with the proposal it produced (no-op otherwise). */
export async function syncAgentRun(proposalId: string) {
  try {
    const { syncAgentRunFromProposal } = await import("../agents/runner.server");
    await syncAgentRunFromProposal(proposalId);
  } catch (error) {
    console.error(`[geo] agent run sync for proposal ${proposalId} failed`, error);
  }
}

function prBody(row: ProposalRow, title: string): string {
  const checks = ("checks" in row.validation ? row.validation.checks : [])
    .map(
      (c) =>
        `- ${c.status === "pass" ? "✅" : c.status === "skipped" ? "⏭️" : "❌"} ${c.label}: ${c.detail}`,
    )
    .join("\n");
  const files = row.files
    .map((f) => `- \`${f.path}\` (${f.action})${f.explanation ? ` — ${f.explanation}` : ""}`)
    .join("\n");
  return `## ${title}

${row.explanation ?? ""}

**Finding:** \`${row.rule_id}\`${row.page_url ? ` on ${row.page_url}` : ` on ${row.site_origin}`}

### Files
${files}

### Checks Mellox ran before opening this PR
${checks}

---
Proposed by Mellox AI Visibility and approved by a workspace member. Mellox never merges pull requests.
After this PR is merged and deployed, Mellox re-scans the affected page and only marks the finding resolved if the check passes on the live site.`;
}

export async function approveAndApply(
  ctx: FixContext,
  args: { proposalId: string; contentHash: string },
): Promise<FixProposalView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can approve fixes.", 403);
  const row = await loadProposal(ctx, args.proposalId);
  if (row.batch_id) {
    throw new FixWorkflowError(
      "This fix is part of a “Fix all” pull request. Approve it there.",
      409,
    );
  }
  if (row.status !== "draft")
    throw new FixWorkflowError("This proposal is no longer waiting for approval.", 409);
  if (!("ok" in row.validation) || !row.validation.ok) {
    throw new FixWorkflowError(
      "This proposal failed validation and can't be applied. Regenerate it.",
      409,
    );
  }
  if (!row.content_hash || row.content_hash !== args.contentHash) {
    throw new FixWorkflowError(
      "The proposal changed since you reviewed it. Review it again before approving.",
      409,
    );
  }
  if (row.provider !== "github") return approveCmsProposal(ctx, row, args.contentHash);
  if (!row.source_id || !row.base_branch || !row.base_sha || !row.repo_full_name) {
    throw new FixWorkflowError("This proposal is missing its repository details.", 409);
  }
  if (row.files.some((f) => typeof f.after !== "string")) {
    throw new FixWorkflowError("This proposal's contents expired. Regenerate it.", 409);
  }
  const { source, connection } = await loadSourceWithConnection(ctx, row.source_id);
  if (source.full_name !== row.repo_full_name) {
    throw new FixWorkflowError("The linked repository changed. Regenerate the proposal.", 409);
  }
  assertSourceOwnsHost(source, new URL(row.site_origin).hostname);

  // Claim: exactly one approval can move a draft to applying.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("geo_fix_proposals")
    .update({
      status: "applying",
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", row.id)
    .eq("status", "draft")
    .eq("content_hash", args.contentHash)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new FixWorkflowError("This proposal is already being applied.", 409);
  await syncAgentRun(row.id);

  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix.approved",
    entity: "geo_fix_proposal",
    payload: {
      proposalId: row.id,
      repository: row.repo_full_name,
      baseBranch: row.base_branch,
      contentHash: args.contentHash,
    },
  });

  const installationId = connection.external_account_id;
  const headBranch = proposalBranchName(row.fix_id, randomBytes(4).toString("hex"));
  const title = `Mellox: ${row.rule_id.replace(/^[a-z]+\./, "").replace(/_/g, " ")} fix${row.page_url ? ` for ${new URL(row.page_url).pathname}` : ""}`;
  let branchCreated = false;
  try {
    const { commitSha } = await withAccess(connection, ctx.userId, () =>
      commitToNewBranch({
        installationId,
        repo: row.repo_full_name!,
        baseBranch: row.base_branch!,
        baseSha: row.base_sha!,
        headBranch,
        message: `${title}\n\nProposed by Mellox AI Visibility (rule ${row.rule_id}) and approved in Mellox.`,
        files: row.files.map((f) => ({ path: f.path, content: f.after! })),
      }),
    );
    branchCreated = true;
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix.committed",
      entity: "geo_fix_proposal",
      payload: {
        proposalId: row.id,
        repository: row.repo_full_name,
        branch: headBranch,
        commitSha,
        files: row.files.map((f) => f.path),
      },
    });
    const pr = await withAccess(connection, ctx.userId, () =>
      createPullRequest({
        installationId,
        repo: row.repo_full_name!,
        headBranch,
        baseBranch: row.base_branch!,
        title,
        body: prBody(row, title),
      }),
    );
    const checks = await getChecks(installationId, row.repo_full_name, commitSha).catch(() => null);
    const updated = await patchProposal(row.id, {
      status: "pr_open",
      head_branch: headBranch,
      commit_sha: commitSha,
      pr_number: pr.number,
      pr_url: pr.url,
      pr_state: pr.state,
      checks,
      last_synced_at: new Date().toISOString(),
    });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix.pr_opened",
      entity: "geo_fix_proposal",
      payload: {
        proposalId: row.id,
        repository: row.repo_full_name,
        pr: pr.number,
        url: pr.url,
        branch: headBranch,
      },
    });
    // Work is under way — not resolved.
    await supabaseAdmin.from("geo_finding_states").upsert(
      {
        workspace_id: ctx.workspaceId,
        fingerprint: row.fingerprint,
        state: "in_progress",
        note: `Pull request #${pr.number} opened in ${row.repo_full_name}.`,
        resolved_via: null,
        verified_at: null,
        verification_id: null,
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,fingerprint" },
    );
    return proposalView(updated);
  } catch (error) {
    const message = describeGitError(error);
    const stale = error instanceof GitOperationError && error.code === "base_moved";
    const accessLost = error instanceof GitHubAccessError && error.reason !== "forbidden";
    if (branchCreated) {
      await deleteMelloxBranch(installationId, row.repo_full_name, headBranch).catch(() => {});
    }
    const updated = await patchProposal(row.id, {
      status: stale ? "stale" : accessLost ? "access_lost" : "failed",
      error: message.slice(0, 2000),
    });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix.apply_failed",
      entity: "geo_fix_proposal",
      payload: {
        proposalId: row.id,
        repository: row.repo_full_name,
        error: message,
        branchCleanedUp: branchCreated,
      },
    });
    void updated;
    throw new FixWorkflowError(message, stale ? 409 : 502);
  }
}

/* ───────────────────────── CMS: apply & undo ───────────────────────── */

/** CMS caches (page cache plugins, CDNs) need a few minutes; retries widen. */
function cmsVerifyDelaysMinutes(): number[] {
  return [2, 10, 30];
}

const cmsName = (provider: string) => (provider === "webflow" ? "Webflow" : "WordPress");

/**
 * Write an approved WordPress / Webflow change. The live site must still be
 * the connected site (checked again now), the fields must still hold the
 * values the person reviewed, and verification decides whether it worked.
 */
async function approveCmsProposal(
  ctx: FixContext,
  row: ProposalRow,
  hash: string,
): Promise<FixProposalView> {
  const changes = row.cms_changes?.changes ?? [];
  if (!changes.length) throw new FixWorkflowError("This proposal has nothing to apply.", 409);
  const provider = row.provider as "wordpress" | "webflow";
  const name = cmsName(provider);
  const host = new URL(row.site_origin).hostname;
  const { resolveSite } = await import("@/server/sites/resolve.server");
  const resolution = await resolveSite(ctx.workspaceId, host, { live: true });
  const binding = resolution.candidates.find((c) => c.provider === provider);
  if (!binding?.verified)
    throw new FixWorkflowError(
      binding?.proof ?? `${host} isn't connected through ${name} any more.`,
      409,
    );

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("geo_fix_proposals")
    .update({
      status: "applying",
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", row.id)
    .eq("status", "draft")
    .eq("content_hash", hash)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new FixWorkflowError("This change is already being applied.", 409);
  await syncAgentRun(row.id);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.cms.approved",
    entity: "geo_fix_proposal",
    payload: {
      proposalId: row.id,
      provider,
      contentHash: hash,
      fields: changes.map((c) => c.label),
    },
  });

  const { openCmsSession } = await import("@/server/geo/cms/access.server");
  const { applyCmsChanges, CmsDriftError } = await import("@/server/geo/cms/apply.server");
  try {
    const session = await openCmsSession(ctx.workspaceId, provider, {
      write: true,
      seo: binding.provider === "wordpress" ? binding.seo : undefined,
    });
    const { snapshot, published } = await applyCmsChanges(session, changes);
    const now = new Date().toISOString();
    await patchProposal(row.id, {
      status: "applied",
      applied_at: now,
      cms_snapshot: snapshot as unknown as Json,
      error: null,
    });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.cms.applied",
      entity: "geo_fix_proposal",
      payload: { proposalId: row.id, provider, fields: changes.map((c) => c.label), published },
    });
    await supabaseAdmin.from("geo_finding_states").upsert(
      {
        workspace_id: ctx.workspaceId,
        fingerprint: row.fingerprint,
        state: "in_progress",
        note: `Changed on ${name}; checking the live site.`,
        resolved_via: null,
        verified_at: null,
        verification_id: null,
        updated_by: ctx.userId,
        updated_at: now,
      },
      { onConflict: "workspace_id,fingerprint" },
    );
    const before: Record<string, RuleCheckState> = {};
    if (row.finding_id) {
      const { data: f } = await supabaseAdmin
        .from("geo_findings")
        .select("status, detail")
        .eq("id", row.finding_id)
        .maybeSingle();
      if (f)
        before[row.fingerprint] = {
          status: f.status as "warn" | "fail",
          detail: f.detail,
          pageUrl: row.page_url,
        };
    }
    await scheduleVerification({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      proposalId: row.id,
      origin: row.site_origin,
      targets: [{ fingerprint: row.fingerprint, ruleId: row.rule_id, pageUrl: row.page_url }],
      baselineScanId: row.scan_id,
      before,
      delaysMinutes: cmsVerifyDelaysMinutes(),
    });
    const updated = await patchProposal(row.id, { status: "verifying" });
    return proposalView(updated);
  } catch (error) {
    const drift = error instanceof CmsDriftError;
    const message = error instanceof Error ? error.message : `${name} didn't accept the change.`;
    await patchProposal(row.id, {
      status: drift ? "stale" : "failed",
      error: message.slice(0, 2000),
    });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.cms.apply_failed",
      entity: "geo_fix_proposal",
      payload: { proposalId: row.id, provider, error: message.slice(0, 500) },
    });
    throw new FixWorkflowError(message, drift ? 409 : 502);
  }
}

/** Put back the values a CMS change replaced (refuses fields edited since). */
export async function undoCmsProposal(
  ctx: FixContext,
  proposalId: string,
): Promise<FixProposalView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can undo changes.", 403);
  const row = await loadProposal(ctx, proposalId);
  if (row.provider === "github")
    throw new FixWorkflowError("Pull requests are undone on GitHub (revert the merge).", 409);
  if (
    !row.applied_at ||
    row.rolled_back_at ||
    !row.cms_snapshot?.length ||
    !["applied", "verifying", "verified", "not_verified"].includes(row.status)
  )
    throw new FixWorkflowError("This change can't be undone.", 409);
  const provider = row.provider as "wordpress" | "webflow";
  const { openCmsSession } = await import("@/server/geo/cms/access.server");
  const { rollbackCmsChanges } = await import("@/server/geo/cms/apply.server");
  const session = await openCmsSession(ctx.workspaceId, provider, { write: true });
  const result = await rollbackCmsChanges(
    session,
    row.cms_changes?.changes ?? [],
    row.cms_snapshot,
  );
  if (!result.restored)
    throw new FixWorkflowError(
      `Nothing was undone: ${result.skipped.join(", ")} changed on ${cmsName(provider)} since Mellox applied it.`,
      409,
    );
  await supabaseAdmin
    .from("geo_verifications")
    .update({ status: "cancelled", outcome_detail: "The change was undone." })
    .eq("proposal_id", row.id)
    .in("status", ["scheduled", "running"]);
  const updated = await patchProposal(row.id, {
    status: "rolled_back",
    rolled_back_at: new Date().toISOString(),
    rolled_back_by: ctx.userId,
    error: result.skipped.length
      ? `Not undone because they changed since: ${result.skipped.join(", ")}`
      : null,
  });
  await supabaseAdmin.from("geo_finding_states").upsert(
    {
      workspace_id: ctx.workspaceId,
      fingerprint: row.fingerprint,
      state: "open",
      note: `Mellox's change was undone on ${cmsName(provider)}.`,
      resolved_via: null,
      verified_at: null,
      verification_id: null,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,fingerprint" },
  );
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.cms.rolled_back",
    entity: "geo_fix_proposal",
    payload: { proposalId: row.id, provider, restored: result.restored, skipped: result.skipped },
  });
  return proposalView(updated);
}

/* ───────────────────────── sync & merge → verification ───────────────────────── */

export async function loadConnectionAdmin(id: string | null): Promise<ConnectionRow | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select(CONNECTION_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as ConnectionRow) ?? null;
}

/** Apply a pull request's observed state (from the API or a webhook). */
export async function applyPullRequestState(
  row: ProposalRow,
  pr: Pick<PullRequestInfo, "state" | "mergedAt" | "headSha"> & { number: number },
  source: "sync" | "webhook",
): Promise<ProposalRow> {
  // "Fix all" members follow their batch (one PR, one verification).
  if (row.batch_id) return row;
  if (row.pr_number !== pr.number) return row;
  const now = new Date().toISOString();
  if (pr.state === "merged" && (row.status === "pr_open" || row.status === "closed")) {
    let updated = await patchProposal(row.id, {
      status: "merged",
      pr_state: "merged",
      pr_merged_at: pr.mergedAt ?? now,
      last_synced_at: now,
    });
    await recordAudit({
      workspaceId: row.workspace_id,
      userId: null,
      action: "geo.fix.pr_merged",
      entity: "geo_fix_proposal",
      payload: { proposalId: row.id, pr: row.pr_number, repository: row.repo_full_name, source },
    });
    const before: Record<string, RuleCheckState> = {};
    if (row.finding_id) {
      const { data: f } = await supabaseAdmin
        .from("geo_findings")
        .select("status, detail")
        .eq("id", row.finding_id)
        .maybeSingle();
      if (f)
        before[row.fingerprint] = {
          status: f.status as "warn" | "fail",
          detail: f.detail,
          pageUrl: row.page_url,
        };
    }
    await scheduleVerification({
      workspaceId: row.workspace_id,
      userId: row.approved_by ?? row.created_by,
      proposalId: row.id,
      origin: row.site_origin,
      targets: [{ fingerprint: row.fingerprint, ruleId: row.rule_id, pageUrl: row.page_url }],
      baselineScanId: row.scan_id,
      before,
      delaysMinutes: verifyDelaysMinutes(),
    });
    updated = await patchProposal(row.id, { status: "verifying" });
    return updated;
  }
  if (pr.state === "closed" && row.status === "pr_open") {
    await recordAudit({
      workspaceId: row.workspace_id,
      userId: null,
      action: "geo.fix.pr_closed",
      entity: "geo_fix_proposal",
      payload: { proposalId: row.id, pr: row.pr_number, repository: row.repo_full_name, source },
    });
    return patchProposal(row.id, { status: "closed", pr_state: "closed", last_synced_at: now });
  }
  if (pr.state === "open" && row.status === "closed") {
    return patchProposal(row.id, { status: "pr_open", pr_state: "open", last_synced_at: now });
  }
  return patchProposal(row.id, { last_synced_at: now });
}

export async function syncProposal(row: ProposalRow): Promise<ProposalRow> {
  if (row.batch_id) return row;
  if (!row.pr_number || !row.repo_full_name || !["pr_open", "closed"].includes(row.status))
    return row;
  const connection = await loadConnectionAdmin(row.connection_id);
  if (!connection || connection.status === "revoked") {
    return patchProposal(row.id, {
      status: "access_lost",
      error: "GitHub was disconnected; the pull request can't be tracked.",
    });
  }
  try {
    const pr = await withAccess(connection, null, () =>
      getPullRequest(connection.external_account_id, row.repo_full_name!, row.pr_number!),
    );
    if (!pr)
      return patchProposal(row.id, {
        status: "access_lost",
        error: "The pull request is no longer visible to Mellox.",
      });
    const checks = await getChecks(
      connection.external_account_id,
      row.repo_full_name,
      pr.headSha,
    ).catch(() => null);
    const updated = await applyPullRequestState({ ...row }, pr, "sync");
    return checks ? patchProposal(updated.id, { checks }) : updated;
  } catch (error) {
    if (error instanceof GitHubAccessError) {
      return patchProposal(row.id, { status: "access_lost", error: describeGitError(error) });
    }
    console.error(`[geo] proposal ${row.id} sync failed`, error);
    return row;
  }
}

async function maybeSync(row: ProposalRow): Promise<ProposalRow> {
  if (row.status !== "pr_open") return row;
  if (row.last_synced_at && Date.now() - Date.parse(row.last_synced_at) < SYNC_AFTER_MS) return row;
  return syncProposal(row);
}

export async function getProposal(
  ctx: FixContext,
  proposalId: string,
  opts: { sync?: boolean } = {},
) {
  let row = await loadProposal(ctx, proposalId);
  if (opts.sync && row.status === "pr_open") row = await syncProposal(row);
  else row = await maybeSync(row);
  return proposalView(row);
}

/** Cron: refresh open pull requests whose state is older than five minutes (webhooks may not reach us). */
export async function syncStaleOpenProposals(max = 5) {
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .select(PROPOSAL_COLS)
    .eq("status", "pr_open")
    .is("batch_id", null)
    .or(
      `last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`,
    )
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(max);
  if (error) throw new Error(error.message);
  let synced = 0;
  for (const row of (data ?? []) as unknown as ProposalRow[]) {
    await syncProposal(row);
    synced++;
  }
  const { syncStaleOpenBatches } = await import("./batch.server");
  const batches = await syncStaleOpenBatches(3);
  return { synced, batches: batches.synced };
}

/* ───────────────────────── webhook entry points ───────────────────────── */

/** pull_request webhook: match proposals by the installation's connections + repo + PR number. */
export async function handlePullRequestWebhook(
  connectionIds: string[],
  pr: {
    repositoryId: string;
    number: number;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
    headSha: string;
    headRef: string;
  },
): Promise<number> {
  if (!connectionIds.length || !pr.headRef.startsWith("mellox/")) return 0;
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .select(PROPOSAL_COLS)
    .in("connection_id", connectionIds)
    .eq("repo_external_id", pr.repositoryId)
    .eq("pr_number", pr.number);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ProposalRow[];
  for (const row of rows) await applyPullRequestState(row, pr, "webhook");
  const { handleBatchPullRequestWebhook } = await import("./batch.server");
  const batches = await handleBatchPullRequestWebhook(connectionIds, pr);
  return rows.filter((r) => !r.batch_id).length + batches;
}

export async function refreshChecksForCommit(
  connectionIds: string[],
  repositoryId: string,
  headSha: string,
) {
  if (!connectionIds.length || !/^[0-9a-f]{40}$/i.test(headSha)) return 0;
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .select("id, repo_full_name, connection_id")
    .in("connection_id", connectionIds)
    .eq("repo_external_id", repositoryId)
    .eq("commit_sha", headSha)
    .in("status", ["pr_open", "merged", "verifying"]);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const row of data ?? []) {
    const connection = await loadConnectionAdmin(row.connection_id);
    if (!connection || connection.status !== "active" || !row.repo_full_name) continue;
    const checks = await getChecks(
      connection.external_account_id,
      row.repo_full_name,
      headSha,
    ).catch(() => null);
    if (checks) {
      await supabaseAdmin
        .from("geo_fix_proposals")
        .update({ checks: checks as unknown as Json })
        .eq("id", row.id);
      n++;
    }
  }
  const { refreshBatchChecks } = await import("./batch.server");
  return n + (await refreshBatchChecks(connectionIds, repositoryId, headSha));
}

export async function markProposalsAccessLost(connectionIds: string[]) {
  if (!connectionIds.length) return 0;
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .update({
      status: "access_lost",
      error: "The GitHub App was uninstalled; this pull request can't be tracked.",
    })
    .in("connection_id", connectionIds)
    .in("status", ["draft", "applying", "pr_open"])
    .select("id");
  if (error) throw new Error(error.message);
  await supabaseAdmin
    .from("geo_fix_batches")
    .update({
      status: "access_lost",
      error: "The GitHub App was uninstalled; this pull request can't be tracked.",
    })
    .in("connection_id", connectionIds)
    .in("status", ["generating", "draft", "applying", "pr_open"]);
  return data?.length ?? 0;
}

/* ───────────────────────── discard ───────────────────────── */

export async function discardProposal(
  ctx: FixContext,
  args: { proposalId: string; closePullRequest: boolean },
): Promise<FixProposalView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can discard fixes.", 403);
  const row = await loadProposal(ctx, args.proposalId);
  if (row.batch_id && !["failed", "stale", "not_verified", "closed"].includes(row.status)) {
    throw new FixWorkflowError(
      "This fix is part of a “Fix all” pull request. Manage it from “Fix all”.",
      409,
    );
  }
  if (["draft", "stale", "failed"].includes(row.status)) {
    const updated = await patchProposal(row.id, { status: "discarded" });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix.discarded",
      entity: "geo_fix_proposal",
      payload: { proposalId: row.id, from: row.status },
    });
    return proposalView(updated);
  }
  if (row.status !== "pr_open")
    throw new FixWorkflowError("This proposal can't be discarded now.", 409);
  if (!args.closePullRequest)
    throw new FixWorkflowError("Confirm closing the pull request to discard it.", 400);
  const { connection } = await loadSourceWithConnection(ctx, row.source_id!);
  await withAccess(connection, ctx.userId, async () => {
    await closePullRequest(connection.external_account_id, row.repo_full_name!, row.pr_number!);
    if (row.head_branch)
      await deleteMelloxBranch(
        connection.external_account_id,
        row.repo_full_name!,
        row.head_branch,
      );
  }).catch((error) => {
    throw new FixWorkflowError(describeGitError(error), 502);
  });
  const updated = await patchProposal(row.id, {
    status: "discarded",
    pr_state: "closed",
    last_synced_at: new Date().toISOString(),
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix.discarded",
    entity: "geo_fix_proposal",
    payload: {
      proposalId: row.id,
      pr: row.pr_number,
      repository: row.repo_full_name,
      branchDeleted: row.head_branch,
    },
  });
  await supabaseAdmin
    .from("geo_finding_states")
    .update({
      state: "open",
      note: `Pull request #${row.pr_number} was closed from Mellox.`,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("fingerprint", row.fingerprint)
    .eq("state", "in_progress");
  return proposalView(updated);
}

/* ───────────────────────── manual verification ───────────────────────── */

export async function requestVerification(
  ctx: FixContext,
  args: { findingIds: string[] },
): Promise<{ verificationId: string; urls: string[] }> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can run verifications.", 403);
  const ids = [...new Set(args.findingIds)].slice(0, 20);
  const { data, error } = await ctx.supabase
    .from("geo_findings")
    .select("id, scan_id, rule_id, fingerprint, page_url, status, detail")
    .eq("workspace_id", ctx.workspaceId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) throw new FixWorkflowError("Findings not found", 404);
  const scanIds = [...new Set(rows.map((r) => r.scan_id))];
  if (scanIds.length > 1) throw new FixWorkflowError("Verify findings from one scan at a time.");
  const { data: scan } = await ctx.supabase
    .from("geo_scans")
    .select("id, origin, host")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", scanIds[0])
    .maybeSingle();
  if (!scan) throw new FixWorkflowError("Scan not found", 404);
  const multiPage = rows.find((r) =>
    [
      "tech.duplicate_title",
      "tech.duplicate_description",
      "tech.broken_links",
      "tech.crawl_depth",
      "tech.http_errors",
    ].includes(r.rule_id),
  );
  if (multiPage) {
    throw new FixWorkflowError(
      "Some of these checks compare pages across the whole site. Run a full re-scan to verify them.",
    );
  }
  const before: Record<string, RuleCheckState> = {};
  for (const r of rows)
    before[r.fingerprint] = {
      status: r.status as "warn" | "fail",
      detail: r.detail,
      pageUrl: r.page_url,
    };
  const verification = await scheduleVerification({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    proposalId: null,
    origin: scan.origin,
    targets: rows.map((r) => ({
      fingerprint: r.fingerprint,
      ruleId: r.rule_id,
      pageUrl: r.page_url,
    })),
    baselineScanId: scan.id,
    before,
    delaysMinutes: [0],
  });
  kickVerification(verification.id);
  return { verificationId: verification.id, urls: verification.urls };
}

export async function getVerification(ctx: FixContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("geo_verifications")
    .select(VERIFICATION_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Verification not found", 404);
  const row = data as unknown as VerificationRow;
  // Local development has no pg_cron: a due job is advanced when someone looks at it.
  if (
    (row.status === "scheduled" || row.status === "running") &&
    Date.parse(row.next_attempt_at) <= Date.now()
  ) {
    if (!row.lease_until || Date.parse(row.lease_until) < Date.now()) kickVerification(row.id);
  }
  return presentVerification(row);
}

/** Proposals and verifications in a scan, for badges in the findings list. */
export async function listFixActivity(ctx: FixContext, scanId: string) {
  const { data: findings, error } = await ctx.supabase
    .from("geo_findings")
    .select("fingerprint")
    .eq("workspace_id", ctx.workspaceId)
    .eq("scan_id", scanId)
    .limit(5000);
  if (error) throw new Error(error.message);
  const fingerprints = [...new Set((findings ?? []).map((f) => f.fingerprint))];
  if (!fingerprints.length) return { proposals: {}, verifications: {} };
  const { data: proposals } = await ctx.supabase
    .from("geo_fix_proposals")
    .select("fingerprint, status, pr_number, pr_url, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .in("fingerprint", fingerprints.slice(0, 1000))
    .order("created_at", { ascending: false });
  const byFingerprint: Record<
    string,
    { status: string; prNumber: number | null; prUrl: string | null }
  > = {};
  for (const p of proposals ?? []) {
    if (!byFingerprint[p.fingerprint]) {
      byFingerprint[p.fingerprint] = { status: p.status, prNumber: p.pr_number, prUrl: p.pr_url };
    }
  }
  const { data: verifications } = await ctx.supabase
    .from("geo_verifications")
    .select("id, fingerprints, status, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .overlaps("fingerprints", fingerprints.slice(0, 1000))
    .order("created_at", { ascending: false })
    .limit(200);
  const vByFingerprint: Record<string, { id: string; status: string }> = {};
  for (const v of verifications ?? []) {
    for (const fp of v.fingerprints)
      if (!vByFingerprint[fp]) vByFingerprint[fp] = { id: v.id, status: v.status };
  }
  return { proposals: byFingerprint, verifications: vByFingerprint };
}

export type { ConnectionView };
