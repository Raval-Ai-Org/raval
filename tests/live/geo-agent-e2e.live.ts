// End-to-end live run of the GEO Engineer through the same service functions
// the UI's RPCs call (not the stage functions directly):
//
//   repository linked + ownership verified (real GitHub evidence)
//   → real scan of the site → fix availability "ready"
//   → startAgentRun → runner (Claude Sonnet 5) → plan awaiting approval
//   → approveAgentPlan (plan hash) → runner → patch awaiting approval
//   → approveAndApply (content hash) → real mellox/ branch + pull request
//
// Spends model budget (GEO_AGENT_MAX_COST_USD per run) and opens a real pull
// request, so it needs an explicit opt-in on top of the credentials:
//   GEO_AGENT_E2E=1 npx vitest run --config vitest.live.config.ts tests/live/geo-agent-e2e.live.ts
//
// With E2E_TEST_EMAIL / E2E_TEST_PASSWORD the calls run as that user through
// row-level security; otherwise they fall back to the service role (logged).
// The pull request and rows are kept for review, merge and verification unless
// GEO_AGENT_E2E_CLEANUP=1 (closes the PR, deletes its branch and the rows).
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // No request scope here: the test drives the runner itself.
  after: () => undefined,
}));

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suite skips below.
}

const REPO = process.env.GEO_AGENT_LIVE_REPO ?? "ZainIqbal-01/threereach";
const SITE = process.env.GEO_AGENT_LIVE_SITE ?? "threereach.lovable.app";
const CLEANUP = process.env.GEO_AGENT_E2E_CLEANUP === "1";
const ready =
  process.env.GEO_AGENT_E2E === "1" &&
  !!process.env.OPENROUTER_API_KEY &&
  !!process.env.GITHUB_APP_ID &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Head metadata first: cheap, verifiable on the live page. */
const PREFERRED = [
  "tech.canonical",
  "schema.open_graph",
  "schema.twitter_card",
  "tech.meta_description",
  "schema.website",
  "schema.organization",
  "schema.jsonld",
  "tech.title",
];
const WAITING = new Set(["awaiting_plan_approval", "needs_input", "awaiting_patch_approval"]);

(ready ? describe : describe.skip)("GEO Engineer end to end (live)", () => {
  const created = { connections: [] as string[], sources: [] as string[], scans: [] as string[] };
  let cleanupPr: (() => Promise<void>) | null = null;

  afterAll(async () => {
    if (!CLEANUP) {
      console.info(
        "[live] kept rows and pull request for review (GEO_AGENT_E2E_CLEANUP=1 removes them)",
      );
      return;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (cleanupPr) await cleanupPr();
    if (created.scans.length)
      await supabaseAdmin.from("geo_scans").delete().in("id", created.scans);
    if (created.sources.length)
      await supabaseAdmin.from("workspace_sources").delete().in("id", created.sources);
    if (created.connections.length)
      await supabaseAdmin.from("workspace_connections").delete().in("id", created.connections);
  });

  it("goes from a finding to a real pull request through the product services", async () => {
    const started = Date.now();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createUserClient } = await import("@/integrations/supabase/client.user.server");
    const { CONNECTION_COLS, SOURCE_COLS } = await import("@/server/connectors/present");
    const { appRequest, installationRequest } =
      await import("@/server/connectors/github/api.server");
    const { selectRepository } = await import("@/server/connectors/github/service.server");
    const { verifySourceOwnership } = await import("@/server/connectors/github/ownership.server");
    const git = await import("@/server/connectors/github/git.server");
    const { createScan, driveScan } = await import("@/server/geo/service.server");
    const fixes = await import("@/server/geo/fixes/service.server");
    const agents = await import("@/server/geo/agents/service.server");
    const { runDueAgentRuns } = await import("@/server/geo/agents/runner.server");
    const { strategyForRule } = await import("@/server/geo/fixes/strategies");

    /* ── who: a real user session when available ── */
    let userId: string;
    let supabase: import("@/integrations/supabase/client.user.server").UserSupabaseClient;
    let workspaceId: string;
    if (process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD) {
      const { createClient } = await import("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false },
      });
      const { data, error } = await anon.auth.signInWithPassword({
        email: process.env.E2E_TEST_EMAIL,
        password: process.env.E2E_TEST_PASSWORD,
      });
      expect(error, error?.message).toBeNull();
      userId = data.user!.id;
      supabase = createUserClient(data.session!.access_token);
      const { data: m } = await supabaseAdmin
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .limit(1)
        .single();
      workspaceId = m!.workspace_id;
      console.info("[live] acting as the E2E test user through row-level security");
    } else {
      const { data: m } = await supabaseAdmin
        .from("workspace_members")
        .select("workspace_id, user_id")
        .eq("role", "owner")
        .order("created_at")
        .limit(1)
        .single();
      userId = m!.user_id;
      workspaceId = m!.workspace_id;
      supabase = supabaseAdmin as never;
      console.info(
        "[live] no E2E_TEST_EMAIL — service role client; row-level security NOT exercised",
      );
    }
    const ctx = { supabase, userId, workspaceId, canPropose: true, canManage: true };

    /* ── GitHub: the installation that can read the repository ── */
    const installations =
      (await appRequest<{ id: number; account: { login: string; type: string } }[]>(
        "/app/installations",
      )) ?? [];
    let installation: (typeof installations)[number] | null = null;
    let repoId: string | null = null;
    for (const inst of installations) {
      const repo = await installationRequest<{ id: number }>(
        String(inst.id),
        `/repos/${REPO}`,
      ).catch(() => null);
      if (repo) {
        installation = inst;
        repoId = String(repo.id);
        break;
      }
    }
    expect(installation, `the App can't read ${REPO}`).toBeTruthy();

    let { data: connection } = await supabaseAdmin
      .from("workspace_connections")
      .select(CONNECTION_COLS)
      .eq("workspace_id", workspaceId)
      .eq("provider", "github")
      .eq("external_account_id", String(installation!.id))
      .neq("status", "revoked")
      .maybeSingle();
    if (!connection) {
      // Test fixture for the real installation. The browser install flow is the
      // product path (tests/live/github-connect.live.ts covers its return leg).
      const { data, error } = await supabaseAdmin
        .from("workspace_connections")
        .insert({
          workspace_id: workspaceId,
          provider: "github",
          external_account_id: String(installation!.id),
          status: "active",
          account_login: installation!.account.login,
          account_type: installation!.account.type,
          verification: "install_window",
          connected_by: userId,
          last_verified_at: new Date().toISOString(),
          metadata: { fixture: "geo-agent-e2e.live" },
        })
        .select(CONNECTION_COLS)
        .single();
      expect(error, error?.message).toBeNull();
      connection = data;
      created.connections.push(data!.id);
    }
    const conn = connection as unknown as import("@/server/connectors/present").ConnectionRow;

    /* ── real scan first: ownership compares the scanned pages with the source ── */
    const scan = await createScan({
      workspaceId,
      userId,
      url: `https://${SITE}`,
      mode: "quick",
      trigger: "manual",
    });
    created.scans.push(scan.id);
    await driveScan(scan.id, { budgetMs: 120_000 });

    /* ── link the repository to the site and verify ownership (real evidence) ── */
    const linked = await selectRepository({
      connection: conn,
      userId,
      repositoryId: repoId!,
      siteUrl: `https://${SITE}`,
    });
    if (created.connections.length) created.sources.push(linked.id);
    const { data: sourceRow } = await supabaseAdmin
      .from("workspace_sources")
      .select(SOURCE_COLS)
      .eq("id", linked.id)
      .single();
    const owned = await verifySourceOwnership({
      source: sourceRow as never,
      connection: conn,
      userId,
      siteHost: SITE,
    });
    console.info(
      `[live] ownership ${owned.ownership.status} (${owned.ownership.confidence}): ${owned.ownership.evidence
        .map((e) => `${e.signal}=${e.weight} ${e.detail}`)
        .join(
          " | ",
        )}${owned.ownership.hints.length ? `\n   hints: ${owned.ownership.hints.join(" ")}` : ""}`,
    );
    if (owned.ownership.status !== "verified") {
      // Hosts like Lovable report no deployments: the product path is an audited
      // confirmation by a workspace admin on top of the evidence found.
      const { attestSourceOwnership } = await import("@/server/connectors/github/ownership.server");
      const { data: checked } = await supabaseAdmin
        .from("workspace_sources")
        .select(SOURCE_COLS)
        .eq("id", linked.id)
        .single();
      const attested = await attestSourceOwnership({
        source: checked as never,
        userId,
        siteHost: SITE,
      });
      console.info(`[live] ownership confirmed by workspace admin: ${attested.ownership.status}`);
      expect(attested.ownership.status).toBe("attested");
    }
    const { data: findings } = await supabaseAdmin
      .from("geo_findings")
      .select("id, rule_id, page_url, detail")
      .eq("scan_id", scan.id);
    console.info(
      `[live] scan ${scan.id}: ${findings!.length} finding(s): ${[...new Set(findings!.map((f) => f.rule_id))].join(", ")}`,
    );
    const candidates = [
      ...PREFERRED.map((id) => findings!.find((f) => f.rule_id === id)).filter(Boolean),
      ...findings!.filter(
        (f) =>
          !PREFERRED.includes(f.rule_id) &&
          strategyForRule(f.rule_id).mode === "agent" &&
          strategyForRule(f.rule_id).grounding !== "page_text_inputs",
      ),
    ] as NonNullable<typeof findings>;
    expect(candidates.length, "no agent-fixable finding on the site").toBeGreaterThan(0);

    const drive = async (runId: string) => {
      for (let i = 0; i < 10; i++) {
        const { run: view } = await agents.getAgentRun(ctx, runId);
        if (WAITING.has(view.status) || view.completedAt) return view;
        await runDueAgentRuns({ id: runId, budgetMs: 290_000, max: 1 });
      }
      return (await agents.getAgentRun(ctx, runId)).run;
    };

    for (const finding of candidates.slice(0, 3)) {
      /* ── availability: the agent is offered for this finding ── */
      const availability = await fixes.getFixAvailability(ctx, finding.id);
      console.info(
        `[live] ${finding.rule_id}: availability ${availability.requirement} — ${availability.reason}`,
      );
      expect(availability.requirement).toBe("ready");

      /* ── start → plan ── */
      const start = await agents.startAgentRun(ctx, { findingId: finding.id });
      if (!start.ok) throw new Error(`start refused: ${start.reason}`);
      let run = await drive(start.runId);
      console.info(
        `[live] run ${run.id} model=${run.model} status=${run.status} cost=$${run.usage?.costUsd.toFixed(3)} files read: ${run.filesInspected
          .map((f) => f.path)
          .join(", ")}`,
      );
      if (run.status !== "awaiting_plan_approval") {
        console.info(`[live] ${finding.rule_id} ended ${run.status}: ${run.statusDetail}`);
        continue;
      }
      expect(run.model).toBe(
        process.env.AI_MODEL_GEO_AGENT_INVESTIGATE?.split(",")[0]?.trim() ||
          "anthropic/claude-opus-5.5",
      );
      const plan = run.plan!;
      console.info(
        `[live] plan: ${plan.strategy} — ${plan.files.map((f) => `${f.action}:${f.path}`).join(", ")}\n   ${plan.summary}`,
      );
      const read = new Set(run.filesInspected.map((f) => f.path));
      for (const f of plan.files.filter((x) => x.action === "update"))
        expect(read.has(f.path), `planned update of unread file ${f.path}`).toBe(true);

      /* ── approve plan → patch ── */
      await agents.approveAgentPlan(ctx, { runId: run.id, planHash: run.planHash! });
      run = await drive(run.id);
      console.info(
        `[live] after implementation: ${run.status} (${run.correctionRounds} correction(s), $${run.usage?.costUsd.toFixed(3)}) ${run.statusDetail ?? ""}`,
      );
      if (run.status !== "awaiting_patch_approval") {
        console.info(`[live] ${finding.rule_id} implementation ended ${run.status}`);
        continue;
      }
      const proposal = run.proposal!;
      expect(proposal.validation.ok).toBe(true);
      console.info(
        `[live] review: ${run.review?.verdict} — ${run.review?.summary}\n[live] checks: ${proposal.validation.checks
          .map((c) => `${c.id}=${c.status}`)
          .join(" ")}\n${proposal.files
          .map((f) => f.diff)
          .join("\n")
          .slice(0, 4000)}`,
      );

      /* ── approve patch → real branch + pull request ── */
      const [owner, name] = REPO.split("/");
      const before = await git.getBranch(String(installation!.id), REPO, proposal.baseBranch!);
      const applied = await fixes.approveAndApply(ctx, {
        proposalId: proposal.id,
        contentHash: proposal.contentHash!,
      });
      expect(applied.status).toBe("pr_open");
      expect(applied.pr?.url).toMatch(
        new RegExp(`^https://github\\.com/${owner}/${name}/pull/\\d+$`),
      );
      expect(applied.headBranch).toMatch(/^mellox\//);
      const pr = await git.getPullRequest(String(installation!.id), REPO, applied.pr!.number);
      expect(pr?.state).toBe("open");
      const after = await git.getBranch(String(installation!.id), REPO, proposal.baseBranch!);
      expect(after!.sha, "the base branch must not move").toBe(before!.sha);
      console.info(
        `[live] PULL REQUEST ${applied.pr!.url} branch ${applied.headBranch} commit ${applied.commitSha ?? ""}`,
      );
      const { run: final } = await agents.getAgentRun(ctx, run.id);
      console.info(`[live] run status now ${final.status}`);

      cleanupPr = async () => {
        await git.closePullRequest(String(installation!.id), REPO, applied.pr!.number);
        await git.deleteMelloxBranch(String(installation!.id), REPO, applied.headBranch!);
      };
      console.info(`[live] done in ${Math.round((Date.now() - started) / 1000)}s`);
      return;
    }
    throw new Error("none of the candidate findings reached a pull request");
  }, 1_800_000);
});
