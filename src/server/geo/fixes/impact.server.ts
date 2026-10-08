// impact.server.ts — loads what "since your fixes went live" needs for one
// website and hands it to the pure calculation (src/lib/geo/fix-impact.ts).
// Read-only, with the caller's own client, so RLS decides what is visible.
// It starts no scan and no prompt check: it only reads rows that exist.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFixImpact,
  WINDOW_DAYS,
  type FixImpact,
  type ImpactFix,
} from "@/lib/geo/fix-impact";
import { FixWorkflowError, type FixContext } from "./service.server";

const DAY = 86_400_000;

function fixState(status: string): ImpactFix["state"] {
  if (status === "verified") return "verified";
  if (status === "not_verified") return "not_fixed";
  if (status === "merged" || status === "verifying") return "checking";
  return "live";
}

export async function getFixImpact(ctx: FixContext, scanId: string): Promise<FixImpact> {
  const db = ctx.supabase as unknown as SupabaseClient;
  const { data: scan, error } = await db
    .from("geo_scans")
    .select("host, origin")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) throw new FixWorkflowError("Scan not found", 404);

  // A fix is live once its pull request is merged or it was applied to the CMS
  // (and not undone).
  const { data: proposals, error: proposalError } = await db
    .from("geo_fix_proposals")
    .select("status, pr_merged_at, applied_at, rolled_back_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("site_origin", scan.origin)
    .is("rolled_back_at", null)
    .or("pr_merged_at.not.is.null,applied_at.not.is.null")
    .limit(1000);
  if (proposalError) throw new Error(proposalError.message);
  const fixes: ImpactFix[] = (proposals ?? []).map((p) => ({
    liveAt: String(p.pr_merged_at ?? p.applied_at),
    state: fixState(String(p.status)),
  }));
  if (!fixes.length) return computeFixImpact({ scans: [], fixes: [], checks: [] });

  const first = Math.min(...fixes.map((f) => Date.parse(f.liveAt)));
  const [scans, checks] = await Promise.all([
    db
      .from("geo_scans")
      .select("completed_at, overall_score, score_version:report->scoreVersion")
      .eq("workspace_id", ctx.workspaceId)
      .eq("host", scan.host)
      .eq("status", "succeeded")
      // Verification rescans (a few pages) aren't site scores.
      .neq("mode", "targeted")
      .not("overall_score", "is", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(200),
    db
      .from("geo_prompt_checks")
      .select("checked_at, mentioned, position")
      .eq("workspace_id", ctx.workspaceId)
      .is("error", null)
      .gte("checked_at", new Date(first - WINDOW_DAYS * DAY).toISOString())
      .order("checked_at", { ascending: false })
      .limit(5000),
  ]);
  if (scans.error) throw new Error(scans.error.message);

  return computeFixImpact({
    fixes,
    scans: (scans.data ?? []).map((s) => ({
      at: String(s.completed_at),
      score: Number(s.overall_score),
      scoreVersion: Number(s.score_version ?? 1),
    })),
    // Tracked prompts may be unavailable on a plan; the score still shows.
    checks: (checks.data ?? []).map((c) => ({
      at: String(c.checked_at),
      mentioned: Boolean(c.mentioned),
      position: c.position == null ? null : Number(c.position),
    })),
  });
}
