// service.server.ts — what people do with the Mellox GEO Engineer:
//
//   start          a finding + a verified repository → a queued run
//   view           run, activity log, plan, patch, proposal, verification, timeline
//   approve plan   bound to the plan hash the person reviewed
//   revise plan    feedback → re-investigate (bounded)
//   inputs         facts the fix needs (authors, dates, profiles)
//   cancel         stops the run; closes Mellox's pull request if one is open
//   retry          a new run from investigation, or from the approved plan
//
// Callers (src/server/fns/geo-agent.ts) authenticate; every read goes through
// the caller's RLS client first so ids from another workspace aren't found.
// Patch approval and the pull request reuse src/server/geo/fixes/service.server.ts.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  GEO_AGENT_NAME,
  type AgentFileInspected,
  type AgentPlan,
  type AgentReview,
  type AgentRunView,
  type AgentUsage,
} from "@/lib/geo/agent-contracts";
import { canCancel, canRetry, isTerminal, nextStatus, timelineFor } from "@/lib/geo/agent-state";
import type { ProposalValidation } from "@/lib/geo/fix-contracts";
import { recordAudit } from "@/server/audit.server";
import {
  presentProposal,
  presentVerification,
  PROPOSAL_COLS,
  VERIFICATION_COLS,
  type ProposalRow,
  type VerificationRow,
} from "../fixes/present";
import {
  assertSourceOwnsHost,
  discardProposal,
  FixWorkflowError,
  loadConnectors,
  loadSourceWithConnection,
  normHost,
  type FixContext,
} from "../fixes/service.server";
import { strategyForRule } from "../fixes/strategies";
import { cmsFieldsForRule } from "@/lib/geo/cms-fixes";
import { isValidBaseBranch } from "@/server/connectors/github/paths";
import { hashPlan } from "./geo-coding-agent";
import { geoAgentEnabled, geoAgentModelConfigured } from "./flags";
import {
  cancelRunNow,
  kickAgentRun,
  logAgentEvent,
  RUN_COLS,
  transition,
  type AgentRunRow,
} from "./runner.server";

const MAX_PLAN_REVISIONS = 3;

export { geoAgentEnabled } from "./flags";

async function dailyLimitReached(workspaceId: string): Promise<boolean> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await supabaseAdmin
    .from("geo_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", since.toISOString());
  return (count ?? 0) >= dailyRunLimit();
}

function dailyRunLimit(): number {
  const n = Number(process.env.GEO_AGENT_DAILY_RUNS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 20;
}

async function loadRunRls(ctx: FixContext, runId: string): Promise<AgentRunRow> {
  const { data, error } = await ctx.supabase
    .from("geo_agent_runs")
    .select(RUN_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Agent run not found", 404);
  return data as unknown as AgentRunRow;
}

/* ───────────────────────── view ───────────────────────── */

export async function presentRun(
  ctx: FixContext,
  row: AgentRunRow,
  opts: { afterEventId?: number } = {},
) {
  const [events, proposal, verification] = await Promise.all([
    ctx.supabase
      .from("geo_agent_events")
      .select("id, at, stage, kind, actor, summary, detail")
      .eq("run_id", row.id)
      .gt("id", opts.afterEventId ?? 0)
      .order("id", { ascending: true })
      .limit(300),
    row.proposal_id
      ? ctx.supabase
          .from("geo_fix_proposals")
          .select(PROPOSAL_COLS)
          .eq("id", row.proposal_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.proposal_id
      ? ctx.supabase
          .from("geo_verifications")
          .select(VERIFICATION_COLS)
          .eq("proposal_id", row.proposal_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const p = (proposal.data as unknown as ProposalRow) ?? null;
  const v = (verification.data as unknown as VerificationRow) ?? null;
  const patch =
    row.patch && "files" in row.patch
      ? {
          explanation: row.patch.explanation,
          files: row.patch.files.map((f) => ({
            path: f.path,
            action: f.action,
            diff: f.diff ?? "",
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
            explanation: f.explanation ?? "",
          })),
        }
      : null;
  const inputs = Object.fromEntries(
    Object.entries(row.inputs ?? {}).map(([k, x]) => [k, { value: x.value, at: x.at }]),
  );
  const view: AgentRunView = {
    id: row.id,
    agentName: GEO_AGENT_NAME,
    model: row.model,
    status: row.status,
    statusDetail: row.status_detail,
    provider: row.provider ?? "github",
    assisted: (
      (row.result as { assisted?: AgentRunView["assisted"] } | null)?.assisted ?? []
    ).slice(0, 20),
    error: row.error ? { code: row.error_code, message: row.error } : null,
    fingerprint: row.fingerprint,
    ruleId: row.rule_id,
    pageUrl: row.page_url,
    repository: row.repo_full_name,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    framework: row.framework,
    plan: row.plan,
    planHash: row.status === "awaiting_plan_approval" ? row.plan_hash : null,
    planRevision: row.plan_revision,
    planApprovedAt: row.plan_approved_at,
    inputs,
    filesInspected: (row.files_inspected ?? []) as AgentFileInspected[],
    patch,
    review: (row.review as AgentReview) ?? null,
    validation: (row.validation as ProposalValidation) ?? null,
    correctionRounds: row.correction_rounds,
    proposal: p ? presentProposal(p, v) : null,
    verification: v ? presentVerification(v) : null,
    usage:
      row.usage && Object.keys(row.usage).length
        ? ({
            turns: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            ...row.usage,
          } as AgentUsage)
        : null,
    timeline: timelineFor({
      status: row.status,
      detectedAt: row.created_at,
      createdAt: row.created_at,
      planReadyAt: row.plan_ready_at,
      planApprovedAt: row.plan_approved_at,
      proposalCreatedAt: p?.created_at ?? null,
      prOpenedAt: p?.pr_number ? (p.approved_at ?? p.updated_at) : (p?.applied_at ?? null),
      mergedAt: p?.pr_merged_at ?? null,
      verifiedAt: v?.status === "verified" ? v.completed_at : null,
      failedAtStep: (row.failed_at_step as never) ?? null,
      statusDetail: row.status_detail,
      provider: row.provider ?? "github",
    }),
    actions: {
      approvePlan: ctx.canPropose && row.status === "awaiting_plan_approval",
      revisePlan:
        ctx.canPropose &&
        ["awaiting_plan_approval", "needs_input"].includes(row.status) &&
        row.plan_revision < MAX_PLAN_REVISIONS,
      submitInputs: ctx.canPropose && row.status === "needs_input",
      approvePatch:
        ctx.canPropose && row.status === "awaiting_patch_approval" && p?.status === "draft",
      cancel: ctx.canPropose && canCancel(row.status),
      retry: ctx.canPropose && canRetry(row.status),
      undo:
        ctx.canPropose &&
        Boolean(p && p.provider !== "github" && presentProposal(p, v).cms?.canUndo),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
  return {
    run: view,
    events: (events.data ?? []).map((e) => ({
      id: Number(e.id),
      at: e.at,
      stage: e.stage as never,
      kind: e.kind as never,
      actor: e.actor as "agent" | "system" | "user",
      summary: e.summary,
      detail: (e.detail ?? {}) as Record<string, unknown>,
    })),
  };
}

export async function getAgentRun(ctx: FixContext, runId: string, afterEventId?: number) {
  const row = await loadRunRls(ctx, runId);
  // Local development has no pg_cron: a due, unleased run is advanced when someone looks at it.
  if (
    ["queued", "investigating", "implementing", "reviewing", "validating", "correcting"].includes(
      row.status,
    ) &&
    Date.parse(row.next_attempt_at) <= Date.now() &&
    (!row.lease_until || Date.parse(row.lease_until) < Date.now())
  ) {
    kickAgentRun(row.id);
  }
  return presentRun(ctx, row, { afterEventId });
}

export async function getAgentRunForFinding(ctx: FixContext, findingId: string) {
  const { data: finding } = await ctx.supabase
    .from("geo_findings")
    .select("fingerprint")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", findingId)
    .maybeSingle();
  if (!finding) throw new FixWorkflowError("Finding not found", 404);
  const { data } = await ctx.supabase
    .from("geo_agent_runs")
    .select(RUN_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("fingerprint", finding.fingerprint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { run: null, events: [] };
  return getAgentRun(ctx, (data as unknown as AgentRunRow).id);
}

/** Latest run status per fingerprint in a scan (badges in the findings list). */
export async function listAgentRuns(ctx: FixContext, scanId: string) {
  const { data: findings } = await ctx.supabase
    .from("geo_findings")
    .select("fingerprint")
    .eq("workspace_id", ctx.workspaceId)
    .eq("scan_id", scanId)
    .limit(5000);
  const fingerprints = [...new Set((findings ?? []).map((f) => f.fingerprint))];
  if (!fingerprints.length)
    return {
      runs: {} as Record<string, { id: string; status: string; statusDetail: string | null }>,
    };
  const { data } = await ctx.supabase
    .from("geo_agent_runs")
    .select("id, fingerprint, status, status_detail, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .in("fingerprint", fingerprints.slice(0, 1000))
    .order("created_at", { ascending: false })
    .limit(2000);
  const runs: Record<string, { id: string; status: string; statusDetail: string | null }> = {};
  for (const r of data ?? [])
    if (!runs[r.fingerprint])
      runs[r.fingerprint] = { id: r.id, status: r.status, statusDetail: r.status_detail };
  return { runs };
}

/* ───────────────────────── start ───────────────────────── */

export type StartResult =
  | { ok: true; runId: string; joined: boolean }
  | { ok: false; reason: string; manualSteps?: string[]; validationSteps?: string[] };

export async function startAgentRun(
  ctx: FixContext,
  args: { findingId: string; sourceId?: string | null; baseBranch?: string | null },
): Promise<StartResult> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can run the GEO agent.", 403);
  if (!geoAgentEnabled())
    return { ok: false, reason: "The GEO coding agent is turned off on this server." };
  if (!geoAgentModelConfigured())
    return {
      ok: false,
      reason: "The AI model isn't configured on this server (OPENROUTER_API_KEY).",
    };

  const { data: finding, error } = await ctx.supabase
    .from("geo_findings")
    .select("id, scan_id, rule_id, fingerprint, page_url")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", args.findingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!finding) throw new FixWorkflowError("Finding not found", 404);
  const strategy = strategyForRule(finding.rule_id);
  if (strategy.mode === "manual") {
    return {
      ok: false,
      reason: "This finding can't be fixed safely from source code. Follow the steps below.",
      manualSteps: strategy.manualSteps,
      validationSteps: strategy.validationSteps,
    };
  }
  const { data: scan } = await ctx.supabase
    .from("geo_scans")
    .select("id, host, origin, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", finding.scan_id)
    .maybeSingle();
  if (!scan) throw new FixWorkflowError("Scan not found", 404);

  // Join a run that is already working on this finding.
  const { data: live } = await ctx.supabase
    .from("geo_agent_runs")
    .select("id, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("fingerprint", finding.fingerprint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (live && !isTerminal(live.status as never)) return { ok: true, runId: live.id, joined: true };

  // Which platform builds this site: a CMS site is changed through its API.
  if (!args.sourceId) {
    const { resolveSite } = await import("@/server/sites/resolve.server");
    const resolution = await resolveSite(ctx.workspaceId, scan.host, { live: true });
    const cms =
      resolution.binding && resolution.binding.provider !== "github"
        ? resolution.binding
        : !resolution.binding
          ? (resolution.candidates.find((c) => c.provider !== "github") ?? null)
          : null;
    if (cms) {
      if (!cms.verified) return { ok: false, reason: cms.proof };
      if (!cmsFieldsForRule(finding.rule_id).length)
        return {
          ok: false,
          reason:
            "This finding needs changes Mellox can't make safely on its own. Follow the steps below.",
          manualSteps: strategy.manualSteps,
          validationSteps: strategy.validationSteps,
        };
      if (cms.provider === "webflow" && cms.missingWriteScopes.length)
        return {
          ok: false,
          reason: "Reconnect Webflow and allow Mellox to edit your site, then try again.",
        };
      if (await dailyLimitReached(ctx.workspaceId))
        return {
          ok: false,
          reason: `This workspace has used today's ${dailyRunLimit()} GEO agent runs. Try again tomorrow.`,
        };
      const name = cms.provider === "webflow" ? "Webflow" : "WordPress";
      const { data: row, error: insertError } = await supabaseAdmin
        .from("geo_agent_runs")
        .insert({
          workspace_id: ctx.workspaceId,
          provider: cms.provider,
          scan_id: scan.id,
          finding_id: finding.id,
          fingerprint: finding.fingerprint,
          rule_id: finding.rule_id,
          page_url: finding.page_url,
          site_host: normHost(scan.host),
          site_origin: scan.origin,
          connection_id: cms.connectionId,
          site_ref: {
            provider: cms.provider,
            ...(cms.provider === "wordpress" ? { siteUrl: cms.siteUrl, seo: cms.seo } : {}),
            ...(cms.provider === "webflow" ? { siteId: cms.siteId, siteName: cms.siteName } : {}),
          } as unknown as Json,
          status: "queued",
          status_detail: "Queued",
          created_by: ctx.userId,
        })
        .select(RUN_COLS)
        .single();
      if (insertError || !row) {
        if (insertError?.code === "23505") {
          const { data: again } = await supabaseAdmin
            .from("geo_agent_runs")
            .select("id")
            .eq("workspace_id", ctx.workspaceId)
            .eq("fingerprint", finding.fingerprint)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (again) return { ok: true, runId: again.id, joined: true };
        }
        throw new Error(insertError?.message ?? "Couldn't start the agent");
      }
      const run = row as unknown as AgentRunRow;
      await logAgentEvent(run, {
        stage: null,
        kind: "stage_started",
        actor: "user",
        userId: ctx.userId,
        summary: `Asked the GEO Engineer to fix this finding on ${name} (${cms.provider === "wordpress" ? cms.siteUrl : cms.siteName})`,
      });
      await recordAudit({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        action: "geo.agent.started",
        entity: "geo_agent_run",
        payload: { runId: run.id, ruleId: finding.rule_id, provider: cms.provider },
      });
      kickAgentRun(run.id);
      return { ok: true, runId: run.id, joined: false };
    }
  }

  let sourceId = args.sourceId ?? null;
  if (!sourceId) {
    const { sources } = await loadConnectors(ctx);
    const match = sources.filter((s) => normHost(s.site_host) === normHost(scan.host));
    sourceId = (match.find((s) => s.status === "active") ?? match[0])?.id ?? null;
  }
  if (!sourceId)
    return { ok: false, reason: `Link the GitHub repository that builds ${scan.host} first.` };
  const { source, connection } = await loadSourceWithConnection(ctx, sourceId);
  assertSourceOwnsHost(source, scan.host);
  if (!source.agent_consent_at && ctx.canManage) {
    // An admin starting the agent is the consent to send this repository's code to the model.
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("workspace_sources")
      .update({ agent_consent_at: now, agent_consent_by: ctx.userId })
      .eq("id", source.id);
    source.agent_consent_at = now;
  }
  if (!source.agent_consent_at) {
    return {
      ok: false,
      reason: `A workspace admin must allow the GEO agent to read ${source.full_name} (its code is sent to the AI model to plan the fix).`,
    };
  }
  const baseBranch = args.baseBranch ?? source.branch ?? source.default_branch ?? "main";
  if (!isValidBaseBranch(baseBranch)) throw new FixWorkflowError("That branch name isn't valid.");

  if (await dailyLimitReached(ctx.workspaceId)) {
    return {
      ok: false,
      reason: `This workspace has used today's ${dailyRunLimit()} GEO agent runs. Try again tomorrow.`,
    };
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("geo_agent_runs")
    .insert({
      workspace_id: ctx.workspaceId,
      scan_id: scan.id,
      finding_id: finding.id,
      fingerprint: finding.fingerprint,
      rule_id: finding.rule_id,
      page_url: finding.page_url,
      site_host: normHost(scan.host),
      site_origin: scan.origin,
      source_id: source.id,
      connection_id: connection.id,
      repo_full_name: source.full_name,
      repo_external_id: source.external_id,
      base_branch: baseBranch,
      status: "queued",
      status_detail: "Queued",
      created_by: ctx.userId,
    })
    .select(RUN_COLS)
    .single();
  if (insertError || !row) {
    if (insertError?.code === "23505") {
      const { data: again } = await supabaseAdmin
        .from("geo_agent_runs")
        .select("id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("fingerprint", finding.fingerprint)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (again) return { ok: true, runId: again.id, joined: true };
    }
    throw new Error(insertError?.message ?? "Couldn't start the agent");
  }
  const run = row as unknown as AgentRunRow;
  await logAgentEvent(run, {
    stage: null,
    kind: "stage_started",
    actor: "user",
    userId: ctx.userId,
    summary: `Asked the GEO Engineer to fix this finding on ${source.full_name}@${baseBranch}`,
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.agent.started",
    entity: "geo_agent_run",
    payload: { runId: run.id, ruleId: finding.rule_id, repository: source.full_name, baseBranch },
  });
  kickAgentRun(run.id);
  return { ok: true, runId: run.id, joined: false };
}

/* ───────────────────────── plan approval / revision / inputs ───────────────────────── */

async function sourceForRun(ctx: FixContext, run: AgentRunRow) {
  if (!run.source_id) throw new FixWorkflowError("The run has no repository.", 409);
  const { source } = await loadSourceWithConnection(ctx, run.source_id);
  assertSourceOwnsHost(source, run.site_host);
  return source;
}

export async function approveAgentPlan(ctx: FixContext, args: { runId: string; planHash: string }) {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can approve plans.", 403);
  const run = await loadRunRls(ctx, args.runId);
  if (run.status !== "awaiting_plan_approval" || !run.plan)
    throw new FixWorkflowError("This plan isn't waiting for approval.", 409);
  if (!run.plan_hash || run.plan_hash !== args.planHash) {
    throw new FixWorkflowError("The plan changed since you reviewed it. Review it again.", 409);
  }
  await sourceForRun(ctx, run);
  const moved = await transition(run, "approve_plan", {
    plan_approved_by: ctx.userId,
    plan_approved_at: new Date().toISOString(),
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    status_detail: "Implementing the approved plan",
  });
  if (!moved) throw new FixWorkflowError("The plan was already handled.", 409);
  await logAgentEvent(run, {
    stage: null,
    kind: "approval",
    actor: "user",
    userId: ctx.userId,
    summary: "Plan approved",
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.agent.plan_approved",
    entity: "geo_agent_run",
    payload: { runId: run.id, planHash: args.planHash },
  });
  kickAgentRun(run.id);
  return presentRun(ctx, moved);
}

export async function reviseAgentPlan(ctx: FixContext, args: { runId: string; feedback: string }) {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can revise plans.", 403);
  const run = await loadRunRls(ctx, args.runId);
  if (!["awaiting_plan_approval", "needs_input"].includes(run.status))
    throw new FixWorkflowError("This plan can't be revised now.", 409);
  if (run.plan_revision >= MAX_PLAN_REVISIONS)
    throw new FixWorkflowError("This plan has been revised too many times. Start a new run.", 409);
  const moved = await transition(run, "revise_plan", {
    feedback: args.feedback.slice(0, 1000),
    plan_hash: null,
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    status_detail: "Revising the plan with your feedback",
  });
  if (!moved) throw new FixWorkflowError("The plan was already handled.", 409);
  await logAgentEvent(run, {
    stage: null,
    kind: "approval",
    actor: "user",
    userId: ctx.userId,
    summary: "Asked for plan changes",
    detail: { feedback: args.feedback.slice(0, 300) },
  });
  kickAgentRun(run.id);
  return presentRun(ctx, moved);
}

export async function submitAgentInputs(
  ctx: FixContext,
  args: { runId: string; inputs: Record<string, string> },
) {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can provide inputs.", 403);
  const run = await loadRunRls(ctx, args.runId);
  if (run.status !== "needs_input" || !run.plan)
    throw new FixWorkflowError("This run isn't waiting for input.", 409);
  const allowed = new Set(run.plan.needsInput.map((n) => n.key));
  const now = new Date().toISOString();
  const merged = { ...(run.inputs ?? {}) };
  for (const [k, raw] of Object.entries(args.inputs)) {
    if (!allowed.has(k)) throw new FixWorkflowError(`Unknown input “${k}”.`);
    const value = raw.trim().slice(0, 2000);
    if (value) merged[k] = { value, by: ctx.userId, at: now };
  }
  const missing = run.plan.needsInput.filter((n) => !merged[n.key]);
  if (missing.length) {
    await supabaseAdmin
      .from("geo_agent_runs")
      .update({ inputs: merged as unknown as Json })
      .eq("id", run.id);
    throw new FixWorkflowError(`Still needed: ${missing.map((m) => m.label).join(", ")}.`);
  }
  const values = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v.value]));
  const moved = await transition(run, "inputs_submitted", {
    inputs: merged as unknown as Json,
    plan_hash: hashPlan(run.plan as AgentPlan, values),
    status_detail: "Plan ready for your review",
  });
  if (!moved) throw new FixWorkflowError("The run was already updated.", 409);
  await logAgentEvent(run, {
    stage: null,
    kind: "inputs_received",
    actor: "user",
    userId: ctx.userId,
    summary: `Provided ${Object.keys(args.inputs).length} input(s)`,
  });
  return presentRun(ctx, moved);
}

/* ───────────────────────── cancel / retry ───────────────────────── */

export async function cancelAgentRun(
  ctx: FixContext,
  args: { runId: string; closePullRequest: boolean },
) {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can cancel runs.", 403);
  let run = await loadRunRls(ctx, args.runId);
  if (!canCancel(run.status)) throw new FixWorkflowError("This run can't be cancelled now.", 409);
  if (run.proposal_id) {
    const { data: p } = await ctx.supabase
      .from("geo_fix_proposals")
      .select("status")
      .eq("id", run.proposal_id)
      .maybeSingle();
    if (p?.status === "pr_open") {
      if (!args.closePullRequest)
        throw new FixWorkflowError("Confirm closing the pull request to cancel.", 400);
      await discardProposal(ctx, { proposalId: run.proposal_id, closePullRequest: true });
    } else if (p?.status === "draft") {
      await discardProposal(ctx, { proposalId: run.proposal_id, closePullRequest: false });
    }
    run = await loadRunRls(ctx, args.runId);
    if (isTerminal(run.status)) return presentRun(ctx, run);
  }
  await supabaseAdmin
    .from("geo_agent_runs")
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", run.id);
  // Waiting runs stop now; a working run stops at its next turn.
  const leased = run.lease_until && Date.parse(run.lease_until) > Date.now();
  if (!leased && nextStatus(run.status, "cancel")) await cancelRunNow(run, ctx.userId);
  else
    await logAgentEvent(run, {
      stage: null,
      kind: "cancel",
      actor: "user",
      userId: ctx.userId,
      summary: "Cancellation requested",
    });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.agent.cancelled",
    entity: "geo_agent_run",
    payload: { runId: run.id },
  });
  return presentRun(ctx, await loadRunRls(ctx, args.runId));
}

export async function retryAgentRun(
  ctx: FixContext,
  args: { runId: string; fromStage: "investigate" | "implement" },
) {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can retry runs.", 403);
  // A retry is a new paid run: the same switches and limits as starting one.
  if (!geoAgentEnabled())
    throw new FixWorkflowError("The GEO coding agent is turned off on this server.", 409);
  if (!geoAgentModelConfigured())
    throw new FixWorkflowError(
      "The AI model isn't configured on this server (OPENROUTER_API_KEY).",
      409,
    );
  if (await dailyLimitReached(ctx.workspaceId))
    throw new FixWorkflowError(
      `This workspace has used today's ${dailyRunLimit()} GEO agent runs. Try again tomorrow.`,
      429,
    );
  const run = await loadRunRls(ctx, args.runId);
  if (!canRetry(run.status)) throw new FixWorkflowError("This run can't be retried now.", 409);
  await sourceForRun(ctx, run);
  const fromPlan =
    args.fromStage === "implement" &&
    run.plan?.feasible &&
    run.plan_approved_at &&
    run.status !== "stale";
  const { data, error } = await supabaseAdmin
    .from("geo_agent_runs")
    .insert({
      workspace_id: run.workspace_id,
      scan_id: run.scan_id,
      finding_id: run.finding_id,
      fingerprint: run.fingerprint,
      rule_id: run.rule_id,
      page_url: run.page_url,
      site_host: run.site_host,
      site_origin: run.site_origin,
      source_id: run.source_id,
      connection_id: run.connection_id,
      repo_full_name: run.repo_full_name,
      repo_external_id: run.repo_external_id,
      base_branch: run.base_branch,
      status: fromPlan ? "implementing" : "queued",
      status_detail: fromPlan ? "Retrying the approved plan" : "Queued",
      created_by: ctx.userId,
      ...(fromPlan
        ? {
            plan: run.plan as unknown as Json,
            plan_hash: run.plan_hash,
            plan_revision: run.plan_revision,
            plan_ready_at: run.plan_ready_at,
            plan_approved_by: run.plan_approved_by,
            plan_approved_at: run.plan_approved_at,
            base_sha: run.base_sha,
            inputs: run.inputs as unknown as Json,
            files_inspected: run.files_inspected as unknown as Json,
          }
        : { inputs: run.inputs as unknown as Json }),
    })
    .select(RUN_COLS)
    .single();
  if (error || !data) {
    if (error?.code === "23505")
      throw new FixWorkflowError("Another run for this finding is already in progress.", 409);
    throw new Error(error?.message ?? "Couldn't retry");
  }
  const fresh = data as unknown as AgentRunRow;
  await logAgentEvent(fresh, {
    stage: null,
    kind: "retry",
    actor: "user",
    userId: ctx.userId,
    summary: fromPlan ? "Retrying from the approved plan" : "Retrying from investigation",
    detail: { previousRunId: run.id },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.agent.retried",
    entity: "geo_agent_run",
    payload: {
      runId: fresh.id,
      previousRunId: run.id,
      fromStage: fromPlan ? "implement" : "investigate",
    },
  });
  kickAgentRun(fresh.id);
  return presentRun(ctx, fresh);
}
