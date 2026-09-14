// Live check of "Fix all automatically" against the real database (reads .env):
// preflight classification on a real scan, the GitHub setup it reports, and
// that a run can't start without a repository linked to the website. Creates
// one quick scan of example.com and deletes it afterwards. No GitHub writes,
// no AI credits.
//   npx vitest run --config vitest.live.config.ts tests/live/geo-fix-all.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — skips below.
}

(process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip)("Fix all (live DB)", () => {
  const scans: string[] = [];
  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (scans.length) {
      await supabaseAdmin.from("geo_scans").delete().in("id", scans);
      for (const id of scans) {
        await supabaseAdmin.from("geo_audit_runs").delete().contains("meta", { scanId: id });
      }
    }
  });

  it("classifies findings, reports GitHub setup and refuses to start without a linked repository", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createScan, driveScan } = await import("@/server/geo/service.server");
    const { getFixAllPreflight, createFixBatch } = await import("@/server/geo/fixes/batch.server");

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    const scan = await createScan({
      workspaceId: ws!.id,
      userId: null,
      url: "https://example.com",
      mode: "quick",
      trigger: "manual",
    });
    scans.push(scan.id);
    await driveScan(scan.id, { budgetMs: 45_000 });

    // Service-role client stands in for the RLS client (the RLS path is covered by route auth).
    const ctx = {
      supabase: supabaseAdmin as never,
      userId: "00000000-0000-0000-0000-000000000000",
      workspaceId: ws!.id,
      canPropose: true,
      canManage: true,
    };
    const preflight = await getFixAllPreflight(ctx, scan.id);
    console.info(
      `[live] fix-all preflight: fixable=${preflight.fixable.length} (${preflight.fixable.map((f) => f.ruleId).join(", ")}) manual=${preflight.manualCount} inProgress=${preflight.inProgressCount} setup=${preflight.setup.requirement}`,
    );
    expect(preflight.fixable.some((f) => f.ruleId === "tech.meta_description")).toBe(true);
    expect(preflight.fixable.every((f) => !f.ruleId.startsWith("trust."))).toBe(true);
    expect(preflight.manualCount).toBeGreaterThanOrEqual(0);
    expect(["connect", "reconnect", "select_repository", "ready", "not_configured", "access_lost", "unsupported"]).toContain(
      preflight.setup.requirement,
    );

    if (preflight.setup.requirement !== "ready") {
      await expect(
        createFixBatch(ctx, {
          scanId: scan.id,
          sourceId: "00000000-0000-0000-0000-000000000000",
          baseBranch: "main",
        }),
      ).rejects.toThrow(/not found|isn't valid|linked/i);
      await expect(
        createFixBatch(ctx, { scanId: scan.id, sourceId: "00000000-0000-0000-0000-000000000000", baseBranch: "mellox/geo-x-aaaaaa" }),
      ).rejects.toThrow(/branch name isn't valid/i);
    }

    const { count } = await supabaseAdmin
      .from("geo_fix_batches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws!.id)
      .eq("scan_id", scan.id);
    expect(count).toBe(0);
  }, 180_000);
});
