import "server-only";
// cms-fix-all.server.ts — "Fix all" for websites built on WordPress or Webflow.
//
//   list    open findings a CMS field can fix, one per (fields, page) so two
//           changes never race for the same value; the rest wait for the next run
//   start   one GEO Engineer run per finding (the same tested single-finding
//           flow: find the page → prepare the exact before/after → wait)
//   apply   the person approves every ready change at once; each is applied with
//           its own content hash (drift refused) and snapshot (undo), and each
//           finding still resolves only through its own verification rescan
//
// Nothing is written to the site before apply.

import { cmsFieldsForRule, cmsScopeForRule } from "@/lib/geo/cms-fixes";
import type { CmsFixAllItem, CmsFixAllView } from "@/lib/geo/fix-contracts";
import { resolveSite } from "@/server/sites/resolve.server";
import { classifyFindings } from "./batch.server";
import { FixWorkflowError, type FixContext } from "./service.server";

export const CMS_FIX_ALL_MAX = 10;

async function cmsPlatform(ctx: FixContext, scanId: string) {
  const { data: scan } = await ctx.supabase
    .from("geo_scans")
    .select("id, host, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", scanId)
    .maybeSingle();
  if (!scan) throw new FixWorkflowError("Scan not found", 404);
  const resolution = await resolveSite(ctx.workspaceId, scan.host);
  const b = resolution.binding;
  if (!b?.verified || b.provider === "github")
    throw new FixWorkflowError(
      `Connect the WordPress or Webflow site that serves ${scan.host} first.`,
      409,
    );
  return { host: scan.host as string, provider: b.provider };
}

async function candidates(ctx: FixContext, scanId: string) {
  const { open } = await classifyFindings(ctx, scanId);
  const seen = new Set<string>();
  const picked: typeof open = [];
  let deferred = 0;
  for (const f of open) {
    const fields = cmsFieldsForRule(f.rule_id);
    if (!fields.length) continue;
    const key = `${fields.join(",")}|${cmsScopeForRule(f.rule_id) === "site" ? "site" : (f.page_url ?? "site")}`;
    if (seen.has(key)) {
      deferred++;
      continue;
    }
    seen.add(key);
    picked.push(f);
  }
  return {
    picked: picked.slice(0, CMS_FIX_ALL_MAX),
    deferred: deferred + Math.max(0, picked.length - CMS_FIX_ALL_MAX),
  };
}

async function itemFor(
  ctx: FixContext,
  f: { id: string; title: string; page_url: string | null; priority: string },
): Promise<CmsFixAllItem> {
  const agents = await import("@/server/geo/agents/service.server");
  const { run } = await agents.getAgentRunForFinding(ctx, f.id);
  const p = run?.proposal ?? null;
  return {
    findingId: f.id,
    title: f.title,
    pageUrl: f.page_url,
    priority: f.priority,
    run: run
      ? {
          id: run.id,
          status: run.status,
          statusDetail: run.statusDetail,
          proposalId: run.actions.approvePatch && p?.contentHash ? p.id : null,
          contentHash: run.actions.approvePatch ? (p?.contentHash ?? null) : null,
          changes: p?.cms?.changes ?? [],
          publishesSite: Boolean(p?.cms?.publishesSite),
          assistedCount: run.assisted.length,
          applied: Boolean(p?.cms?.appliedAt && !p.cms.rolledBackAt),
        }
      : null,
  };
}

export async function getCmsFixAll(ctx: FixContext, scanId: string): Promise<CmsFixAllView> {
  const { host, provider } = await cmsPlatform(ctx, scanId);
  const { picked, deferred } = await candidates(ctx, scanId);
  const items = await Promise.all(picked.map((f) => itemFor(ctx, f)));
  return {
    scanId,
    host,
    provider,
    items,
    deferred,
    maxFindings: CMS_FIX_ALL_MAX,
    canPropose: ctx.canPropose,
  };
}

/** Start (or join) a run for every listed finding that has none in progress. */
export async function startCmsFixAll(ctx: FixContext, scanId: string): Promise<CmsFixAllView> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can run “Fix all”.", 403);
  await cmsPlatform(ctx, scanId);
  const agents = await import("@/server/geo/agents/service.server");
  const { picked } = await candidates(ctx, scanId);
  // Start again only where the last attempt ended without a usable result.
  const RETRY = ["failed", "cancelled", "closed", "stale", "not_verified"];
  for (const f of picked) {
    const { run } = await agents.getAgentRunForFinding(ctx, f.id);
    if (run && !RETRY.includes(run.status)) continue;
    await agents.startAgentRun(ctx, { findingId: f.id }).catch((e) => {
      console.warn("[cms-fix-all] start failed", f.id, e instanceof Error ? e.message : e);
    });
  }
  return getCmsFixAll(ctx, scanId);
}

/** Apply every approved change, one at a time; one failure doesn't stop the rest. */
export async function applyCmsFixAll(
  ctx: FixContext,
  args: { scanId: string; items: { proposalId: string; contentHash: string }[] },
): Promise<{
  view: CmsFixAllView;
  results: { proposalId: string; ok: boolean; error: string | null }[];
}> {
  if (!ctx.canPropose) throw new FixWorkflowError("Only editors can apply fixes.", 403);
  await cmsPlatform(ctx, args.scanId);
  const fixes = await import("./service.server");
  const results: { proposalId: string; ok: boolean; error: string | null }[] = [];
  for (const item of args.items.slice(0, CMS_FIX_ALL_MAX)) {
    try {
      await fixes.approveAndApply(ctx, item);
      results.push({ proposalId: item.proposalId, ok: true, error: null });
    } catch (e) {
      results.push({
        proposalId: item.proposalId,
        ok: false,
        error: e instanceof Error ? e.message : "Couldn't apply this change.",
      });
    }
  }
  return { view: await getCmsFixAll(ctx, args.scanId), results };
}
