// Live checks of the AI Visibility fix workflow's real paths (reads .env):
//
//   1. Browser rendering on real public sites (static, SSR, SPA) through the
//      SSRF-guarded fetcher — skipped when no Chromium is installed.
//   2. A targeted verification against the real database: a finding that is
//      still broken on the live site must NOT be resolved. Cleans up its rows.
//   3. GitHub read path for the first installation: branches, tree, a file,
//      CI-check permission reporting. Read-only.
//   4. GitHub write path — ONLY when GITHUB_LIVE_REPO is set: branch + commit +
//      pull request, sync, then close the PR and delete the mellox/ branch.
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/geo-fix.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suites skip below.
}

const hasDb = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasGitHub = !!process.env.GITHUB_APP_ID && hasDb;

describe("browser rendering (live)", () => {
  const SITES: { url: string; kind: string }[] = [
    { url: "https://example.com/", kind: "static" },
    { url: "https://nextjs.org/", kind: "Next.js SSR" },
    { url: "https://vuejs.org/", kind: "Vue SSG" },
    { url: "https://angular.dev/", kind: "Angular" },
    { url: "https://excalidraw.com/", kind: "React SPA" },
  ];

  it("decides HTTP vs browser per site and renders shells through the guarded fetcher", async () => {
    process.env.FEATURE_FLAG_GEO_RENDERING_ENABLED = "true";
    const { getRenderingAvailability, createRenderer } = await import("@/server/geo/render.server");
    const { getDefaultFetcher, fetchWithRetry } = await import("@/server/geo/crawler.server");
    const { analyzePage } = await import("@/lib/geo/analyze-page");
    const { needsRendering } = await import("@/lib/geo/rendering");
    const availability = await getRenderingAvailability();
    console.info(`[live] rendering: ${availability.available} (${availability.reason})`);
    const fetcher = getDefaultFetcher();
    const render = availability.available ? createRenderer(fetcher) : null;

    for (const site of SITES) {
      const res = await fetchWithRetry(fetcher, site.url, { timeoutMs: 15_000 });
      if (!res.ok) {
        console.info(`[live] ${site.kind} ${site.url}: HTTP ${res.status ?? res.error} — skipped`);
        continue;
      }
      const http = analyzePage(res.body, res.finalUrl ?? site.url);
      const decision = needsRendering(res.body, http);
      let renderedWords: number | null = null;
      if (decision.render && render) {
        const out = await render(res.finalUrl ?? site.url);
        expect(out.ok, out.ok ? "" : out.error).toBe(true);
        if (out.ok) renderedWords = analyzePage(out.html, site.url).text.words;
      }
      console.info(
        `[live] ${site.kind.padEnd(10)} ${site.url} httpWords=${http.text.words} render=${decision.render} markers=${decision.markers.join(",") || "-"} renderedWords=${renderedWords ?? "-"}`,
      );
      if (site.kind === "static" || site.kind === "Next.js SSR")
        expect(decision.render).toBe(false);
      if (decision.render && render) expect(renderedWords).toBeGreaterThan(http.text.words);
    }
  }, 240_000);

  it("refuses to render private addresses", async () => {
    const { createRenderer, getRenderingAvailability } = await import("@/server/geo/render.server");
    const { getDefaultFetcher } = await import("@/server/geo/crawler.server");
    process.env.FEATURE_FLAG_GEO_RENDERING_ENABLED = "true";
    if (!(await getRenderingAvailability()).available) return;
    const out = await createRenderer(getDefaultFetcher())(
      "http://169.254.169.254/latest/meta-data",
    );
    expect(out.ok).toBe(false);
  }, 60_000);
});

(hasDb ? describe : describe.skip)("fix verification (live DB)", () => {
  const scans: string[] = [];
  const verifications: string[] = [];
  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (verifications.length)
      await supabaseAdmin.from("geo_verifications").delete().in("id", verifications);
    if (scans.length) {
      await supabaseAdmin.from("geo_scans").delete().in("id", scans);
      for (const id of scans) {
        await supabaseAdmin.from("geo_audit_runs").delete().contains("meta", { scanId: id });
      }
    }
  });

  it("does not resolve a finding that still fails on the live site", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createScan, driveScan } = await import("@/server/geo/service.server");
    const { scheduleVerification, runDueVerifications } =
      await import("@/server/geo/fixes/verify.server");

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    const workspaceId = ws!.id;

    const baseline = await createScan({
      workspaceId,
      userId: null,
      url: "https://example.com",
      mode: "quick",
      trigger: "manual",
    });
    scans.push(baseline.id);
    await driveScan(baseline.id, { budgetMs: 45_000 });
    const { data: finding } = await supabaseAdmin
      .from("geo_findings")
      .select("fingerprint, rule_id, page_url, status, detail")
      .eq("scan_id", baseline.id)
      .eq("rule_id", "tech.meta_description")
      .maybeSingle();
    expect(
      finding,
      "example.com has no meta description, so this finding should exist",
    ).toBeTruthy();

    const { data: stateBefore } = await supabaseAdmin
      .from("geo_finding_states")
      .select("state")
      .eq("workspace_id", workspaceId)
      .eq("fingerprint", finding!.fingerprint)
      .maybeSingle();

    const v = await scheduleVerification({
      workspaceId,
      userId: null,
      proposalId: null,
      origin: "https://example.com",
      targets: [
        { fingerprint: finding!.fingerprint, ruleId: finding!.rule_id, pageUrl: finding!.page_url },
      ],
      baselineScanId: baseline.id,
      before: {
        [finding!.fingerprint]: {
          status: finding!.status as "fail",
          detail: finding!.detail,
          pageUrl: finding!.page_url,
        },
      },
      delaysMinutes: [0],
    });
    verifications.push(v.id);
    for (let i = 0; i < 6; i++) {
      await runDueVerifications({ id: v.id, budgetMs: 90_000, max: 1 });
      const { data } = await supabaseAdmin
        .from("geo_verifications")
        .select("status, scan_id")
        .eq("id", v.id)
        .single();
      if (data?.scan_id && !scans.includes(data.scan_id)) scans.push(data.scan_id);
      if (data && data.status !== "scheduled" && data.status !== "running") break;
    }
    const { data: done } = await supabaseAdmin
      .from("geo_verifications")
      .select("status, outcome_detail, after, scan_id")
      .eq("id", v.id)
      .single();
    console.info(`[live] verification ${done!.status}: ${done!.outcome_detail}`);
    expect(done!.status).toBe("not_verified");

    const { data: scan } = await supabaseAdmin
      .from("geo_scans")
      .select("mode, trigger")
      .eq("id", done!.scan_id!)
      .single();
    expect(scan).toMatchObject({ mode: "targeted", trigger: "verification" });

    const { data: stateAfter } = await supabaseAdmin
      .from("geo_finding_states")
      .select("state")
      .eq("workspace_id", workspaceId)
      .eq("fingerprint", finding!.fingerprint)
      .maybeSingle();
    expect(stateAfter?.state ?? null).toBe(stateBefore?.state ?? null);
    expect(stateAfter?.state).not.toBe("resolved");
  }, 300_000);
});

(hasGitHub ? describe : describe.skip)("GitHub fix path (live)", () => {
  it("reads branches, the tree and a file, and reports CI-check permission honestly", async () => {
    const { appRequest, installationRequest } =
      await import("@/server/connectors/github/api.server");
    const git = await import("@/server/connectors/github/git.server");
    const { detectFramework } = await import("@/server/connectors/github/inspect");
    const installations =
      (await appRequest<{ id: number; account: { login: string } }[]>("/app/installations")) ?? [];
    if (!installations.length) {
      console.info(
        "[live] no installations — install the App on a repository to exercise the read path",
      );
      return;
    }
    const installationId = String(installations[0].id);
    const repos = await installationRequest<{
      repositories: { full_name: string; default_branch: string; archived: boolean }[];
    }>(installationId, "/installation/repositories?per_page=20");
    const repo = repos?.repositories.find((r) => !r.archived);
    if (!repo) return;
    console.info(
      `[live] repositories visible: ${repos!.repositories.map((r) => r.full_name).join(", ")}`,
    );

    const branches = await git.listBranches(installationId, repo.full_name);
    expect(branches.some((b) => b.name === repo.default_branch)).toBe(true);
    const branch = await git.getBranch(installationId, repo.full_name, repo.default_branch);
    expect(branch?.sha).toMatch(/^[0-9a-f]{40}$/);
    const { paths } = await git.getTreePaths(installationId, repo.full_name, branch!.treeSha);
    const readable = paths.find((p) => /^(package\.json|README\.md|index\.html)$/i.test(p));
    let pkg = null;
    if (readable) {
      const file = await git.readFile(installationId, repo.full_name, readable, branch!.name);
      expect(file?.content.length).toBeGreaterThan(0);
      if (readable === "package.json") pkg = JSON.parse(file!.content);
    }
    const framework = detectFramework([...new Set(paths.map((p) => p.split("/")[0]))], pkg);
    const checks = await git.getChecks(installationId, repo.full_name, branch!.sha);
    console.info(
      `[live] ${repo.full_name}@${branch!.name}: ${paths.length} files, framework=${framework.framework ?? "unknown"}, read=${readable ?? "-"}, checks=${checks.available ? checks.state : `unavailable (${checks.reason})`}`,
    );
  }, 120_000);

  (process.env.GITHUB_LIVE_REPO ? it : it.skip)(
    "opens a pull request from a new mellox/ branch, syncs it, then closes it and deletes the branch",
    async () => {
      const { appRequest, installationRequest } =
        await import("@/server/connectors/github/api.server");
      const git = await import("@/server/connectors/github/git.server");
      const { proposalBranchName } = await import("@/server/connectors/github/paths");
      const repoName = process.env.GITHUB_LIVE_REPO!;
      const installations = (await appRequest<{ id: number }[]>("/app/installations")) ?? [];
      let installationId: string | null = null;
      for (const inst of installations) {
        const r = await installationRequest<{ id: number }>(
          String(inst.id),
          `/repos/${repoName}`,
        ).catch(() => null);
        if (r) {
          installationId = String(inst.id);
          break;
        }
      }
      expect(installationId, `the App isn't installed on ${repoName}`).toBeTruthy();
      const repo = await installationRequest<{ default_branch: string }>(
        installationId!,
        `/repos/${repoName}`,
      );
      const base = await git.getBranch(installationId!, repoName, repo!.default_branch);
      const head = proposalBranchName("live-test", Math.random().toString(36).slice(2, 8));
      const { commitSha } = await git.commitToNewBranch({
        installationId: installationId!,
        repo: repoName,
        baseBranch: base!.name,
        baseSha: base!.sha,
        headBranch: head,
        message: "Mellox live test (will be closed automatically)",
        files: [
          {
            path: "mellox-live-test.txt",
            content: `Mellox live test ${new Date().toISOString()}\n`,
          },
        ],
      });
      let pr: Awaited<ReturnType<typeof git.createPullRequest>> | null = null;
      try {
        pr = await git.createPullRequest({
          installationId: installationId!,
          repo: repoName,
          headBranch: head,
          baseBranch: base!.name,
          title: "Mellox live test — safe to ignore, closes automatically",
          body: "Automated test of the Mellox AI Visibility pull-request path. It is closed and its branch deleted by the test.",
        });
        expect(pr.state).toBe("open");
        const synced = await git.getPullRequest(installationId!, repoName, pr.number);
        expect(synced?.headSha).toBe(commitSha);
        const after = await git.getBranch(installationId!, repoName, base!.name);
        expect(after?.sha, "the base branch must not move").toBe(base!.sha);
        console.info(`[live] opened ${pr.url}`);
      } finally {
        if (pr) await git.closePullRequest(installationId!, repoName, pr.number);
        await git.deleteMelloxBranch(installationId!, repoName, head);
      }
      const closed = await git.getPullRequest(installationId!, repoName, pr!.number);
      expect(closed?.state).toBe("closed");
      expect(await git.getBranch(installationId!, repoName, head)).toBeNull();
    },
    180_000,
  );
});
