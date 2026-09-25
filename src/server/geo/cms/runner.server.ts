import "server-only";
// runner.server.ts — the GEO Engineer on a WordPress or Webflow site.
//
// Same run, same activity log, same approval as on GitHub; the work differs:
//
//   investigating  prove the live site is the connected CMS site, find the
//                  exact object behind the page, read its current values
//   → reviewing    exact field changes are ready (no plan step: the change
//                  itself is what the person approves)
//   → validating   grounding, lengths, drift-safe before values
//   → awaiting_patch_approval   a draft proposal (provider wordpress|webflow)
//
// Approval writes the change (fixes/service.server.ts → cms/apply.server.ts)
// and schedules the same verification rescan as a merged pull request.
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { targetLabel, type CmsChange } from "@/lib/geo/cms-fixes";
import { displayValue } from "@/lib/geo/cms-fixes";
import { RULE_BY_ID } from "@/lib/geo/rules";
import type { SiteArtifacts } from "@/lib/geo/types";
import { recordAudit } from "@/server/audit.server";
import { runWithScope } from "@/server/request-context";
import { resolveSite } from "@/server/sites/resolve.server";
import { PROPOSAL_COLS, type StoredProposalFile } from "../fixes/present";
import { strategyForRule } from "../fixes/strategies";
import type { CrawledPageFacts } from "../fixes/text-artifacts";
import type { PageFactsView } from "../agents/repo-tools.server";
import { primaryModel } from "@/server/ai/task-models";
import { openCmsSession } from "./access.server";
import { planCmsFix } from "./generate.server";
import { resolvePageTarget } from "./targets.server";

type RunLike = {
  id: string;
  workspace_id: string;
  scan_id: string | null;
  finding_id: string | null;
  fingerprint: string;
  rule_id: string;
  page_url: string | null;
  site_host: string;
  site_origin: string;
  status: string;
  provider?: string | null;
  inputs: Record<string, { value: string }>;
  created_by: string | null;
  model: string | null;
};

export type CmsRunDeps = {
  transition: (run: any, event: any, patch?: Record<string, unknown>) => Promise<any | null>;
  log: (
    run: { id: string; workspace_id: string },
    e: {
      stage: any;
      kind: string;
      actor?: "agent" | "system" | "user";
      summary: string;
      detail?: Record<string, unknown>;
    },
  ) => Promise<void>;
};

const providerName = (p: string) => (p === "webflow" ? "Webflow" : "WordPress");

/** Content hash that binds approval to exactly these changes. */
export function cmsContentHash(changes: CmsChange[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(changes.map((c) => ({ t: c.target, k: c.key, b: c.before, a: c.after }))),
    )
    .digest("hex");
}

/** A field change rendered as a reviewable "file" (the patch view shows diffs). */
export function changeAsFile(c: CmsChange): StoredProposalFile {
  const path = `${targetLabel(c.target)} › ${c.label}`;
  const before = displayValue(c.before);
  const after = displayValue(c.after);
  const diff = createTwoFilesPatch(
    path,
    path,
    before ? `${before}\n` : "",
    `${after}\n`,
    "current",
    "proposed",
    {
      context: 3,
    },
  );
  const lines = diff.split("\n");
  return {
    path,
    action: before ? "update" : "create",
    baseBlobSha: null,
    diff,
    additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    explanation: c.reason,
  };
}

async function scanFacts(run: RunLike): Promise<{
  site: SiteArtifacts;
  page: PageFactsView | null;
  pages: CrawledPageFacts[];
  brandName: string | null;
}> {
  const { data: scan } = await supabaseAdmin
    .from("geo_scans")
    .select("site")
    .eq("id", run.scan_id ?? "")
    .maybeSingle();
  const { loadScanFacts } = await import("../fixes/service.server");
  const facts = run.scan_id
    ? await loadScanFacts(run.scan_id, run.page_url, run.site_origin)
    : { page: null, brandName: null, pages: [] as CrawledPageFacts[] };
  const p = facts.page;
  return {
    site: (scan?.site as unknown as SiteArtifacts) ?? {
      origin: run.site_origin,
      host: run.site_host,
      https: run.site_origin.startsWith("https"),
      robots: { status: "missing", text: "", sitemaps: [] },
      llms: { found: false, bytes: 0, full: false },
      sitemap: { found: false, urls: 0, isIndex: false, sources: [] },
    },
    page: p
      ? {
          url: p.url,
          statusCode: 200,
          title: p.title,
          description: p.description,
          canonical: p.canonical,
          lang: p.lang,
          h1: p.h1,
          headings: p.headings,
          schemaTypes: [],
          wordCount: p.excerpt.split(/\s+/).length,
          excerpt: p.excerpt,
          rendering: null,
        }
      : null,
    pages: facts.pages,
    brandName: facts.brandName,
  };
}

export async function runCmsInvestigation(run: RunLike, deps: CmsRunDeps): Promise<void> {
  const provider = (run.provider ?? "wordpress") as "wordpress" | "webflow";
  const name = providerName(provider);
  let current = run;
  if (current.status === "queued") {
    const moved = await deps.transition(current, "start", {
      status_detail: `Checking your ${name} site`,
      model: primaryModel("geo.cms.fix"),
    });
    if (!moved) return;
    current = moved;
  }

  // 1. The live site must be the connected CMS site.
  await deps.log(current, {
    stage: "investigate",
    kind: "stage_started",
    summary: `Checking that ${run.site_host} is served by your connected ${name} site`,
  });
  const resolution = await resolveSite(run.workspace_id, run.site_host, { live: true });
  const binding = resolution.candidates.find((c) => c.provider === provider);
  if (!binding || !binding.verified) {
    throw Object.assign(
      new Error(binding?.proof ?? `${run.site_host} isn't connected through ${name}.`),
      { code: "site_not_verified" },
    );
  }
  await deps.log(current, {
    stage: "investigate",
    kind: "tool_call",
    summary: binding.proof,
    detail: { provider, host: run.site_host },
  });

  const session = await openCmsSession(run.workspace_id, provider, {
    write: true,
    seo: binding.provider === "wordpress" ? binding.seo : undefined,
  });
  if (session.provider === "wordpress")
    await deps.log(current, {
      stage: "investigate",
      kind: "tool_call",
      summary:
        session.seo === "mellox"
          ? "Mellox GEO plugin found: head tags, schema, robots.txt and llms.txt can be changed"
          : session.seo === "rankmath"
            ? "Rank Math found: titles, descriptions, canonicals and indexing can be changed"
            : session.seo === "jetpack"
              ? "Jetpack SEO found: titles, descriptions and indexing can be changed"
              : "No SEO plugin found: content can be changed; head tags need the Mellox GEO plugin",
    });

  // 2. The exact object behind the page.
  const pageUrl = run.page_url ?? `${run.site_origin}/`;
  await deps.log(current, {
    stage: "investigate",
    kind: "tool_call",
    summary: `Reading ${pageUrl} and finding it in ${name}`,
  });
  const resolved = await resolvePageTarget(session, pageUrl);
  await deps.log(current, {
    stage: "investigate",
    kind: "tool_call",
    summary: resolved.target
      ? `Found it: ${targetLabel(resolved.target)}`
      : `This page isn't a single ${name} item; only site-wide settings can change`,
    detail: { pageKind: resolved.pageKind },
  });

  // 3. Exact changes.
  const facts = await scanFacts(run);
  const { data: finding } = await supabaseAdmin
    .from("geo_findings")
    .select("title, detail, page_url")
    .eq("id", run.finding_id ?? "")
    .maybeSingle();
  await deps.log(current, {
    stage: "implement",
    kind: "stage_started",
    summary: "Preparing the exact change from the page's own content",
  });
  const plan = await runWithScope(
    { workspaceId: run.workspace_id, userId: run.created_by ?? undefined, route: "geo.cms.fix" },
    () =>
      planCmsFix({
        ruleId: run.rule_id,
        finding: {
          title: finding?.title ?? RULE_BY_ID.get(run.rule_id)?.title ?? run.rule_id,
          detail: finding?.detail ?? "",
          pageUrl: finding?.page_url ?? run.page_url,
        },
        origin: run.site_origin,
        site: facts.site,
        page: facts.page,
        pages: facts.pages,
        brandName: facts.brandName,
        session,
        resolved,
        inputs: Object.fromEntries(Object.entries(run.inputs ?? {}).map(([k, v]) => [k, v.value])),
      }),
  );

  const strategy = strategyForRule(run.rule_id);
  if (!plan.changes.length) {
    const reason =
      plan.notFixable ??
      (plan.assisted.length
        ? `${name}'s API can't make this change. Mellox prepared the exact value${plan.assisted.length > 1 ? "s" : ""} to paste.`
        : "Nothing needs changing.");
    await deps.transition(current, "not_fixable", {
      plan: {
        feasible: false,
        notFixableReason: reason,
        manualSteps: [
          ...plan.assisted.map((a) => `${a.label}: paste the value shown below into ${a.where}.`),
          ...plan.manualSteps,
          ...(plan.assisted.length ? [] : strategy.manualSteps),
        ],
        strategy: "cms",
        scope: "page",
        summary: reason,
        files: [],
        risks: [],
        outOfScope: [],
        validationCriteria: strategy.validationSteps,
        needsInput: [],
        verification: { scope: strategy.verifyScope, urls: [pageUrl] },
        confidence: "high",
      } as unknown as Json,
      result: { assisted: plan.assisted } as unknown as Json,
      status_detail: reason.slice(0, 500),
      completed_at: new Date().toISOString(),
    });
    await deps.log(current, { stage: "implement", kind: "result", summary: reason.slice(0, 290) });
    return;
  }

  for (const c of plan.changes)
    await deps.log(current, {
      stage: "implement",
      kind: "tool_call",
      summary: `${c.label}: ${c.reason}`.slice(0, 290),
    });

  const files = plan.changes.map(changeAsFile);
  const validation = { ok: true, checks: plan.checks };
  const reviewing = await deps.transition(current, "cms_changes_submitted", {
    status_detail: "Checking the change",
    patch: { explanation: plan.explanation, files } as unknown as Json,
    site_ref: { provider, target: resolved.target, pageKind: resolved.pageKind } as unknown as Json,
  });
  if (!reviewing) return;
  await deps.log(reviewing, {
    stage: "review",
    kind: "review",
    summary: "Every new word comes from your site; nothing invented",
  });
  const validating = await deps.transition(reviewing, "review_passed", {
    review: {
      verdict: "approve",
      summary: "Values are grounded in the page's own text and within recommended lengths.",
      issues: [],
    } as unknown as Json,
  });
  if (!validating) return;

  // 4. Draft proposal — approval binds to its content hash.
  await supabaseAdmin
    .from("geo_fix_proposals")
    .update({ status: "discarded" })
    .eq("workspace_id", run.workspace_id)
    .eq("fingerprint", run.fingerprint)
    .eq("status", "draft");
  const rule = RULE_BY_ID.get(run.rule_id);
  const { data: proposal, error } = await supabaseAdmin
    .from("geo_fix_proposals")
    .insert({
      workspace_id: run.workspace_id,
      scan_id: run.scan_id,
      finding_id: run.finding_id,
      fingerprint: run.fingerprint,
      rule_id: run.rule_id,
      fix_id: rule?.fixId ?? run.rule_id.replace(/\./g, "-"),
      page_url: run.page_url,
      site_origin: run.site_origin,
      provider,
      connection_id: binding.connectionId,
      strategy: `cms: ${provider}`,
      files: files as unknown as Json,
      explanation: plan.explanation,
      validation: validation as unknown as Json,
      content_hash: cmsContentHash(plan.changes),
      cms_changes: { changes: plan.changes, assisted: plan.assisted } as unknown as Json,
      site_ref: {
        provider,
        target: resolved.target,
        pageKind: resolved.pageKind,
      } as unknown as Json,
      model: primaryModel("geo.cms.fix"),
      status: "draft",
      created_by: run.created_by,
      agent_run_id: run.id,
    })
    .select(PROPOSAL_COLS)
    .single();
  if (error || !proposal) throw new Error(error?.message ?? "Couldn't save the proposal");
  await deps.transition(validating, "validation_passed", {
    proposal_id: proposal.id,
    validation: validation as unknown as Json,
    result: { assisted: plan.assisted } as unknown as Json,
    status_detail: `Ready: review the exact change, then apply it to ${name}`,
  });
  await deps.log(validating, {
    stage: "validate",
    kind: "proposal",
    summary: `Change ready for your approval (${plan.changes.length} field${plan.changes.length > 1 ? "s" : ""})`,
  });
  await recordAudit({
    workspaceId: run.workspace_id,
    userId: run.created_by,
    action: "geo.cms.proposal_created",
    entity: "geo_fix_proposal",
    payload: {
      runId: run.id,
      proposalId: proposal.id,
      provider,
      fields: plan.changes.map((c) => c.label),
    },
  });
}
