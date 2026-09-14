// Live check of AI Visibility end to end: a real multi-page crawl of a public
// site through the scan worker, against the real Supabase project (reads .env).
// Creates two scans in the first workspace it finds, verifies pages, findings,
// scores, audit history and scan comparison, then deletes everything it made.
// No AI credits are used (probes stay off). Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/geo-scan.live.ts
// GEO_LIVE_URL picks the site (default https://nextjs.org).
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const SITE = process.env.GEO_LIVE_URL || "https://nextjs.org";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

describeLive("AI visibility scan (live)", () => {
  const created: string[] = [];
  let auditRunsBefore = 0;
  let workspaceId = "";

  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!created.length) return;
    await supabaseAdmin.from("geo_scans").delete().in("id", created);
    // Audit history rows the worker wrote for these scans.
    for (const id of created) {
      await supabaseAdmin
        .from("geo_audit_runs")
        .delete()
        .eq("workspace_id", workspaceId)
        .contains("meta", { scanId: id });
    }
  });

  async function runToCompletion(scanId: string) {
    const { driveScan } = await import("@/server/geo/service.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let i = 0; i < 20; i++) {
      const result = await driveScan(scanId, { budgetMs: 45_000 });
      const { data } = await supabaseAdmin
        .from("geo_scans")
        .select("status")
        .eq("id", scanId)
        .single();
      if (data && data.status !== "queued" && data.status !== "running") return data.status;
      if (result === "not_claimed") await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("scan did not finish");
  }

  it("crawls, scores, persists findings and compares two scans", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createScan } = await import("@/server/geo/service.server");
    const { compareScans } = await import("@/lib/geo/compare");

    const { data: ws, error: wsError } = await supabaseAdmin
      .from("workspaces")
      .select("id, plan")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    expect(wsError).toBeNull();
    workspaceId = ws!.id;
    const { count } = await supabaseAdmin
      .from("geo_audit_runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    auditRunsBefore = count ?? 0;

    // 1) Full site scan through the durable worker.
    const full = await createScan({
      workspaceId,
      userId: null,
      url: SITE,
      mode: "full",
      trigger: "manual",
      idempotencyKey: `live-${Date.now()}`,
    });
    created.push(full.id);
    expect(await runToCompletion(full.id)).toBe("succeeded");

    const { data: scan } = await supabaseAdmin
      .from("geo_scans")
      .select("overall_score, category_scores, report, site, progress")
      .eq("id", full.id)
      .single();
    const report = scan!.report as {
      counts: { pagesCrawled: number; findings: number };
      categories: unknown[];
      actions: unknown[];
    };
    expect(scan!.overall_score).toBeGreaterThan(0);
    expect(report.categories).toHaveLength(6);
    expect(report.counts.pagesCrawled).toBeGreaterThan(1);

    const { data: pages } = await supabaseAdmin
      .from("geo_scan_pages")
      .select("state, analysis")
      .eq("scan_id", full.id);
    expect(pages!.filter((p) => p.state === "fetched" && p.analysis).length).toBeGreaterThan(1);
    expect(pages!.filter((p) => p.state === "pending")).toHaveLength(0);

    const { data: findings } = await supabaseAdmin
      .from("geo_findings")
      .select("fingerprint, rule_id, title, detail, severity, category, page_url, point_impact")
      .eq("scan_id", full.id);
    expect(findings!.length).toBe(report.counts.findings);

    // 2) Quick homepage check, then compare the two by fingerprint.
    const quick = await createScan({
      workspaceId,
      userId: null,
      url: SITE,
      mode: "quick",
      trigger: "manual",
    });
    created.push(quick.id);
    expect(await runToCompletion(quick.id)).toBe("succeeded");
    const { data: quickFindings } = await supabaseAdmin
      .from("geo_findings")
      .select("fingerprint, rule_id, title, detail, severity, category, page_url, point_impact")
      .eq("scan_id", quick.id);

    const toComparable = (rows: typeof findings) =>
      rows!.map((f) => ({
        fingerprint: f.fingerprint,
        ruleId: f.rule_id,
        title: f.title,
        detail: f.detail,
        severity: f.severity as "low",
        category: f.category as "technical",
        pageUrl: f.page_url,
        pointImpact: Number(f.point_impact),
      }));
    const diff = compareScans(
      {
        id: full.id,
        createdAt: "a",
        overall: scan!.overall_score,
        categories: [],
        findings: toComparable(findings),
      },
      {
        id: quick.id,
        createdAt: "b",
        overall: 0,
        categories: [],
        findings: toComparable(quickFindings),
      },
    );
    expect(diff.persistingCount).toBeGreaterThan(0);

    // 3) The worker recorded score history for Analytics / Coach.
    const { count: after } = await supabaseAdmin
      .from("geo_audit_runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    expect(after).toBe(auditRunsBefore + 2);

    console.info(
      `[live] ${SITE} full score=${scan!.overall_score} pages=${report.counts.pagesCrawled} findings=${report.counts.findings} actions=${report.actions.length} · vs quick: ${diff.summary}`,
    );
  }, 600_000);

  it("rejects private and metadata addresses before any row is created", async () => {
    const { createScan } = await import("@/server/geo/service.server");
    const { SsrfBlockedError } = await import("@/server/safe-fetch");
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:8080",
      "http://10.0.0.5/",
    ]) {
      await expect(
        createScan({
          workspaceId: workspaceId || "00000000-0000-0000-0000-000000000000",
          userId: null,
          url,
          mode: "quick",
          trigger: "manual",
        }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });
});
