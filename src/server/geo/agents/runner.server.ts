// runner.server.ts — advances GEO agent runs.
//
// A run is a leased job (claim_geo_agent_runs, FOR UPDATE SKIP LOCKED),
// advanced by after() right after a person acts and by the geo-agents cron
// hook. Each advance loads real context (finding, scan, verified repository at
// the base commit), runs one stage, persists the result, events and a
// conversation checkpoint, and moves the status with compare-and-set so an
// illegal or concurrent transition is refused.
//
//   queued/investigating  → plan → awaiting_plan_approval | needs_input | not_fixable
//   implementing          → patch → review → validate (→ correct) → proposal
//                           → awaiting_patch_approval
// After that, the proposal (approval, PR, merge) and verification rows are the
// source of truth; syncAgentRunFromProposal mirrors them into the run.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { AnthropicGatewayError, type ClaudeMessage } from "@/lib/anthropic-gateway.server";
import { ownershipIsCurrent } from "@/lib/connectors/ownership";
import type { AgentPlan, AgentRunStatus, AgentStage, AgentUsage } from "@/lib/geo/agent-contracts";
import { nextStatus, statusFromProposal, type AgentEvent } from "@/lib/geo/agent-state";
import { fixRecipeFor } from "@/lib/geo/fix-recipes";
import { RULE_BY_ID } from "@/lib/geo/rules";
import type { PageAnalysis, SiteArtifacts } from "@/lib/geo/types";
import { BudgetExceededError } from "@/server/ai/budget";
import { recordAudit } from "@/server/audit.server";
import { GitHubAccessError, GitHubRateLimitError } from "@/server/connectors/github/api.server";
import {
  contentHash,
  getBranch,
  getTreeEntries,
  getTreeScoped,
  readBlob,
} from "@/server/connectors/github/git.server";
import { detectFramework } from "@/server/connectors/github/inspect";
import { withAccess } from "@/server/connectors/github/service.server";
import {
  CONNECTION_COLS,
  SOURCE_COLS,
  type ConnectionRow,
  type SourceRow,
} from "@/server/connectors/present";
import { PROPOSAL_COLS, type ProposalRow, type StoredProposalFile } from "../fixes/present";
import { strategyForRule } from "../fixes/strategies";
import { fixKindForRule, planFixTarget } from "../fixes/targets";
import { allowedImportsFor, playbookFor } from "./framework-playbooks";
import {
  addUsage,
  emptyUsage,
  geoAgentMaxCostUsd,
  geoAgentModel,
  implementPlan,
  investigateAndPlan,
  hashPlan,
  STAGE_LIMITS,
  type AgentContext,
  type AgentDeps,
  type StageEvent,
} from "./geo-coding-agent";
import { newToolState, type PageFactsView, type RepoSnapshot } from "./repo-tools.server";

const WORKER = `geo-agent-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 200;

export const RUN_COLS =
  "id, workspace_id, kind, scan_id, finding_id, fingerprint, rule_id, page_url, site_host, site_origin, source_id, connection_id, repo_full_name, repo_external_id, base_branch, base_sha, framework, status, status_detail, failed_at_step, error_code, error, attempts, max_attempts, next_attempt_at, lease_until, locked_by, cancel_requested_at, plan, plan_hash, plan_revision, plan_ready_at, plan_approved_by, plan_approved_at, feedback, inputs, files_inspected, patch, review, validation, correction_rounds, proposal_id, batch_id, verification_id, result, model, usage, checkpoint, created_by, created_at, updated_at, completed_at";

export type AgentRunRow = {
  id: string;
  workspace_id: string;
  kind: "finding" | "batch";
  scan_id: string | null;
  finding_id: string | null;
  fingerprint: string;
  rule_id: string;
  page_url: string | null;
  site_host: string;
  site_origin: string;
  source_id: string | null;
  connection_id: string | null;
  repo_full_name: string | null;
  repo_external_id: string | null;
  base_branch: string | null;
  base_sha: string | null;
  framework: string | null;
  status: AgentRunStatus;
  status_detail: string | null;
  failed_at_step: string | null;
  error_code: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  locked_by: string | null;
  cancel_requested_at: string | null;
  plan: AgentPlan | null;
  plan_hash: string | null;
  plan_revision: number;
  plan_ready_at: string | null;
  plan_approved_by: string | null;
  plan_approved_at: string | null;
  feedback: string | null;
  inputs: Record<string, { value: string; by: string | null; at: string }>;
  files_inspected: AgentContext["snapshot"]["entries"] | unknown[];
  patch: { explanation: string; files: StoredProposalFile[] } | { purged: true } | null;
  review: unknown;
  validation: unknown;
  correction_rounds: number;
  proposal_id: string | null;
  batch_id: string | null;
  verification_id: string | null;
  result: Record<string, unknown> | null;
  model: string | null;
  usage: Partial<AgentUsage>;
  checkpoint: { stage: "investigate" | "implement"; messages: ClaudeMessage[] } | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export class AgentRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

/* ───────────────────────── persistence helpers ───────────────────────── */

export async function logAgentEvent(
  run: Pick<AgentRunRow, "id" | "workspace_id">,
  e: {
    stage: AgentStage | null;
    kind: string;
    actor?: "agent" | "system" | "user";
    userId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
  },
) {
  const detail = JSON.stringify(e.detail ?? {});
  await supabaseAdmin.from("geo_agent_events").insert({
    run_id: run.id,
    workspace_id: run.workspace_id,
    stage: e.stage,
    kind: e.kind,
    actor: e.actor ?? "agent",
    user_id: e.userId ?? null,
    summary: e.summary.slice(0, 300),
    detail: (detail.length > 4000 ? { truncated: true } : (e.detail ?? {})) as Json,
  });
}

/**
 * Move a run through the state machine. Compare-and-set on the current status:
 * returns null when the run moved on (another worker, a cancel, a person).
 */
export async function transition(
  run: AgentRunRow,
  event: AgentEvent,
  patch: Record<string, unknown> = {},
): Promise<AgentRunRow | null> {
  const to = nextStatus(run.status, event);
  if (!to)
    throw new AgentRunError("illegal_transition", `A run can't go from ${run.status} on ${event}.`);
  const terminal = [
    "verified_fixed",
    "not_verified",
    "not_fixable",
    "failed",
    "cancelled",
    "closed",
    "stale",
  ].includes(to);
  const { data, error } = await supabaseAdmin
    .from("geo_agent_runs")
    .update({
      ...patch,
      status: to,
      ...(terminal ? { completed_at: new Date().toISOString(), lease_until: null } : {}),
    } as never)
    .eq("id", run.id)
    .eq("status", run.status)
    .select(RUN_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as AgentRunRow) ?? null;
}

async function patchRun(run: AgentRunRow, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("geo_agent_runs")
    .update(patch as never)
    .eq("id", run.id);
  if (error) throw new Error(error.message);
  Object.assign(run, patch);
}

async function loadRun(id: string): Promise<AgentRunRow | null> {
  const { data } = await supabaseAdmin
    .from("geo_agent_runs")
    .select(RUN_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as AgentRunRow) ?? null;
}

/* ───────────────────────── context ───────────────────────── */

type ScanPageRow = {
  url: string;
  final_url: string | null;
  state: string;
  status_code: number | null;
  analysis: PageAnalysis | null;
};

function factsOf(r: ScanPageRow): PageFactsView {
  const a = r.analysis!;
  return {
    url: a.url,
    statusCode: r.status_code,
    title: a.title,
    description: a.metaDescription,
    canonical: a.canonicals[0] ?? null,
    lang: a.lang,
    h1: a.headings
      .filter((h) => h.level === 1)
      .map((h) => h.text)
      .slice(0, 3),
    headings: a.headings.slice(0, 25).map((h) => `h${h.level}: ${h.text}`),
    schemaTypes: a.schema.types.slice(0, 15),
    wordCount: a.text.words,
    excerpt: a.text.excerpt,
    rendering: a.rendering ? `${a.rendering.mode}: ${a.rendering.reason}` : "http",
  };
}

async function loadContext(run: AgentRunRow): Promise<{
  ctx: Omit<AgentContext, "inputs" | "feedback" | "previousPlan">;
  source: SourceRow;
  connection: ConnectionRow;
  pages: ScanPageRow[];
}> {
  const [{ data: finding }, { data: scan }, { data: source }] = await Promise.all([
    supabaseAdmin
      .from("geo_findings")
      .select("id, scan_id, rule_id, fix_id, page_url, title, detail, evidence, severity, category")
      .eq("id", run.finding_id ?? "00000000-0000-0000-0000-000000000000")
      .eq("workspace_id", run.workspace_id)
      .maybeSingle(),
    supabaseAdmin
      .from("geo_scans")
      .select("id, origin, host, site")
      .eq("id", run.scan_id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle(),
    supabaseAdmin
      .from("workspace_sources")
      .select(SOURCE_COLS)
      .eq("id", run.source_id ?? "00000000-0000-0000-0000-000000000000")
      .eq("workspace_id", run.workspace_id)
      .maybeSingle(),
  ]);
  if (!finding) throw new AgentRunError("finding_missing", "The finding no longer exists.");
  if (!scan)
    throw new AgentRunError("scan_missing", "The scan behind this finding no longer exists.");
  if (!source)
    throw new AgentRunError("source_missing", "The linked repository was removed from Mellox.");
  const src = source as unknown as SourceRow;
  const { data: conn } = await supabaseAdmin
    .from("workspace_connections")
    .select(CONNECTION_COLS)
    .eq("id", src.connection_id)
    .maybeSingle();
  const connection = conn as unknown as ConnectionRow | null;
  if (!connection || connection.status === "revoked" || connection.status === "suspended")
    throw new AgentRunError(
      "access_lost",
      "GitHub access for this workspace was revoked or suspended.",
    );
  if (src.status === "access_lost")
    throw new AgentRunError("access_lost", `Mellox lost access to ${src.full_name}.`);
  if (
    !ownershipIsCurrent({
      status: src.ownership_status,
      checkedHost: src.ownership_site_host,
      checkedAt: src.ownership_checked_at,
      siteHost: run.site_host,
    })
  ) {
    throw new AgentRunError(
      "ownership",
      `Mellox hasn't verified that ${src.full_name} builds ${run.site_host}. Verify the repository, then retry.`,
    );
  }

  const installationId = connection.external_account_id;
  const snapshot = await withAccess(
    connection,
    run.created_by,
    async (): Promise<RepoSnapshot & { deps: string[] }> => {
      const branch = await getBranch(
        installationId,
        src.full_name,
        run.base_branch ?? src.branch ?? src.default_branch ?? "main",
      );
      if (!branch)
        throw new AgentRunError(
          "branch_missing",
          `Branch “${run.base_branch}” no longer exists in ${src.full_name}.`,
        );
      const tree = await getTreeEntries(installationId, src.full_name, branch.treeSha);
      const entries = tree.truncated
        ? await getTreeScoped(installationId, src.full_name, branch.treeSha, [
            "src",
            "app",
            "pages",
            "public",
            "components",
            "layouts",
            "content",
            "static",
            "docs",
          ])
        : tree.entries;
      const pkgEntry = entries.find((e) => e.path === "package.json");
      let pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      } | null = null;
      if (pkgEntry && pkgEntry.size < 256_000) {
        try {
          pkg = JSON.parse((await readBlob(installationId, src.full_name, pkgEntry.sha)) ?? "null");
        } catch {
          pkg = null;
        }
      }
      const { framework, evidence } = detectFramework(
        [...new Set(entries.map((e) => e.path.split("/")[0]))],
        pkg,
      );
      return {
        repo: src.full_name,
        branch: branch.name,
        sha: branch.sha,
        entries,
        truncated: tree.truncated,
        framework,
        frameworkEvidence: evidence,
        deps: Object.keys({ ...(pkg?.devDependencies ?? {}), ...(pkg?.dependencies ?? {}) }),
      };
    },
  );

  const { data: pageRows } = await supabaseAdmin
    .from("geo_scan_pages")
    .select("url, final_url, state, status_code, analysis")
    .eq("scan_id", scan.id)
    .eq("state", "fetched")
    .limit(200);
  const pages = ((pageRows ?? []) as unknown as ScanPageRow[]).filter((r) => r.analysis);
  const siteText = pages.slice(0, 60).flatMap((r) => {
    const a = r.analysis!;
    return [
      a.title,
      a.metaDescription,
      a.og?.["og:site_name"],
      ...a.headings.map((h) => h.text),
      a.text.excerpt,
      a.trust?.siteName,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
  });
  const rule = RULE_BY_ID.get(run.rule_id);
  const strategy = strategyForRule(run.rule_id);
  const playbook = playbookFor(
    snapshot.framework,
    snapshot.entries.map((e) => e.path),
  );
  const targetPlan = planFixTarget({
    ruleId: run.rule_id,
    pageUrl: run.page_url,
    framework: snapshot.framework,
    paths: snapshot.entries.map((e) => e.path),
  });
  const home = pages.find((r) => r.analysis!.pageType === "home")?.analysis ?? null;
  const recipe = rule?.fixId
    ? fixRecipeFor(rule.fixId, {
        url: run.site_origin,
        pageUrl: run.page_url,
        brandName: home?.schema.organizations[0]?.name ?? home?.trust.siteName ?? null,
        description: home?.metaDescription ?? null,
      })
    : null;
  const { deps: dependencies, ...snap } = snapshot;
  return {
    source: src,
    connection,
    pages,
    ctx: {
      runId: run.id,
      workspaceId: run.workspace_id,
      userId: run.created_by,
      finding: {
        ruleId: run.rule_id,
        title: finding.title,
        detail: finding.detail,
        evidence: (finding.evidence ?? {}) as Record<string, unknown>,
        pageUrl: finding.page_url,
        severity: (finding as { severity?: string | null }).severity ?? rule?.severity ?? null,
        category: (finding as { category?: string | null }).category ?? rule?.category ?? null,
        recommendation: rule?.recommendation ?? null,
      },
      siteOrigin: run.site_origin,
      site: scan.site as unknown as SiteArtifacts,
      snapshot: snap,
      playbook,
      strategy,
      fixKind: fixKindForRule(run.rule_id),
      recipe,
      targetHints: targetPlan.ok ? targetPlan.files.map((f) => f.path) : [],
      dependencies,
      allowedImports: allowedImportsFor(playbook, dependencies),
      siteText,
    },
  };
}

function agentDeps(
  run: AgentRunRow,
  connection: ConnectionRow,
  repo: string,
  pages: ScanPageRow[],
  ruleText: string,
  stage: "investigate" | "implement",
): AgentDeps {
  const installationId = connection.external_account_id;
  return {
    toolDeps: {
      readBlob: (sha) =>
        withAccess(connection, run.created_by, () => readBlob(installationId, repo, sha)),
      fetchLive: async (url) => {
        const { safeFetch } = await import("@/server/safe-fetch");
        try {
          const res = await safeFetch(url, {
            timeoutMs: 15_000,
            maxBytes: 1_500_000,
            onOverflow: "truncate",
            headers: { "user-agent": "MelloxBot/1.0 (+https://mellox.ai)" },
          });
          return { status: res.status, html: res.text() };
        } catch {
          return null;
        }
      },
      pageFacts: async (url) => {
        const wanted = url ?? run.page_url ?? `${run.site_origin}/`;
        const hit = pages.filter(
          (r) => r.url === wanted || r.final_url === wanted || r.analysis!.url === wanted,
        );
        return (hit.length ? hit : pages.filter((r) => r.analysis!.pageType === "home"))
          .slice(0, 1)
          .map(factsOf);
      },
      ruleInfo: () => ruleText,
    },
    onEvent: async (e: StageEvent) => {
      await logAgentEvent(run, {
        stage: e.stage,
        kind: e.kind,
        summary: e.summary,
        detail: e.detail,
      });
    },
    isCancelled: async () => {
      const { data } = await supabaseAdmin
        .from("geo_agent_runs")
        .select("cancel_requested_at, status")
        .eq("id", run.id)
        .maybeSingle();
      return Boolean(data?.cancel_requested_at) || data?.status === "cancelled";
    },
    checkpoint: async (s, messages) => {
      // Renew the lease with every checkpoint so a long stage keeps its claim.
      await supabaseAdmin
        .from("geo_agent_runs")
        .update({
          checkpoint: { stage: s ?? stage, messages } as unknown as Json,
          lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
        })
        .eq("id", run.id)
        .eq("locked_by", WORKER);
    },
  };
}

function ruleInfoText(ctx: Omit<AgentContext, "inputs" | "feedback" | "previousPlan">): string {
  const rule = RULE_BY_ID.get(ctx.finding.ruleId);
  return JSON.stringify(
    {
      rule: ctx.finding.ruleId,
      title: rule?.title ?? ctx.finding.title,
      recommendation: rule?.recommendation ?? null,
      finding: ctx.finding.detail,
      recipe: ctx.recipe,
      strategy: ctx.strategy,
      likelyFiles: ctx.targetHints,
      framework: ctx.snapshot.framework,
      playbook: ctx.playbook.conventions,
    },
    null,
    2,
  );
}

const usageOf = (run: AgentRunRow): AgentUsage => ({ ...emptyUsage(), ...(run.usage ?? {}) });

/* ───────────────────────── stages ───────────────────────── */

async function runInvestigation(run: AgentRunRow) {
  if (run.status === "queued") {
    const moved = await transition(run, "start", {
      model: geoAgentModel(),
      status_detail: "Reading the finding and the repository",
    });
    if (!moved) return;
    run = moved;
    await logAgentEvent(run, {
      stage: "investigate",
      kind: "stage_started",
      actor: "system",
      summary: "Started investigating the repository",
    });
  }
  const { ctx, connection, pages } = await loadContext(run);
  await patchRun(run, { base_sha: ctx.snapshot.sha, framework: ctx.snapshot.framework });
  const inputs = Object.fromEntries(Object.entries(run.inputs ?? {}).map(([k, v]) => [k, v.value]));
  const full: AgentContext = {
    ...ctx,
    inputs,
    feedback: run.feedback,
    previousPlan: run.feedback ? run.plan : null,
  };
  const spent = usageOf(run);
  const budget = geoAgentMaxCostUsd() * STAGE_LIMITS.investigate.maxCostShare;
  const resume = run.checkpoint?.stage === "investigate" ? run.checkpoint.messages : undefined;

  const outcome = await investigateAndPlan(
    full,
    agentDeps(run, connection, ctx.snapshot.repo, pages, ruleInfoText(ctx), "investigate"),
    {
      state: newToolState(),
      budgetUsd: Math.max(0.05, budget),
      resume,
    },
  );
  const usage = addUsage(spent, outcome.usage);
  if (!outcome.ok) {
    if (outcome.code === "cancelled") return cancelRunNow(run, null);
    await transition(run, "fail", {
      error_code: outcome.code,
      error: outcome.message,
      failed_at_step: "investigating",
      status_detail: outcome.message,
      usage,
      checkpoint: null,
    });
    await logAgentEvent(run, {
      stage: "investigate",
      kind: "error",
      actor: "system",
      summary: outcome.message,
    });
    return;
  }
  const plan = outcome.plan;
  const common = {
    plan: plan as unknown as Json,
    plan_ready_at: new Date().toISOString(),
    plan_revision: run.plan_revision + 1,
    files_inspected: outcome.filesInspected as unknown as Json,
    usage,
    checkpoint: null,
    feedback: null,
    error: null,
    error_code: null,
  };
  if (!plan.feasible) {
    await transition(run, "not_fixable", {
      ...common,
      status_detail: plan.notFixableReason,
      failed_at_step: "plan_ready",
      result: { manualSteps: plan.manualSteps },
    });
    await logAgentEvent(run, {
      stage: "investigate",
      kind: "plan_ready",
      summary: `Can't be automated safely: ${plan.notFixableReason ?? ""}`.slice(0, 290),
    });
    return;
  }
  const missing = plan.needsInput.filter((n) => !inputs[n.key]);
  if (missing.length) {
    await transition(run, "input_needed", {
      ...common,
      plan_hash: null,
      status_detail: `Needs ${missing.map((m) => m.label).join(", ")}`,
    });
    await logAgentEvent(run, {
      stage: "investigate",
      kind: "input_requested",
      summary: `Needs your input: ${missing.map((m) => m.label).join(", ")}`.slice(0, 290),
    });
    return;
  }
  await transition(run, "plan_submitted", {
    ...common,
    plan_hash: hashPlan(plan, inputs),
    status_detail: "Plan ready for your review",
  });
  await logAgentEvent(run, {
    stage: "investigate",
    kind: "plan_ready",
    summary: `Plan ready: ${plan.strategy} — ${plan.files.map((f) => f.path).join(", ")}`.slice(
      0,
      290,
    ),
    detail: {
      files: plan.files.map((f) => f.path),
      confidence: plan.confidence,
      costUsd: usage.costUsd,
    },
  });
}

async function runImplementation(run: AgentRunRow) {
  if (!run.plan || !run.plan_approved_at)
    throw new AgentRunError("no_plan", "The plan hasn't been approved.");
  const { ctx, connection, source, pages } = await loadContext(run);
  if (run.base_sha && ctx.snapshot.sha !== run.base_sha) {
    await transition(run, "base_moved", {
      error_code: "base_moved",
      status_detail: `${run.base_branch} changed since the plan was made. Retry to re-plan against the latest code.`,
      failed_at_step: "implementing",
      checkpoint: null,
    });
    await logAgentEvent(run, {
      stage: "implement",
      kind: "error",
      actor: "system",
      summary: `${run.base_branch} moved; the plan is out of date`,
    });
    return;
  }
  const inputs = Object.fromEntries(Object.entries(run.inputs ?? {}).map(([k, v]) => [k, v.value]));
  const full: AgentContext = { ...ctx, inputs, feedback: null, previousPlan: null };
  const spent = usageOf(run);
  const budget = geoAgentMaxCostUsd() - spent.costUsd;
  if (budget <= 0.02) throw new AgentRunError("budget", "The run used its AI spend limit.");
  await logAgentEvent(run, {
    stage: "implement",
    kind: "stage_started",
    actor: "system",
    summary: "Implementing the approved plan",
  });
  const resume = run.checkpoint?.stage === "implement" ? run.checkpoint.messages : undefined;
  const outcome = await implementPlan(
    full,
    run.plan,
    agentDeps(run, connection, ctx.snapshot.repo, pages, ruleInfoText(ctx), "implement"),
    {
      state: newToolState(),
      budgetUsd: budget,
      resume,
    },
  );
  const usage = addUsage(spent, outcome.usage);
  if (!outcome.ok) {
    if (outcome.code === "cancelled") return cancelRunNow(run, null);
    const moved = await transition(run, "patch_submitted", {});
    const r2 = moved
      ? await transition(moved, "fail", {
          error_code: outcome.code,
          error: outcome.message,
          failed_at_step: "validating",
          status_detail: outcome.message.slice(0, 500),
          usage,
          review: (outcome.review ?? null) as unknown as Json,
          validation: (outcome.validation ?? null) as unknown as Json,
          patch: outcome.files
            ? ({ explanation: "", files: outcome.files.map(storedFile) } as unknown as Json)
            : null,
          checkpoint: null,
        })
      : null;
    void r2;
    await logAgentEvent(run, {
      stage: "validate",
      kind: "error",
      actor: "system",
      summary: outcome.message.slice(0, 290),
    });
    return;
  }

  // Record the patch, then walk the machine: reviewing → validating → awaiting approval.
  const files = outcome.files.map(storedFile);
  let r = await transition(run, "patch_submitted", {
    usage,
    correction_rounds: outcome.corrections,
  });
  if (!r) return;
  r = await transition(r, "review_passed", { review: outcome.review as unknown as Json });
  if (!r) return;
  const proposal = await createProposalFromAgent(r, {
    source,
    connection,
    files,
    explanation: outcome.explanation,
    validation: outcome.validation,
    baseSha: ctx.snapshot.sha,
    baseBranch: ctx.snapshot.branch,
    framework: ctx.snapshot.framework,
    strategy: run.plan.strategy,
  });
  await transition(r, "validation_passed", {
    validation: outcome.validation as unknown as Json,
    patch: { explanation: outcome.explanation, files } as unknown as Json,
    proposal_id: proposal.id,
    checkpoint: null,
    status_detail: "Patch ready for your approval",
  });
  await logAgentEvent(r, {
    stage: "validate",
    kind: "proposal",
    summary: `Patch ready: ${files.length} file(s), +${files.reduce((s, f) => s + (f.additions ?? 0), 0)}/−${files.reduce((s, f) => s + (f.deletions ?? 0), 0)} lines`,
    detail: { proposalId: proposal.id, costUsd: usage.costUsd },
  });
}

function storedFile(f: {
  path: string;
  action: "create" | "update";
  after: string;
  diff: string;
  additions: number;
  deletions: number;
  explanation: string;
}): StoredProposalFile {
  return {
    path: f.path,
    action: f.action,
    baseBlobSha: null,
    after: f.after,
    diff: f.diff,
    additions: f.additions,
    deletions: f.deletions,
    explanation: f.explanation,
  };
}

/** The agent's validated patch becomes a draft proposal; approval and the PR reuse the existing workflow. */
export async function createProposalFromAgent(
  run: AgentRunRow,
  args: {
    source: SourceRow;
    connection: ConnectionRow;
    files: StoredProposalFile[];
    explanation: string;
    validation: unknown;
    baseSha: string;
    baseBranch: string;
    framework: string | null;
    strategy: string;
  },
): Promise<ProposalRow> {
  // A newer draft replaces an older one for the same finding.
  await supabaseAdmin
    .from("geo_fix_proposals")
    .update({ status: "discarded" })
    .eq("workspace_id", run.workspace_id)
    .eq("fingerprint", run.fingerprint)
    .eq("status", "draft");
  const hash = contentHash(
    args.files.map((f) => ({ path: f.path, action: f.action, after: f.after ?? "" })),
    args.baseSha,
  );
  const rule = RULE_BY_ID.get(run.rule_id);
  const { data, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .insert({
      workspace_id: run.workspace_id,
      scan_id: run.scan_id,
      finding_id: run.finding_id,
      fingerprint: run.fingerprint,
      rule_id: run.rule_id,
      fix_id: rule?.fixId ?? fixKindForRule(run.rule_id) ?? run.rule_id.replace(/\./g, "-"),
      page_url: run.page_url,
      site_origin: run.site_origin,
      provider: "github",
      connection_id: args.connection.id,
      source_id: args.source.id,
      repo_full_name: args.source.full_name,
      repo_external_id: args.source.external_id,
      framework: args.framework,
      base_branch: args.baseBranch,
      base_sha: args.baseSha,
      strategy: `agent: ${args.strategy}`.slice(0, 200),
      files: args.files as unknown as Json,
      explanation: args.explanation,
      validation: args.validation as Json,
      content_hash: hash,
      model: run.model ?? geoAgentModel(),
      status: "draft",
      created_by: run.created_by,
      agent_run_id: run.id,
    })
    .select(PROPOSAL_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the proposal");
  await recordAudit({
    workspaceId: run.workspace_id,
    userId: run.created_by,
    action: "geo.agent.proposal_created",
    entity: "geo_fix_proposal",
    payload: {
      runId: run.id,
      proposalId: data.id,
      repository: args.source.full_name,
      files: args.files.map((f) => f.path),
    },
  });
  return data as unknown as ProposalRow;
}

/* ───────────────────────── cancel / sync ───────────────────────── */

export async function cancelRunNow(run: AgentRunRow, userId: string | null) {
  const moved = await transition(run, "cancel", { status_detail: "Cancelled", checkpoint: null });
  if (moved)
    await logAgentEvent(run, {
      stage: null,
      kind: "cancel",
      actor: userId ? "user" : "system",
      userId,
      summary: "Run cancelled",
    });
  return moved;
}

/** Mirror a proposal's (and its verification's) state into its agent run. */
export async function syncAgentRunFromProposal(proposalId: string) {
  const { data: p } = await supabaseAdmin
    .from("geo_fix_proposals")
    .select("id, status, agent_run_id, pr_url, pr_number")
    .eq("id", proposalId)
    .maybeSingle();
  if (!p?.agent_run_id) return;
  const run = await loadRun(p.agent_run_id);
  if (!run) return;
  const { data: v } = await supabaseAdmin
    .from("geo_verifications")
    .select("id, status, outcome_detail")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = statusFromProposal(run.status, p.status as never, (v?.status as never) ?? null);
  if (next === run.status) return;
  const terminal = [
    "verified_fixed",
    "not_verified",
    "failed",
    "cancelled",
    "closed",
    "stale",
  ].includes(next);
  const detail =
    next === "pr_open"
      ? `Pull request #${p.pr_number} is open`
      : next === "merged"
        ? "Merged — waiting for the deploy before re-scanning"
        : next === "rescan_pending"
          ? "Re-scanning the live site"
          : next === "verified_fixed"
            ? "Verified fixed on the live site"
            : next === "not_verified"
              ? (v?.outcome_detail ?? "The live site still fails this check")
              : null;
  await supabaseAdmin
    .from("geo_agent_runs")
    .update({
      status: next,
      status_detail: detail,
      verification_id: v?.id ?? run.verification_id,
      ...(terminal ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", run.id)
    .eq("status", run.status);
  await logAgentEvent(run, {
    stage:
      next === "rescan_pending" || next === "verified_fixed" || next === "not_verified"
        ? "verify"
        : "apply",
    kind: next === "pr_open" || next === "merged" || next === "closed" ? "pr" : "verification",
    actor: "system",
    summary: detail ?? `Status: ${next}`,
  });
}

/* ───────────────────────── worker ───────────────────────── */

async function advance(run: AgentRunRow) {
  if (run.cancel_requested_at) {
    await cancelRunNow(run, null);
    return;
  }
  try {
    if (run.status === "queued" || run.status === "investigating") await runInvestigation(run);
    else if (
      run.status === "implementing" ||
      run.status === "reviewing" ||
      run.status === "validating" ||
      run.status === "correcting"
    ) {
      // Review/validation/correction happen inside one implementation pass; resume from implementing.
      if (run.status !== "implementing") {
        await supabaseAdmin
          .from("geo_agent_runs")
          .update({ status: "implementing" })
          .eq("id", run.id)
          .eq("status", run.status);
        run.status = "implementing";
      }
      await runImplementation(run);
    }
  } catch (error) {
    await handleRunError(run, error);
  } finally {
    await supabaseAdmin
      .from("geo_agent_runs")
      .update({ lease_until: null, locked_by: null })
      .eq("id", run.id)
      .eq("locked_by", WORKER);
  }
}

async function handleRunError(run: AgentRunRow, error: unknown) {
  const fresh = (await loadRun(run.id)) ?? run;
  const retry = (code: string, message: string, at: string) =>
    supabaseAdmin
      .from("geo_agent_runs")
      .update({ next_attempt_at: at, error_code: code, status_detail: message })
      .eq("id", run.id);
  if (error instanceof GitHubRateLimitError) {
    await retry(
      "github_rate_limited",
      "GitHub's rate limit was reached; continuing automatically.",
      error.resetAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    );
    return;
  }
  if (
    error instanceof AnthropicGatewayError &&
    ["timeout", "rate_limited", "network_error"].includes(error.code ?? "") &&
    fresh.attempts < fresh.max_attempts
  ) {
    await retry(
      error.code ?? "retry",
      "The AI model was busy; retrying shortly.",
      new Date(Date.now() + 60_000 * fresh.attempts).toISOString(),
    );
    await logAgentEvent(run, {
      stage: null,
      kind: "error",
      actor: "system",
      summary: `Model unavailable (${error.code}); retrying`,
    });
    return;
  }
  const code =
    error instanceof AgentRunError
      ? error.code
      : error instanceof GitHubAccessError
        ? "access_lost"
        : error instanceof BudgetExceededError
          ? "budget"
          : error instanceof AnthropicGatewayError
            ? (error.code ?? "model_error")
            : "error";
  const message =
    error instanceof GitHubAccessError
      ? "Mellox's GitHub access to this repository was lost or is insufficient."
      : error instanceof Error
        ? error.message
        : "The run failed.";
  console.error(`[geo-agent] run ${run.id} failed`, error);
  if (["failed", "cancelled", "not_fixable"].includes(fresh.status)) return;
  if (!nextStatus(fresh.status, "fail")) return;
  await transition(fresh, "fail", {
    error_code: code.slice(0, 60),
    error: message.slice(0, 2000),
    status_detail: message.slice(0, 500),
    failed_at_step:
      fresh.status === "queued" || fresh.status === "investigating"
        ? "investigating"
        : "implementing",
    checkpoint: null,
  });
  await logAgentEvent(run, {
    stage: null,
    kind: "error",
    actor: "system",
    summary: message.slice(0, 290),
  });
}

export async function runDueAgentRuns(opts: { budgetMs?: number; max?: number; id?: string } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 100_000);
  const results = { claimed: 0, errors: 0 };
  while (results.claimed < (opts.max ?? 1) && Date.now() < deadline - 20_000) {
    const { data, error } = await supabaseAdmin.rpc("claim_geo_agent_runs", {
      p_worker: WORKER,
      p_max: 1,
      p_lease_seconds: LEASE_SECONDS,
      ...(opts.id ? { p_id: opts.id } : {}),
    });
    if (error) throw new Error(`claim_geo_agent_runs failed: ${error.message}`);
    const row = (data as unknown as AgentRunRow[] | null)?.[0];
    if (!row) break;
    results.claimed++;
    try {
      await advance(row);
    } catch (err) {
      results.errors++;
      console.error(`[geo-agent] advance ${row.id} crashed`, err);
    }
    if (opts.id) break;
  }
  return results;
}

/** Advance a run right after the response is sent. */
export function kickAgentRun(id: string): void {
  after(async () => {
    try {
      await runDueAgentRuns({ id, budgetMs: 290_000, max: 1 });
    } catch (error) {
      console.error(`[geo-agent] kick ${id} failed`, error);
    }
  });
}

export { loadRun as loadAgentRunAdmin };
