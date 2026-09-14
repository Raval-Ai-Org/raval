// batch.server.ts — "Fix all automatically": every finding Mellox can fix for
// a website, in ONE pull request, after ONE approval.
//
//   preflight   which open findings are fixable, what GitHub setup is missing
//   create      snapshot the repository, then generate in the background
//   generate    per finding: plan files → generate on the combined working
//               tree (fixes to the same file stack instead of conflicting) →
//               validate that fix alone; failures are skipped with a reason
//   review      combined diff + combined checks; content hash of the result
//   approve     exact-content approval → one mellox/ branch → one commit → PR
//   merge       one verification rescans every affected page; each finding is
//               resolved only when its own check passes
//
// Same invariants as single fixes: nothing is merged, base branches are never
// written, every write is audited, and a finding is never marked resolved
// because a pull request exists or was merged.
import "server-only";
import { createPatch } from "diff";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  FixAllPreflight,
  FixBatchView,
  FixProposalView,
  FixSetup,
  ProposalValidation,
  RuleCheckState,
} from "@/lib/geo/fix-contracts";
import type { SiteArtifacts } from "@/lib/geo/types";
import { BudgetExceededError } from "@/server/ai/budget";
import { recordAudit } from "@/server/audit.server";
import { runWithScope } from "@/server/request-context";
import { GitHubAccessError } from "@/server/connectors/github/api.server";
import { getGitHubConfigCheck } from "@/server/connectors/github/config.server";
import {
  closePullRequest,
  commitToNewBranch,
  contentHash,
  createPullRequest,
  deleteMelloxBranch,
  getChecks,
  getPullRequest,
  GitOperationError,
  MAX_FILES_PER_BATCH,
  readFile,
  type PullRequestInfo,
} from "@/server/connectors/github/git.server";
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
import { generateChange } from "./generate.server";
import {
  BATCH_COLS,
  presentBatch,
  VERIFICATION_COLS,
  type BatchRow,
  type StoredBatchItem,
  type StoredProposalFile,
  type VerificationRow,
} from "./present";
import {
  describeGitError,
  FixWorkflowError,
  loadConnectionAdmin,
  loadConnectors,
  loadScanFacts,
  loadSourceWithConnection,
  normHost,
  snapshotRepo,
  type FixContext,
} from "./service.server";
import { fixKindForRule, frameworkKind, planFixTarget, type TargetPlan } from "./targets";
import { changedLines, validateProposal } from "./validate";
import { scheduleVerification, verifyDelaysMinutes } from "./verify.server";

/** Findings per run: each code fix is a paid model call. */
export const BATCH_MAX_FINDINGS = 15;
const BATCH_MAX_CHANGED_LINES = 1500;
const LIVE_BATCH = ["generating", "draft", "applying", "pr_open", "merged", "verifying"];
const LIVE_PROPOSAL = ["draft", "applying", "pr_open", "merged", "verifying"];
const GENERATION_STALE_MS = 10 * 60_000;
const SYNC_AFTER_MS = 2 * 60_000;

/* ───────────────────────── loading & presenting ───────────────────────── */

async function batchView(row: BatchRow): Promise<FixBatchView> {
  const [{ data: verification }, { data: proposals }] = await Promise.all([
    supabaseAdmin
      .from("geo_verifications")
      .select(VERIFICATION_COLS)
      .eq("batch_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from("geo_fix_proposals").select("fingerprint, status").eq("batch_id", row.id),
  ]);
  const statuses = new Map<string, FixProposalView["status"]>(
    (proposals ?? []).map((p) => [p.fingerprint, p.status as FixProposalView["status"]]),
  );
  return presentBatch(row, (verification as unknown as VerificationRow) ?? null, statuses);
}

async function patchBatch(id: string, patch: Record<string, unknown>): Promise<BatchRow> {
  const { data, error } = await supabaseAdmin
    .from("geo_fix_batches")
    .update(patch as never)
    .eq("id", id)
    .select(BATCH_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't update the fix batch");
  return data as unknown as BatchRow;
}

async function loadBatch(ctx: FixContext, batchId: string): Promise<BatchRow> {
  const { data, error } = await ctx.supabase
    .from("geo_fix_batches")
    .select(BATCH_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Fix batch not found", 404);
  return data as unknown as BatchRow;
}

type ScanRowLite = {
  id: string;
  host: string;
  origin: string;
  site: SiteArtifacts;
  status: string;
};

async function loadScan(ctx: FixContext, scanId: string): Promise<ScanRowLite> {
  const { data, error } = await ctx.supabase
    .from("geo_scans")
    .select("id, host, origin, site, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FixWorkflowError("Scan not found", 404);
  if (data.status !== "succeeded") throw new FixWorkflowError("Only completed scans can be fixed.");
  return data as unknown as ScanRowLite;
}

type FindingLite = {
  id: string;
  rule_id: string;
  fix_id: string | null;
  fingerprint: string;
  page_url: string | null;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  status: "warn" | "fail";
  priority: string;
  priority_score: number;
};

/** Open findings of a scan split into fixable / manual / already in progress. */
async function classifyFindings(ctx: FixContext, scanId: string) {
  const { data: findings, error } = await ctx.supabase
    .from("geo_findings")
    .select(
      "id, rule_id, fix_id, fingerprint, page_url, title, detail, evidence, status, priority, priority_score",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("scan_id", scanId)
    .order("priority_score", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (findings ?? []) as unknown as FindingLite[];
  const fingerprints = [...new Set(rows.map((r) => r.fingerprint))].slice(0, 1000);
  const [{ data: states }, { data: live }] = await Promise.all([
    ctx.supabase
      .from("geo_finding_states")
      .select("fingerprint, state")
      .eq("workspace_id", ctx.workspaceId)
      .in("fingerprint", fingerprints),
    ctx.supabase
      .from("geo_fix_proposals")
      .select("fingerprint")
      .eq("workspace_id", ctx.workspaceId)
      .in("fingerprint", fingerprints)
      .in("status", LIVE_PROPOSAL),
  ]);
  const closed = new Set(
    (states ?? [])
      .filter((s) => s.state === "resolved" || s.state === "dismissed")
      .map((s) => s.fingerprint),
  );
  const inProgress = new Set((live ?? []).map((p) => p.fingerprint));
  const open = rows.filter((r) => !closed.has(r.fingerprint));
  return {
    fixable: open.filter((r) => fixKindForRule(r.rule_id) && !inProgress.has(r.fingerprint)),
    manualCount: open.filter((r) => !fixKindForRule(r.rule_id)).length,
    inProgressCount: open.filter((r) => fixKindForRule(r.rule_id) && inProgress.has(r.fingerprint))
      .length,
  };
}

/** GitHub readiness for a website (connection → linked repository → framework). */
async function getSiteSetup(ctx: FixContext, host: string): Promise<FixSetup> {
  const { connections, sources } = await loadConnectors(ctx);
  const check = getGitHubConfigCheck();
  const configured = check.ok && check.config.installVerification !== "unavailable";
  const liveConnections = connections.filter((c) => c.status !== "revoked");
  const connection =
    liveConnections.find((c) => c.status === "active") ??
    liveConnections[0] ??
    connections[0] ??
    null;
  const siteSources = sources.filter((s) => normHost(s.site_host) === normHost(host));
  const source = siteSources.find((s) => s.status === "active") ?? siteSources[0] ?? null;
  const base = {
    configured,
    connection: connection ? presentConnection(connection) : null,
    source: source ? presentSource(source) : null,
    sources: sources.map((s) => presentSource(s)),
    canManageConnections: ctx.canManage,
    canPropose: ctx.canPropose,
  };
  const setup = (requirement: FixSetup["requirement"], reason: string): FixSetup => ({
    ...base,
    requirement,
    reason,
  });
  if (!configured)
    return setup("not_configured", "GitHub isn't configured on this Mellox server yet.");
  if (!liveConnections.length) {
    return setup(
      connections.length ? "reconnect" : "connect",
      connections.length
        ? "GitHub was disconnected from this workspace. Reconnect it to fix issues automatically."
        : `Connect the GitHub repository behind ${host} so Mellox can open one pull request with every fix.`,
    );
  }
  if (!connection || connection.status !== "active") {
    return setup(
      "reconnect",
      "The GitHub installation is suspended or revoked. Reconnect it to continue.",
    );
  }
  if (!source) {
    return setup(
      "select_repository",
      `Choose the repository that builds ${host}. Mellox links it to this website.`,
    );
  }
  if (source.status === "access_lost") {
    return setup(
      "access_lost",
      `Mellox lost access to ${source.full_name}. Re-grant it on GitHub, then verify the connection.`,
    );
  }
  const framework = source.inspection?.framework ?? null;
  if (source.inspection && !frameworkKind(framework)) {
    return setup(
      "unsupported",
      framework
        ? `${source.full_name} is a ${framework} site; Mellox can't edit that framework safely yet.`
        : `Mellox couldn't identify the framework in ${source.full_name}.`,
    );
  }
  return setup("ready", `Mellox will open one pull request on ${source.full_name}.`);
}

/* ───────────────────────── preflight ───────────────────────── */

export async function getFixAllPreflight(
  ctx: FixContext,
  scanId: string,
): Promise<FixAllPreflight> {
  const scan = await loadScan(ctx, scanId);
  const [classes, setup, { data: latest }] = await Promise.all([
    classifyFindings(ctx, scanId),
    getSiteSetup(ctx, scan.host),
    ctx.supabase
      .from("geo_fix_batches")
      .select(BATCH_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("host", scan.host)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  let batch: FixBatchView | null = null;
  if (latest) {
    const row = await maybeRefresh(latest as unknown as BatchRow);
    if (!["discarded"].includes(row.status)) batch = await batchView(row);
  }
  return {
    scanId: scan.id,
    host: scan.host,
    origin: scan.origin,
    setup,
    fixable: classes.fixable.map((f) => ({
      findingId: f.id,
      fingerprint: f.fingerprint,
      ruleId: f.rule_id,
      title: f.title,
      pageUrl: f.page_url,
      priority: f.priority,
    })),
    manualCount: classes.manualCount,
    inProgressCount: classes.inProgressCount,
    maxFindings: BATCH_MAX_FINDINGS,
    batch,
  };
}

/* ───────────────────────── create + background generation ───────────────────────── */

export async function createFixBatch(
  ctx: FixContext,
  args: { scanId: string; sourceId: string; baseBranch: string },
): Promise<FixBatchView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can fix issues.", 403);
  if (!isValidBaseBranch(args.baseBranch))
    throw new FixWorkflowError("That branch name isn't valid.");
  const scan = await loadScan(ctx, args.scanId);
  const { source, connection } = await loadSourceWithConnection(ctx, args.sourceId);
  if (normHost(source.site_host) !== normHost(scan.host)) {
    throw new FixWorkflowError(
      `${source.full_name} is linked to ${source.site_host ?? "no website"}, not ${scan.host}. Link the repository to this website first.`,
    );
  }
  const { fixable } = await classifyFindings(ctx, args.scanId);
  if (!fixable.length) {
    throw new FixWorkflowError(
      "There are no open findings Mellox can fix automatically in this scan.",
    );
  }
  const snap = await snapshotRepo(connection, source, ctx.userId, args.baseBranch);

  const items: StoredBatchItem[] = fixable.map((f, i) => ({
    findingId: f.id,
    fingerprint: f.fingerprint,
    ruleId: f.rule_id,
    title: f.title,
    pageUrl: f.page_url,
    status: i < BATCH_MAX_FINDINGS ? "pending" : "skipped",
    reason:
      i < BATCH_MAX_FINDINGS
        ? null
        : `Over the ${BATCH_MAX_FINDINGS}-finding limit for one run — run “Fix all” again afterwards.`,
    files: [],
    proposalId: null,
  }));
  const { data: row, error } = await supabaseAdmin
    .from("geo_fix_batches")
    .insert({
      workspace_id: ctx.workspaceId,
      scan_id: scan.id,
      site_origin: scan.origin,
      host: scan.host,
      provider: "github",
      connection_id: connection.id,
      source_id: source.id,
      repo_full_name: source.full_name,
      repo_external_id: source.external_id,
      framework: snap.framework,
      base_branch: snap.branch.name,
      base_sha: snap.branch.sha,
      status: "generating",
      progress: { total: Math.min(fixable.length, BATCH_MAX_FINDINGS), done: 0, current: null },
      items,
      created_by: ctx.userId,
    } as never)
    .select(BATCH_COLS)
    .single();
  if (error || !row) {
    if (error?.code === "23505") {
      throw new FixWorkflowError("A “Fix all” run for this website is already in progress.", 409);
    }
    throw new Error(error?.message ?? "Couldn't start “Fix all”");
  }
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix_batch.started",
    entity: "geo_fix_batch",
    payload: {
      batchId: row.id,
      repository: source.full_name,
      baseBranch: snap.branch.name,
      findings: Math.min(fixable.length, BATCH_MAX_FINDINGS),
    },
  });
  const batch = row as unknown as BatchRow;
  after(() =>
    runWithScope({ workspaceId: ctx.workspaceId, userId: ctx.userId, route: "geo.fix.batch" }, () =>
      generateBatch(batch.id, snap.paths).catch(async (e) => {
        console.error(`[geo] fix batch ${batch.id} generation failed`, e);
        await patchBatch(batch.id, {
          status: "failed",
          error: (e instanceof Error ? e.message : "Generation failed").slice(0, 2000),
        }).catch(() => undefined);
      }),
    ),
  );
  return batchView(batch);
}

type WorkingFile = { original: string | null; content: string | null; sha: string | null };

async function generateBatch(batchId: string, paths: string[]) {
  const { data } = await supabaseAdmin
    .from("geo_fix_batches")
    .select(BATCH_COLS)
    .eq("id", batchId)
    .single();
  let batch = data as unknown as BatchRow;
  const [{ data: scan }, connection, { data: sourceRow }] = await Promise.all([
    supabaseAdmin
      .from("geo_scans")
      .select("id, host, origin, site")
      .eq("id", batch.scan_id!)
      .single(),
    loadConnectionAdmin(batch.connection_id),
    supabaseAdmin.from("workspace_sources").select(SOURCE_COLS).eq("id", batch.source_id!).single(),
  ]);
  const source = sourceRow as unknown as SourceRow;
  if (!scan || !connection || !source)
    throw new Error("The scan or repository for this run is gone.");
  const site = scan.site as unknown as SiteArtifacts;
  const pending = batch.items.filter((i) => i.status === "pending");
  const { data: findingRows } = await supabaseAdmin
    .from("geo_findings")
    .select(
      "id, rule_id, fix_id, fingerprint, page_url, title, detail, evidence, status, priority, priority_score",
    )
    .in(
      "id",
      pending.map((i) => i.findingId),
    );
  const findings = new Map(((findingRows ?? []) as unknown as FindingLite[]).map((f) => [f.id, f]));
  const siteFacts = await loadScanFacts(scan.id, null, scan.origin);

  // Group findings whose fix touches the same files with the same change kind.
  type Group = { key: string; plan: Extract<TargetPlan, { ok: true }>; members: StoredBatchItem[] };
  const groups = new Map<string, Group>();
  const items = new Map(batch.items.map((i) => [i.findingId, { ...i }]));
  for (const item of pending) {
    const f = findings.get(item.findingId);
    const it = items.get(item.findingId)!;
    if (!f) {
      Object.assign(it, { status: "skipped", reason: "The finding no longer exists." });
      continue;
    }
    const plan = planFixTarget({
      ruleId: f.rule_id,
      pageUrl: f.page_url,
      framework: batch.framework,
      paths,
    });
    if (!plan.ok) {
      Object.assign(it, { status: "skipped", reason: plan.reason });
      continue;
    }
    const key = `${plan.kind}|${plan.files
      .map((x) => x.path)
      .sort()
      .join(",")}|${plan.scope === "page" ? (f.page_url ?? "") : ""}`;
    const g = groups.get(key) ?? { key, plan, members: [] };
    g.members.push(it);
    groups.set(key, g);
  }

  const working = new Map<string, WorkingFile>();
  const installationId = connection.external_account_id;
  const combinedExplanations = new Map<string, string[]>();
  let done = batch.items.length - pending.length > 0 ? 0 : 0;
  let budgetHit = false;

  const save = async (current: string | null) => {
    batch = await patchBatch(batchId, {
      items: [...items.values()],
      progress: { total: pending.length, done, current },
    });
  };
  await save(null);

  for (const group of groups.values()) {
    const lead = findings.get(group.members[0].findingId)!;
    const skip = async (status: "skipped" | "failed", reason: string) => {
      for (const m of group.members) Object.assign(m, { status, reason });
      done += group.members.length;
      await save(null);
    };
    if (budgetHit) {
      await skip("skipped", "The workspace AI budget was reached before this fix.");
      continue;
    }
    await save(lead.title);

    // Read files that aren't in the working tree yet.
    const newPaths = group.plan.files.map((f) => f.path).filter((p) => !working.has(p));
    if (working.size + newPaths.length > MAX_FILES_PER_BATCH) {
      await skip("skipped", `One pull request can change at most ${MAX_FILES_PER_BATCH} files.`);
      continue;
    }
    try {
      await withAccess(connection, batch.created_by, async () => {
        for (const p of newPaths) {
          const file = await readFile(installationId, source.full_name, p, batch.base_branch!);
          working.set(p, {
            original: file?.content ?? null,
            content: file?.content ?? null,
            sha: file?.sha ?? null,
          });
        }
      });
    } catch (error) {
      if (error instanceof GitOperationError) {
        await skip("skipped", error.message);
        continue;
      }
      throw error;
    }

    const kind = fixKindForRule(lead.rule_id)!;
    const facts = await loadScanFacts(scan.id, lead.page_url, scan.origin);
    const current = group.plan.files.map((f) => {
      const w = working.get(f.path)!;
      return {
        path: f.path,
        action: (w.content === null ? "create" : "update") as "create" | "update",
        content: w.content,
      };
    });
    let generated;
    try {
      generated = await generateChange({
        kind,
        ruleId: lead.rule_id,
        finding: {
          title: lead.title,
          detail: lead.detail,
          evidence: lead.evidence ?? {},
          pageUrl: lead.page_url,
        },
        plan: group.plan,
        framework: batch.framework,
        site,
        brandName: siteFacts.brandName,
        logoUrl: null,
        page: facts.page,
        pages: siteFacts.pages,
        current,
      });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        budgetHit = true;
        await skip("skipped", "The workspace AI budget was reached before this fix.");
        continue;
      }
      await skip(
        "failed",
        error instanceof Error ? error.message.slice(0, 300) : "Generation failed",
      );
      continue;
    }
    if (!generated.ok) {
      await skip("skipped", generated.reason);
      continue;
    }
    const validation = validateProposal({
      kind,
      ruleId: lead.rule_id,
      pageUrl: lead.page_url,
      site,
      files: generated.files,
      crawlerReadsFile:
        group.plan.strategy === "static_file" ||
        generated.files.every((f) => /\.html?$/i.test(f.path)),
    });
    if (!validation.ok) {
      const failed = validation.checks.filter((c) => c.status === "fail");
      await skip(
        "failed",
        `Didn't pass checks: ${failed.map((c) => `${c.label} (${c.detail})`).join("; ")}`.slice(
          0,
          600,
        ),
      );
      continue;
    }

    // Accept: advance the working tree and record a proposal per finding.
    for (const f of generated.files) {
      working.get(f.path)!.content = f.after;
      combinedExplanations.set(
        f.path,
        [...(combinedExplanations.get(f.path) ?? []), f.explanation].filter(Boolean),
      );
    }
    const files: StoredProposalFile[] = generated.files.map((f) => ({
      path: f.path,
      action: f.action,
      baseBlobSha: working.get(f.path)?.sha ?? null,
      after: f.after,
      diff: f.diff,
      additions: f.additions,
      deletions: f.deletions,
      explanation: f.explanation,
    }));
    for (const m of group.members) {
      const f = findings.get(m.findingId)!;
      const { data: proposal, error } = await supabaseAdmin
        .from("geo_fix_proposals")
        .insert({
          workspace_id: batch.workspace_id,
          scan_id: scan.id,
          finding_id: f.id,
          fingerprint: f.fingerprint,
          rule_id: f.rule_id,
          fix_id: f.fix_id ?? kind,
          page_url: f.page_url,
          site_origin: scan.origin,
          provider: "github",
          connection_id: connection.id,
          source_id: source.id,
          repo_full_name: source.full_name,
          repo_external_id: source.external_id,
          framework: batch.framework,
          base_branch: batch.base_branch,
          base_sha: batch.base_sha,
          strategy: group.plan.strategy,
          files,
          explanation: generated.explanation,
          validation,
          model: generated.model,
          status: "draft",
          created_by: batch.created_by,
          batch_id: batch.id,
        } as never)
        .select("id")
        .single();
      if (error) {
        Object.assign(m, {
          status: "skipped",
          reason:
            error.code === "23505" ? "This finding already has a fix in progress." : error.message,
        });
      } else {
        Object.assign(m, {
          status: "generated",
          reason: null,
          proposalId: proposal.id,
          files: files.map((x) => x.path),
        });
      }
    }
    done += group.members.length;
    await save(null);
  }

  // Combine the working tree into one change.
  const combined: StoredProposalFile[] = [];
  for (const [path, w] of working) {
    if (w.content === null || w.content === w.original) continue;
    const stats = changedLines(w.original ?? "", w.content);
    combined.push({
      path,
      action: w.original === null ? "create" : "update",
      baseBlobSha: w.sha,
      after: w.content,
      diff: createPatch(path, w.original ?? "", w.content, "current", "proposed", { context: 3 }),
      additions: stats.additions,
      deletions: stats.deletions,
      explanation: (combinedExplanations.get(path) ?? []).join(" "),
    });
  }
  const generatedItems = [...items.values()].filter((i) => i.status === "generated");
  if (!combined.length || !generatedItems.length) {
    await patchBatch(batchId, {
      status: "failed",
      items: [...items.values()],
      progress: { total: pending.length, done, current: null },
      error: "None of the fixes could be generated safely. Each finding shows why.",
    });
    return;
  }

  const combinedCheck = validateProposal({
    kind: "title",
    ruleId: "tech.title",
    pageUrl: null,
    site,
    files: combined.map((f) => ({
      path: f.path,
      action: f.action,
      before: working.get(f.path)!.original,
      after: f.after!,
    })),
    crawlerReadsFile: false,
    maxChangedLines: BATCH_MAX_CHANGED_LINES,
  });
  const validation: ProposalValidation = {
    ok: combinedCheck.checks.filter((c) => c.id !== "rule").every((c) => c.status !== "fail"),
    checks: [
      ...combinedCheck.checks.filter((c) => c.id !== "rule"),
      {
        id: "fixes",
        label: "Every included fix passed its own checks",
        status: "pass",
        detail: `${generatedItems.length} fix(es) included; findings re-checked on their own files where crawlers read them. The rescan after merge confirms each one.`,
      },
    ],
  };
  const hash = contentHash(
    combined.map((f) => ({ path: f.path, action: f.action, after: f.after! })),
    batch.base_sha!,
  );
  const skipped = [...items.values()].filter((i) => i.status !== "generated").length;
  await patchBatch(batchId, {
    status: "draft",
    items: [...items.values()],
    progress: { total: pending.length, done, current: null },
    files: combined,
    validation,
    content_hash: hash,
    explanation: `${generatedItems.length} fix(es) across ${combined.length} file(s)${skipped ? `; ${skipped} finding(s) need manual work` : ""}.`,
  });
  await recordAudit({
    workspaceId: batch.workspace_id,
    userId: batch.created_by,
    action: "geo.fix_batch.generated",
    entity: "geo_fix_batch",
    payload: {
      batchId,
      fixes: generatedItems.length,
      skipped,
      files: combined.map((f) => ({ path: f.path, action: f.action })),
      validationOk: validation.ok,
    },
  });
}

/* ───────────────────────── read / refresh ───────────────────────── */

async function maybeRefresh(row: BatchRow): Promise<BatchRow> {
  if (
    row.status === "generating" &&
    Date.now() - Date.parse(row.updated_at) > GENERATION_STALE_MS
  ) {
    return patchBatch(row.id, {
      status: "failed",
      error: "Generation was interrupted (the server restarted). Start “Fix all” again.",
    });
  }
  if (
    row.status === "pr_open" &&
    (!row.last_synced_at || Date.now() - Date.parse(row.last_synced_at) > SYNC_AFTER_MS)
  ) {
    return syncBatch(row);
  }
  return row;
}

export async function getFixBatch(ctx: FixContext, batchId: string, opts: { sync?: boolean } = {}) {
  let row = await loadBatch(ctx, batchId);
  row = opts.sync && row.status === "pr_open" ? await syncBatch(row) : await maybeRefresh(row);
  return batchView(row);
}

/* ───────────────────────── approve → one PR ───────────────────────── */

function batchPrBody(row: BatchRow, title: string): string {
  const included = row.items.filter((i) => i.status === "generated");
  const excluded = row.items.filter((i) => i.status !== "generated");
  const checks = ("checks" in row.validation ? row.validation.checks : [])
    .map(
      (c) =>
        `- ${c.status === "pass" ? "✅" : c.status === "skipped" ? "⏭️" : "❌"} ${c.label}: ${c.detail}`,
    )
    .join("\n");
  return `## ${title}

${row.explanation ?? ""}

### Fixes in this pull request
${included.map((i) => `- ${i.title}${i.pageUrl ? ` — ${i.pageUrl}` : " — site-wide"} (\`${i.ruleId}\`)`).join("\n")}

### Files
${row.files.map((f) => `- \`${f.path}\` (${f.action})`).join("\n")}
${excluded.length ? `\n### Not included (need manual work)\n${excluded.map((i) => `- ${i.title}: ${i.reason ?? "skipped"}`).join("\n")}\n` : ""}
### Checks Mellox ran before opening this PR
${checks}

---
Generated by Mellox AI Visibility “Fix all” and approved once by a workspace member. Mellox never merges pull requests.
After merge and deploy, Mellox re-scans every affected page and resolves each finding only if its own check passes on the live site.`;
}

export async function approveFixBatch(
  ctx: FixContext,
  args: { batchId: string; contentHash: string },
): Promise<FixBatchView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can approve fixes.", 403);
  const row = await loadBatch(ctx, args.batchId);
  if (row.status !== "draft")
    throw new FixWorkflowError("This run is no longer waiting for approval.", 409);
  if (!("ok" in row.validation) || !row.validation.ok) {
    throw new FixWorkflowError("The combined change failed a check and can't be applied.", 409);
  }
  if (!row.content_hash || row.content_hash !== args.contentHash) {
    throw new FixWorkflowError(
      "The change was updated since you reviewed it. Review it again.",
      409,
    );
  }
  if (!row.source_id || !row.base_branch || !row.base_sha || !row.repo_full_name) {
    throw new FixWorkflowError("This run is missing its repository details.", 409);
  }
  if (row.files.some((f) => typeof f.after !== "string")) {
    throw new FixWorkflowError("The proposed contents expired. Start “Fix all” again.", 409);
  }
  const { source, connection } = await loadSourceWithConnection(ctx, row.source_id);
  if (source.full_name !== row.repo_full_name) {
    throw new FixWorkflowError("The linked repository changed. Start “Fix all” again.", 409);
  }
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("geo_fix_batches")
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
  if (!claimed?.length) throw new FixWorkflowError("This run is already being applied.", 409);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix_batch.approved",
    entity: "geo_fix_batch",
    payload: {
      batchId: row.id,
      repository: row.repo_full_name,
      baseBranch: row.base_branch,
      contentHash: args.contentHash,
    },
  });

  const installationId = connection.external_account_id;
  const count = row.items.filter((i) => i.status === "generated").length;
  const headBranch = proposalBranchName(`all-${count}`, randomBytes(4).toString("hex"));
  const title = `Mellox: ${count} AI visibility fix${count === 1 ? "" : "es"} for ${row.host}`;
  let branchCreated = false;
  try {
    const { commitSha } = await withAccess(connection, ctx.userId, () =>
      commitToNewBranch({
        installationId,
        repo: row.repo_full_name!,
        baseBranch: row.base_branch!,
        baseSha: row.base_sha!,
        headBranch,
        message: `${title}\n\nGenerated by Mellox AI Visibility “Fix all” and approved in Mellox.`,
        files: row.files.map((f) => ({ path: f.path, content: f.after! })),
        maxFiles: MAX_FILES_PER_BATCH,
      }),
    );
    branchCreated = true;
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix_batch.committed",
      entity: "geo_fix_batch",
      payload: {
        batchId: row.id,
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
        body: batchPrBody(row, title),
      }),
    );
    const checks = await getChecks(installationId, row.repo_full_name, commitSha).catch(() => null);
    const now = new Date().toISOString();
    const updated = await patchBatch(row.id, {
      status: "pr_open",
      head_branch: headBranch,
      commit_sha: commitSha,
      pr_number: pr.number,
      pr_url: pr.url,
      pr_state: pr.state,
      checks,
      last_synced_at: now,
    });
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({
        status: "pr_open",
        head_branch: headBranch,
        commit_sha: commitSha,
        pr_number: pr.number,
        pr_url: pr.url,
        pr_state: pr.state,
        approved_by: ctx.userId,
        approved_at: now,
        last_synced_at: now,
      } as never)
      .eq("batch_id", row.id)
      .eq("status", "draft");
    const fingerprints = row.items
      .filter((i) => i.status === "generated")
      .map((i) => i.fingerprint);
    if (fingerprints.length) {
      await supabaseAdmin.from("geo_finding_states").upsert(
        fingerprints.map((fingerprint) => ({
          workspace_id: ctx.workspaceId,
          fingerprint,
          state: "in_progress",
          note: `Pull request #${pr.number} (Fix all) opened in ${row.repo_full_name}.`,
          resolved_via: null,
          verified_at: null,
          verification_id: null,
          updated_by: ctx.userId,
          updated_at: now,
        })),
        { onConflict: "workspace_id,fingerprint" },
      );
    }
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix_batch.pr_opened",
      entity: "geo_fix_batch",
      payload: {
        batchId: row.id,
        repository: row.repo_full_name,
        pr: pr.number,
        url: pr.url,
        branch: headBranch,
        fixes: count,
      },
    });
    return batchView(updated);
  } catch (error) {
    const message = describeGitError(error);
    const stale = error instanceof GitOperationError && error.code === "base_moved";
    const accessLost = error instanceof GitHubAccessError && error.reason !== "forbidden";
    if (branchCreated)
      await deleteMelloxBranch(installationId, row.repo_full_name, headBranch).catch(() => {});
    const status = stale ? "stale" : accessLost ? "access_lost" : "failed";
    await patchBatch(row.id, { status, error: message.slice(0, 2000) });
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: stale ? "stale" : "failed", error: message.slice(0, 2000) })
      .eq("batch_id", row.id)
      .in("status", ["draft", "applying"]);
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix_batch.apply_failed",
      entity: "geo_fix_batch",
      payload: {
        batchId: row.id,
        repository: row.repo_full_name,
        error: message,
        branchCleanedUp: branchCreated,
      },
    });
    throw new FixWorkflowError(message, stale ? 409 : 502);
  }
}

/* ───────────────────────── PR state → verification ───────────────────────── */

async function applyBatchPullRequestState(
  row: BatchRow,
  pr: Pick<PullRequestInfo, "state" | "mergedAt"> & { number: number },
  via: "sync" | "webhook",
): Promise<BatchRow> {
  if (row.pr_number !== pr.number) return row;
  const now = new Date().toISOString();
  if (pr.state === "merged" && (row.status === "pr_open" || row.status === "closed")) {
    await patchBatch(row.id, {
      status: "merged",
      pr_state: "merged",
      pr_merged_at: pr.mergedAt ?? now,
      last_synced_at: now,
    });
    const { data: members } = await supabaseAdmin
      .from("geo_fix_proposals")
      .update({
        status: "merged",
        pr_state: "merged",
        pr_merged_at: pr.mergedAt ?? now,
        last_synced_at: now,
      })
      .eq("batch_id", row.id)
      .in("status", ["pr_open", "closed"])
      .select("fingerprint, rule_id, page_url, finding_id");
    await recordAudit({
      workspaceId: row.workspace_id,
      userId: null,
      action: "geo.fix_batch.pr_merged",
      entity: "geo_fix_batch",
      payload: { batchId: row.id, pr: row.pr_number, repository: row.repo_full_name, via },
    });
    const targets = (members ?? []).map((m) => ({
      fingerprint: m.fingerprint,
      ruleId: m.rule_id,
      pageUrl: m.page_url,
    }));
    if (targets.length) {
      const before: Record<string, RuleCheckState> = {};
      const findingIds = (members ?? []).map((m) => m.finding_id).filter((x): x is string => !!x);
      if (findingIds.length) {
        const { data: fs } = await supabaseAdmin
          .from("geo_findings")
          .select("fingerprint, status, detail, page_url")
          .in("id", findingIds);
        for (const f of fs ?? []) {
          before[f.fingerprint] = {
            status: f.status as "warn" | "fail",
            detail: f.detail,
            pageUrl: f.page_url,
          };
        }
      }
      await scheduleVerification({
        workspaceId: row.workspace_id,
        userId: row.approved_by ?? row.created_by,
        proposalId: null,
        batchId: row.id,
        origin: row.site_origin,
        targets: targets.slice(0, 50),
        baselineScanId: row.scan_id,
        before,
        delaysMinutes: verifyDelaysMinutes(),
      });
    }
    return patchBatch(row.id, { status: targets.length ? "verifying" : "completed" });
  }
  if (pr.state === "closed" && row.status === "pr_open") {
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "closed", pr_state: "closed", last_synced_at: now })
      .eq("batch_id", row.id)
      .eq("status", "pr_open");
    await recordAudit({
      workspaceId: row.workspace_id,
      userId: null,
      action: "geo.fix_batch.pr_closed",
      entity: "geo_fix_batch",
      payload: { batchId: row.id, pr: row.pr_number, repository: row.repo_full_name, via },
    });
    return patchBatch(row.id, { status: "closed", pr_state: "closed", last_synced_at: now });
  }
  if (pr.state === "open" && row.status === "closed") {
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "pr_open", pr_state: "open", last_synced_at: now })
      .eq("batch_id", row.id)
      .eq("status", "closed");
    return patchBatch(row.id, { status: "pr_open", pr_state: "open", last_synced_at: now });
  }
  return patchBatch(row.id, { last_synced_at: now });
}

async function syncBatch(row: BatchRow): Promise<BatchRow> {
  if (!row.pr_number || !row.repo_full_name || !["pr_open", "closed"].includes(row.status))
    return row;
  const connection = await loadConnectionAdmin(row.connection_id);
  if (!connection || connection.status === "revoked") {
    return patchBatch(row.id, {
      status: "access_lost",
      error: "GitHub was disconnected; the pull request can't be tracked.",
    });
  }
  try {
    const pr = await withAccess(connection, null, () =>
      getPullRequest(connection.external_account_id, row.repo_full_name!, row.pr_number!),
    );
    if (!pr)
      return patchBatch(row.id, {
        status: "access_lost",
        error: "The pull request is no longer visible to Mellox.",
      });
    const checks = await getChecks(
      connection.external_account_id,
      row.repo_full_name,
      pr.headSha,
    ).catch(() => null);
    const updated = await applyBatchPullRequestState(row, pr, "sync");
    return checks ? patchBatch(updated.id, { checks }) : updated;
  } catch (error) {
    if (error instanceof GitHubAccessError) {
      return patchBatch(row.id, { status: "access_lost", error: describeGitError(error) });
    }
    console.error(`[geo] fix batch ${row.id} sync failed`, error);
    return row;
  }
}

export async function syncStaleOpenBatches(max = 3) {
  const { data, error } = await supabaseAdmin
    .from("geo_fix_batches")
    .select(BATCH_COLS)
    .eq("status", "pr_open")
    .or(
      `last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`,
    )
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(max);
  if (error) throw new Error(error.message);
  let synced = 0;
  for (const row of (data ?? []) as unknown as BatchRow[]) {
    await syncBatch(row);
    synced++;
  }
  return { synced };
}

export async function handleBatchPullRequestWebhook(
  connectionIds: string[],
  pr: {
    repositoryId: string;
    number: number;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
    headRef: string;
  },
): Promise<number> {
  if (!connectionIds.length || !pr.headRef.startsWith("mellox/")) return 0;
  const { data, error } = await supabaseAdmin
    .from("geo_fix_batches")
    .select(BATCH_COLS)
    .in("connection_id", connectionIds)
    .eq("repo_external_id", pr.repositoryId)
    .eq("pr_number", pr.number);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as BatchRow[];
  for (const row of rows) await applyBatchPullRequestState(row, pr, "webhook");
  return rows.length;
}

export async function refreshBatchChecks(
  connectionIds: string[],
  repositoryId: string,
  headSha: string,
) {
  if (!connectionIds.length || !/^[0-9a-f]{40}$/i.test(headSha)) return 0;
  const { data } = await supabaseAdmin
    .from("geo_fix_batches")
    .select("id, repo_full_name, connection_id")
    .in("connection_id", connectionIds)
    .eq("repo_external_id", repositoryId)
    .eq("commit_sha", headSha)
    .in("status", ["pr_open", "merged", "verifying"]);
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
        .from("geo_fix_batches")
        .update({ checks } as never)
        .eq("id", row.id);
      n++;
    }
  }
  return n;
}

/* ───────────────────────── discard ───────────────────────── */

export async function discardFixBatch(
  ctx: FixContext,
  args: { batchId: string; closePullRequest: boolean },
): Promise<FixBatchView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can discard fixes.", 403);
  const row = await loadBatch(ctx, args.batchId);
  const stuckGenerating =
    row.status === "generating" && Date.now() - Date.parse(row.updated_at) > GENERATION_STALE_MS;
  if (["draft", "failed", "stale", "access_lost"].includes(row.status) || stuckGenerating) {
    await supabaseAdmin
      .from("geo_fix_proposals")
      .update({ status: "discarded" })
      .eq("batch_id", row.id)
      .in("status", ["draft", "failed", "stale"]);
    const updated = await patchBatch(row.id, { status: "discarded" });
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: "geo.fix_batch.discarded",
      entity: "geo_fix_batch",
      payload: { batchId: row.id, from: row.status },
    });
    return batchView(updated);
  }
  if (row.status !== "pr_open") throw new FixWorkflowError("This run can't be discarded now.", 409);
  if (!args.closePullRequest)
    throw new FixWorkflowError("Confirm closing the pull request to discard it.");
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
  await supabaseAdmin
    .from("geo_fix_proposals")
    .update({ status: "discarded", pr_state: "closed" })
    .eq("batch_id", row.id)
    .eq("status", "pr_open");
  const fingerprints = row.items.filter((i) => i.status === "generated").map((i) => i.fingerprint);
  if (fingerprints.length) {
    await supabaseAdmin
      .from("geo_finding_states")
      .update({
        state: "open",
        note: `Pull request #${row.pr_number} was closed from Mellox.`,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", ctx.workspaceId)
      .in("fingerprint", fingerprints)
      .eq("state", "in_progress");
  }
  const updated = await patchBatch(row.id, {
    status: "discarded",
    pr_state: "closed",
    last_synced_at: new Date().toISOString(),
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: "geo.fix_batch.discarded",
    entity: "geo_fix_batch",
    payload: {
      batchId: row.id,
      pr: row.pr_number,
      repository: row.repo_full_name,
      branchDeleted: row.head_branch,
    },
  });
  return batchView(updated);
}

export type { ConnectionRow };
export { CONNECTION_COLS, LIVE_BATCH };
