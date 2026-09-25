// Live run of "Fix all" on a WordPress site and the platform picker (reads .env):
//
//   real scan → getSiteConnections (GitHub / WordPress / Webflow tiles for the
//   host) → getFixAllPreflight.platform → startCmsFixAll → the runs prepare
//   exact before/after changes. Nothing is applied to the site.
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/geo-fix-all-sites.live.ts
// Spends a little model budget.
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

(ready ? describe : describe.skip)("Fix all on WordPress (live)", () => {
  const scans: string[] = [];
  const runs: string[] = [];
  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (runs.length) await supabaseAdmin.from("geo_agent_runs").delete().in("id", runs);
    if (scans.length) await supabaseAdmin.from("geo_scans").delete().in("id", scans);
  });

  it("shows the platform tiles and prepares every change", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conn } = await supabaseAdmin
      .from("workspace_connections")
      .select("workspace_id")
      .eq("provider", "wordpress")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!conn) return console.warn("[live] no WordPress connection — skipped");
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

    const { getSiteConnections, scanHost } =
      await import("@/server/geo/fixes/site-connections.server");
    const connections = await getSiteConnections(ctx, await scanHost(ctx, scan.id));
    for (const t of connections.tiles)
      console.info(
        `[live] tile ${t.provider}: ${t.state}${t.detected ? " (detected)" : ""} — ${t.detail}`,
      );
    expect(connections.tiles.map((t) => t.provider).sort()).toEqual([
      "github",
      "webflow",
      "wordpress",
    ]);
    expect(connections.active).toBe("wordpress");
    expect(connections.tiles[0].provider).toBe("wordpress");

    const { getFixAllPreflight } = await import("@/server/geo/fixes/batch.server");
    const preflight = await getFixAllPreflight(ctx, scan.id);
    console.info(`[live] preflight platform: ${preflight.platform}`);
    expect(preflight.platform).toBe("wordpress");

    const cms = await import("@/server/geo/fixes/cms-fix-all.server");
    const before = await cms.getCmsFixAll(ctx, scan.id);
    console.info(
      `[live] ${before.items.length} findings to fix on WordPress (${before.deferred} deferred)`,
    );
    for (const i of before.items) console.info(`[live]   · ${i.title} — ${i.pageUrl ?? "site"}`);
    expect(before.items.length).toBeGreaterThan(0);

    const started = await cms.startCmsFixAll(ctx, scan.id);
    for (const i of started.items) if (i.run) runs.push(i.run.id);
    const { runDueAgentRuns } = await import("@/server/geo/agents/runner.server");
    for (const id of runs) await runDueAgentRuns({ id, budgetMs: 120_000, max: 1 });
    const after = await cms.getCmsFixAll(ctx, scan.id);
    for (const i of after.items)
      console.info(
        `[live]   ${i.run?.status ?? "none"} · ${i.title}${i.run?.changes.length ? ` · ${i.run.changes.map((c) => c.label).join(", ")}` : ""}${i.run?.contentHash ? " · READY" : ""}`,
      );
    expect(after.items.some((i) => i.run?.contentHash)).toBe(true);
    // Cancel what was prepared so the site and the findings are left as they were.
    const agents = await import("@/server/geo/agents/service.server");
    for (const id of runs)
      await agents
        .cancelAgentRun(ctx, { runId: id, closePullRequest: false })
        .catch(() => undefined);
  }, 900_000);
});
