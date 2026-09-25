// Live check of the Proof Engine data path against the real Supabase project
// (reads .env). It builds one experiment from synthetic numbers in the first
// workspace it finds and drives it through the real server code:
//
//   draft → design lock → shipped → live → daily metrics → analysis → verdict
//   job queue (one pending job per kind, leased claim) → client report →
//   the public share API on a running dev server (EXPERIMENTS_LIVE_BASE_URL,
//   default http://localhost:8083; skipped when nothing answers there)
//
// No GitHub, Google or AI calls, and everything it creates is deleted. Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/experiments.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE = process.env.EXPERIMENTS_LIVE_BASE_URL || "http://localhost:8083";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describeLive("Proof Engine (live)", () => {
  let workspaceId = "";
  let experimentId = "";
  let shareId = "";

  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (shareId) await supabaseAdmin.from("client_shares").delete().eq("id", shareId);
    if (experimentId) await supabaseAdmin.from("experiments").delete().eq("id", experimentId);
  });

  it("runs an experiment from draft to a verdict on real tables", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const core = await import("@/server/experiments/core.server");
    const { storeSeries } = await import("@/server/experiments/metrics.server");
    const { runAnalysis } = await import("@/server/experiments/analyze.server");
    const { mulberry32 } = await import("@/lib/experiments/random");
    const { ZERO_ROW } = await import("@/lib/experiments/series");

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .order("created_at")
      .limit(1)
      .single();
    workspaceId = ws!.id;

    const preEnd = "2026-06-30";
    const preStart = addDays(preEnd, -55);
    const liveDay = addDays(preEnd, 1);
    const { data: created, error } = await supabaseAdmin
      .from("experiments")
      .insert({
        workspace_id: workspaceId,
        site_host: "live-test.example.com",
        name: "Live test: price in titles",
        hypothesis: "Adding the price to product titles will increase clicks.",
        change_type: "title",
        primary_metric: "clicks",
        status: "draft",
        pre_period_start: preStart,
        pre_period_end: preEnd,
        result: { prepare: { state: "ready" } },
      })
      .select("*")
      .single();
    expect(error).toBeNull();
    experimentId = created!.id;
    let exp = created as unknown as import("@/server/experiments/core.server").ExperimentRow;

    // 30 pairs; treatment gets +20% clicks from the live day on.
    const rng = mulberry32(42);
    const assignments: { path: string; arm: string; stratum: number }[] = [];
    for (let s = 0; s < 30; s++) {
      assignments.push({ path: `/products/t-${s}`, arm: "treatment", stratum: s });
      assignments.push({ path: `/products/c-${s}`, arm: "control", stratum: s });
    }
    const { error: aErr } = await supabaseAdmin.from("experiment_assignments").insert(
      assignments.map((a) => ({
        ...a,
        experiment_id: experimentId,
        workspace_id: workspaceId,
        site_host: exp.site_host,
        page_url: `https://${exp.site_host}${a.path}`,
        baseline: { fieldValue: `Old title ${a.path}` },
      })),
    );
    expect(aErr).toBeNull();
    const { error: cErr } = await supabaseAdmin.from("experiment_changes").insert(
      assignments
        .filter((a) => a.arm === "treatment")
        .map((a) => ({
          experiment_id: experimentId,
          workspace_id: workspaceId,
          path: a.path,
          field: "title",
          before: `Old title ${a.path}`,
          after: `New title with price ${a.path}`,
        })),
    );
    expect(cErr).toBeNull();

    const dates: string[] = [];
    for (let d = preStart; d <= addDays(liveDay, 42); d = addDays(d, 1)) dates.push(d);
    const series: Record<string, Record<string, typeof ZERO_ROW>> = {};
    for (const a of assignments) {
      const base = 20 + a.stratum;
      series[a.path] = {};
      for (const d of dates) {
        const lift = a.arm === "treatment" && d > liveDay ? 1.2 : 1;
        const clicks = Math.round(base * lift * (0.85 + rng() * 0.3));
        series[a.path][d] = {
          ...ZERO_ROW,
          clicks,
          impressions: clicks * 20,
          revenue: clicks * 3,
          position_weighted: clicks * 20 * 5,
        };
      }
    }
    await storeSeries({
      experiment: exp,
      assignments: assignments as never,
      series,
      dates,
      ga4Complete: true,
    });

    // Draft → awaiting approval: the design locks in the database.
    const locked = await core.transition(exp, "draft", "awaiting_approval");
    expect(locked?.status).toBe("awaiting_approval");
    const lockTry = await supabaseAdmin
      .from("experiments")
      .update({ change_type: "h1" })
      .eq("id", experimentId);
    expect(lockTry.error?.message).toMatch(/locked/);
    const childTry = await supabaseAdmin
      .from("experiment_changes")
      .update({ after: "sneaky" })
      .eq("experiment_id", experimentId);
    expect(childTry.error?.message).toMatch(/locked/);

    // A second compare-and-set from the old state does nothing.
    expect(await core.transition(exp, "draft", "awaiting_approval")).toBeNull();

    exp = (await core.transition(locked!, "awaiting_approval", "shipping"))!;
    exp = (await core.transition(exp, "shipping", "awaiting_deploy", {
      approved_patch_hash: "a".repeat(64),
    }))!;
    exp = (await core.transition(exp, "awaiting_deploy", "running", {
      live_confirmed_at: `${liveDay}T12:00:00Z`,
    }))!;
    expect(exp.status).toBe("running");

    // Jobs: one pending job per kind; a leased claim picks it up.
    await core.enqueueJob(exp, "analyze", new Date(Date.now() + 3_600_000));
    await core.enqueueJob(exp, "analyze", new Date());
    const { data: jobs } = await supabaseAdmin
      .from("experiment_jobs")
      .select("id, next_attempt_at")
      .eq("experiment_id", experimentId)
      .eq("status", "queued");
    expect(jobs).toHaveLength(1);
    expect(Date.parse(jobs![0].next_attempt_at)).toBeLessThanOrEqual(Date.now() + 1000);
    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("claim_experiment_jobs", {
      p_worker: "live-test",
      p_max: 1,
      p_lease_seconds: 60,
      p_id: jobs![0].id,
    });
    expect(claimErr).toBeNull();
    expect((claimed as { id: string }[])[0]?.id).toBe(jobs![0].id);
    await core.cancelJobs(experimentId);

    // Analysis: 42 days after the live day → a checkpoint verdict.
    const { data: rows } = await supabaseAdmin
      .from("experiment_assignments")
      .select("*")
      .eq("experiment_id", experimentId);
    const outcome = await runAnalysis(exp, rows as never, "USD");
    expect(outcome).toBe("concluded");
    const done = await core.loadExperimentAdmin(experimentId);
    expect(done?.status).toBe("concluded");
    expect(done?.verdict).toBe("win");
    expect(Number(done?.lift)).toBeGreaterThan(0.1);
    expect(Number(done?.lift)).toBeLessThan(0.3);
    expect(Number(done?.lift_low)).toBeGreaterThan(0);
    expect(Number(done?.estimated_monthly_value)).toBeGreaterThan(0);
    expect(done?.value_currency).toBe("USD");

    const verdictTry = await supabaseAdmin
      .from("experiments")
      .update({ verdict: "loss" })
      .eq("id", experimentId);
    expect(verdictTry.error?.message).toMatch(/final/);

    const { data: events } = await supabaseAdmin
      .from("experiment_events")
      .select("id, kind")
      .eq("experiment_id", experimentId);
    expect(events!.some((e) => e.kind === "verdict")).toBe(true);
    const delTry = await supabaseAdmin.from("experiment_events").delete().eq("id", events![0].id);
    expect(delTry.error?.message).toMatch(/append-only/);
  });

  it("builds the client report only for its own workspace", async () => {
    const { buildReport } = await import("@/server/experiments/report.server");
    const report = await buildReport(experimentId, workspaceId);
    expect(report?.verdict).toBe("win");
    expect(report?.pages).toEqual({ treatment: 30, control: 30 });
    expect(report?.daily.length).toBeGreaterThan(40);
    expect(report?.examples[0]?.after).toMatch(/New title/);
    expect(await buildReport(experimentId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("serves the report through the public share link", async () => {
    const up = await fetch(`${BASE}/api/public/hooks/experiments`).catch(() => null);
    if (!up?.ok) {
      console.warn(`[experiments.live] no dev server at ${BASE}; share check skipped`);
      return;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashShareToken, makeShareToken } = await import("@/server/shares/link-token.server");
    const token = makeShareToken();
    const slug = `livetest${Date.now().toString(36)}`;
    const { data: member } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .single();
    const { data: share, error } = await supabaseAdmin
      .from("client_shares")
      .insert({
        workspace_id: workspaceId,
        owner_id: member!.user_id,
        title: "Live test report",
        slug,
        token_hash: hashShareToken(token),
        status: "active",
        allow_comments: false,
        allow_approvals: false,
        allow_download: false,
        branding: {},
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    shareId = share!.id;
    // A forged snapshot must be ignored: the report is built on view.
    await supabaseAdmin.from("client_share_items").insert({
      share_id: shareId,
      kind: "experiment_report",
      ref_id: experimentId,
      title: "Result",
      position: 0,
      visible: true,
      snapshot: { name: "Forged", lift: 99 },
    });
    const res = await fetch(`${BASE}/api/public/share/${slug}?t=${encodeURIComponent(token)}`);
    const body = (await res.json()) as {
      items: { kind: string; snapshot: { name?: string; lift?: number; unavailable?: boolean } }[];
    };
    expect(res.status).toBe(200);
    const item = body.items.find((i) => i.kind === "experiment_report")!;
    // With the flag off on that server the report is withheld, never forged.
    if (item.snapshot.unavailable) {
      console.warn("[experiments.live] Proof Engine flag is off on the dev server");
      expect(item.snapshot.name).toBeUndefined();
      return;
    }
    expect(item.snapshot.name).toBe("Live test: price in titles");
    expect(item.snapshot.lift).toBeLessThan(1);
  });
});
