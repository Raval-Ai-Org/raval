// Live run of the GEO Engineer on a WordPress site (reads .env):
//
//   real scan of the connected WordPress site → a finding Mellox can change
//   → startAgentRun (resolves the site: WordPress, proven) → CMS run
//   → exact before/after changes awaiting approval
//   SITES_LIVE_WRITE=yes: approve → the value really changes on WordPress
//   → verification scheduled → undo → the old value is back
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/geo-cms-fix.live.ts
// Spends a little model budget (title/description generation).
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suite skips below.
}

const ready =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.OPENROUTER_API_KEY &&
  !!process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY;
const WRITE = process.env.SITES_LIVE_WRITE === "yes";
const PREFERRED = [
  "tech.meta_description",
  "tech.title",
  "tech.duplicate_description",
  "content.heading_hierarchy",
  "content.h1",
  "tech.indexable",
];

(ready ? describe : describe.skip)("GEO Engineer on WordPress (live)", () => {
  const scans: string[] = [];
  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (scans.length && process.env.GEO_CMS_KEEP !== "1")
      await supabaseAdmin.from("geo_scans").delete().in("id", scans);
  });

  it("prepares, applies and undoes a real WordPress change", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conn } = await supabaseAdmin
      .from("workspace_connections")
      .select("workspace_id")
      .eq("provider", "wordpress")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!conn) {
      console.warn("[live] no workspace has a WordPress connection — skipped");
      return;
    }
    const workspaceId = conn.workspace_id;
    const { data: owner } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .limit(1)
      .single();
    const userId = owner!.user_id;
    const ctx = {
      supabase: supabaseAdmin as never,
      userId,
      workspaceId,
      canPropose: true,
      canManage: true,
    };
    const { clientFor } = await import("@/server/connectors/wordpress/service.server");
    const { siteUrl } = await clientFor(workspaceId);
    console.info(`[live] workspace ${workspaceId} · ${siteUrl}`);

    const { resolveSite } = await import("@/server/sites/resolve.server");
    const host = new URL(siteUrl).hostname;
    const resolution = await resolveSite(workspaceId, host, { live: true });
    console.info(`[live] binding: ${resolution.binding?.provider} · ${resolution.binding?.proof}`);
    expect(resolution.binding?.provider).toBe("wordpress");
    expect(resolution.binding?.verified).toBe(true);

    const { createScan, driveScan } = await import("@/server/geo/service.server");
    const scan = await createScan({
      workspaceId,
      userId,
      url: siteUrl,
      mode: "quick",
      trigger: "manual",
    });
    scans.push(scan.id);
    await driveScan(scan.id, { budgetMs: 150_000 });
    const { data: findings } = await supabaseAdmin
      .from("geo_findings")
      .select("id, rule_id, page_url, title")
      .eq("scan_id", scan.id);
    console.info(
      `[live] ${findings?.length ?? 0} findings: ${[...new Set((findings ?? []).map((f) => f.rule_id))].join(", ")}`,
    );
    const finding =
      PREFERRED.map((r) => (findings ?? []).find((f) => f.rule_id === r)).find(Boolean) ?? null;
    if (!finding) {
      console.warn("[live] no finding Mellox can change on this site — nothing to fix");
      return;
    }
    console.info(`[live] fixing ${finding.rule_id} on ${finding.page_url ?? "site"}`);

    const fixes = await import("@/server/geo/fixes/service.server");
    const availability = await fixes.getFixAvailability(ctx, finding.id);
    console.info(
      `[live] availability: ${availability.method} / ${availability.requirement} — ${availability.reason}`,
    );
    expect(availability.provider).toBe("wordpress");

    const agents = await import("@/server/geo/agents/service.server");
    const started = await agents.startAgentRun(ctx, { findingId: finding.id });
    expect(started.ok, "reason" in started ? started.reason : "").toBe(true);
    if (!started.ok) return;
    const { runDueAgentRuns } = await import("@/server/geo/agents/runner.server");
    await runDueAgentRuns({ id: started.runId, budgetMs: 200_000, max: 1 });
    const { run, events } = await agents.getAgentRun(ctx, started.runId);
    for (const e of events) console.info(`[live]   · ${e.summary}`);
    console.info(`[live] run: ${run.status} — ${run.statusDetail}`);
    expect(["awaiting_patch_approval", "not_fixable"]).toContain(run.status);
    if (run.status !== "awaiting_patch_approval") {
      console.info(`[live] assisted: ${JSON.stringify(run.assisted).slice(0, 500)}`);
      return;
    }
    const proposal = run.proposal!;
    expect(proposal.provider).toBe("wordpress");
    for (const c of proposal.cms!.changes)
      console.info(
        `[live] ${c.label} (${c.target})\n    now:   ${c.before.slice(0, 200)}\n    after: ${c.after.slice(0, 200)}`,
      );

    if (!WRITE) {
      console.info("[live] SITES_LIVE_WRITE not set — stopping before the write");
      await agents.cancelAgentRun(ctx, { runId: run.id, closePullRequest: false });
      return;
    }
    const applied = await fixes.approveAndApply(ctx, {
      proposalId: proposal.id,
      contentHash: proposal.contentHash!,
    });
    console.info(`[live] applied: ${applied.status}`);
    expect(["verifying", "applied"]).toContain(applied.status);
    const after = await agents.getAgentRun(ctx, run.id);
    console.info(`[live] run after apply: ${after.run.status} — ${after.run.statusDetail}`);
    expect(after.run.actions.undo).toBe(true);

    // Does the live page show it? (Page caches can take a minute.)
    const { safeFetch } = await import("@/server/safe-fetch");
    const want = proposal.cms!.changes[0].after.slice(0, 60);
    let seen = false;
    for (let i = 0; i < 6 && !seen; i++) {
      const res = await safeFetch(`${finding.page_url ?? siteUrl}?mellox_check=${Date.now()}`, {
        timeoutMs: 20_000,
      });
      seen = res.text().includes(want);
      if (!seen) await new Promise((r) => setTimeout(r, 10_000));
    }
    console.info(`[live] live page shows the new value: ${seen}`);

    const undone = await fixes.undoCmsProposal(ctx, proposal.id);
    console.info(`[live] undone: ${undone.status}`);
    expect(undone.status).toBe("rolled_back");
  }, 600_000);
});
