// Live run of the Mellox GEO Engineer against real services (reads .env):
//
//   1. a real quick scan of GEO_AGENT_LIVE_SITE (database rows cleaned up)
//   2. a real agent-fixable finding from that scan
//   3. the repository at its default branch through the GitHub App (read-only)
//   4. investigate → plan with Claude Sonnet 5 (cost-capped) — every planned
//      "update" file must have been read by the agent
//   5. implement → self-review → validate (→ correct) — a real patch
//   6. ONLY with GEO_AGENT_LIVE_PR=1: commit to a new mellox/ branch, open a
//      pull request, confirm the base branch didn't move, then close the PR and
//      delete the branch
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/geo-agent.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suite skips below.
}

const REPO = process.env.GEO_AGENT_LIVE_REPO ?? "ZainIqbal-01/threereach";
const SITE = process.env.GEO_AGENT_LIVE_SITE ?? "threereach.lovable.app";
const ready =
  !!process.env.OPENROUTER_API_KEY &&
  !!process.env.GITHUB_APP_ID &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;
/** Rules tried in order: head metadata first (a cheap, verifiable change). */
const PREFERRED = [
  "tech.canonical",
  "schema.open_graph",
  "schema.twitter_card",
  "tech.meta_description",
  "schema.website",
  "schema.jsonld",
  "tech.title",
  "content.h1",
];

(ready ? describe : describe.skip)("GEO coding agent (live)", () => {
  const scans: string[] = [];
  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (scans.length) {
      await supabaseAdmin.from("geo_scans").delete().in("id", scans);
      for (const id of scans)
        await supabaseAdmin.from("geo_audit_runs").delete().contains("meta", { scanId: id });
    }
  });

  it("investigates, plans and produces a validated patch on a real repository", async () => {
    const started = Date.now();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createScan, driveScan } = await import("@/server/geo/service.server");
    const { appRequest, installationRequest } =
      await import("@/server/connectors/github/api.server");
    const git = await import("@/server/connectors/github/git.server");
    const { detectFramework } = await import("@/server/connectors/github/inspect");
    const { strategyForRule } = await import("@/server/geo/fixes/strategies");
    const { fixKindForRule, planFixTarget } = await import("@/server/geo/fixes/targets");
    const { playbookFor, allowedImportsFor } =
      await import("@/server/geo/agents/framework-playbooks");
    const agent = await import("@/server/geo/agents/geo-coding-agent");
    const { newToolState } = await import("@/server/geo/agents/repo-tools.server");
    const { RULE_BY_ID } = await import("@/lib/geo/rules");
    const { pageRowToCrawled } = await import("@/server/geo/store.server");
    void pageRowToCrawled;

    /* 1. real scan */
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .order("created_at")
      .limit(1)
      .single();
    const scan = await createScan({
      workspaceId: ws!.id,
      userId: null,
      url: `https://${SITE}`,
      mode: "quick",
      trigger: "manual",
    });
    scans.push(scan.id);
    await driveScan(scan.id, { budgetMs: 90_000 });
    const { data: scanRow } = await supabaseAdmin
      .from("geo_scans")
      .select("id, status, origin, site")
      .eq("id", scan.id)
      .single();
    expect(scanRow!.status).toBe("succeeded");
    const { data: findings } = await supabaseAdmin
      .from("geo_findings")
      .select("id, rule_id, page_url, title, detail, evidence, severity, category, status")
      .eq("scan_id", scan.id);
    console.info(
      `[live] scan found ${findings!.length} finding(s): ${[...new Set(findings!.map((f) => f.rule_id))].join(", ")}`,
    );
    const finding =
      PREFERRED.map((id) => findings!.find((f) => f.rule_id === id)).find(Boolean) ??
      findings!.find(
        (f) =>
          strategyForRule(f.rule_id).mode === "agent" &&
          strategyForRule(f.rule_id).grounding !== "page_text_inputs",
      );
    expect(finding, "the scan should produce at least one agent-fixable finding").toBeTruthy();
    console.info(
      `[live] fixing ${finding!.rule_id} on ${finding!.page_url ?? scanRow!.origin}: ${finding!.detail}`,
    );

    /* 2. repository snapshot */
    const installations = (await appRequest<{ id: number }[]>("/app/installations")) ?? [];
    let installationId: string | null = null;
    for (const inst of installations) {
      if (await installationRequest(String(inst.id), `/repos/${REPO}`).catch(() => null)) {
        installationId = String(inst.id);
        break;
      }
    }
    expect(installationId, `the App can't read ${REPO}`).toBeTruthy();
    const repoInfo = await git.getRepository(installationId!, REPO);
    const branch = await git.getBranch(installationId!, REPO, repoInfo!.defaultBranch);
    const tree = await git.getTreeEntries(installationId!, REPO, branch!.treeSha);
    const pkgEntry = tree.entries.find((e) => e.path === "package.json");
    const pkg = pkgEntry
      ? JSON.parse((await git.readBlob(installationId!, REPO, pkgEntry.sha)) ?? "{}")
      : null;
    const { framework, evidence } = detectFramework(
      [...new Set(tree.entries.map((e) => e.path.split("/")[0]))],
      pkg,
    );
    const paths = tree.entries.map((e) => e.path);
    const dependencies = Object.keys({
      ...(pkg?.devDependencies ?? {}),
      ...(pkg?.dependencies ?? {}),
    });
    const playbook = playbookFor(framework, paths);
    console.info(
      `[live] ${REPO}@${branch!.name} ${branch!.sha.slice(0, 7)}: ${paths.length} files, ${framework} (${playbook.name})`,
    );

    const { data: pageRows } = await supabaseAdmin
      .from("geo_scan_pages")
      .select("url, final_url, state, status_code, analysis")
      .eq("scan_id", scan.id);
    type Row = {
      url: string;
      final_url: string | null;
      status_code: number | null;
      analysis: import("@/lib/geo/types").PageAnalysis | null;
    };
    const pages = ((pageRows ?? []) as unknown as Row[]).filter((r) => r.analysis);
    const siteText = pages.flatMap((r) =>
      [
        r.analysis!.title,
        r.analysis!.metaDescription,
        ...r.analysis!.headings.map((h) => h.text),
        r.analysis!.text.excerpt,
      ].filter((x): x is string => Boolean(x)),
    );
    const strategy = strategyForRule(finding!.rule_id);
    const target = planFixTarget({
      ruleId: finding!.rule_id,
      pageUrl: finding!.page_url,
      framework,
      paths,
    });

    const ctx = {
      runId: "live-test",
      workspaceId: ws!.id,
      userId: null,
      finding: {
        ruleId: finding!.rule_id,
        title: finding!.title,
        detail: finding!.detail,
        evidence: (finding!.evidence ?? {}) as Record<string, unknown>,
        pageUrl: finding!.page_url,
        severity: finding!.severity,
        category: finding!.category,
        recommendation: RULE_BY_ID.get(finding!.rule_id)?.recommendation ?? null,
      },
      siteOrigin: scanRow!.origin,
      site: scanRow!.site as unknown as import("@/lib/geo/types").SiteArtifacts,
      snapshot: {
        repo: REPO,
        branch: branch!.name,
        sha: branch!.sha,
        entries: tree.entries,
        truncated: tree.truncated,
        framework,
        frameworkEvidence: evidence,
      },
      playbook,
      strategy,
      fixKind: fixKindForRule(finding!.rule_id),
      recipe: null,
      targetHints: target.ok ? target.files.map((f) => f.path) : [],
      dependencies,
      allowedImports: allowedImportsFor(playbook, dependencies),
      siteText,
      inputs: {},
      feedback: null,
      previousPlan: null,
    };
    const events: string[] = [];
    const { fetchPublicText } = await import("@/server/safe-fetch");
    const deps = {
      toolDeps: {
        readBlob: (s: string) => git.readBlob(installationId!, REPO, s),
        fetchLive: async (url: string) => {
          const html = await fetchPublicText(url, {
            timeoutMs: 15_000,
            maxBytes: 1_500_000,
            onOverflow: "truncate",
          });
          return html ? { status: 200, html } : null;
        },
        pageFacts: async () =>
          pages.slice(0, 1).map((r) => ({
            url: r.analysis!.url,
            statusCode: r.status_code,
            title: r.analysis!.title,
            description: r.analysis!.metaDescription,
            canonical: r.analysis!.canonicals[0] ?? null,
            lang: r.analysis!.lang,
            h1: r.analysis!.headings.filter((h) => h.level === 1).map((h) => h.text),
            headings: r.analysis!.headings.slice(0, 20).map((h) => `h${h.level}: ${h.text}`),
            schemaTypes: r.analysis!.schema.types,
            wordCount: r.analysis!.text.words,
            excerpt: r.analysis!.text.excerpt,
            rendering: "http",
          })),
        ruleInfo: () =>
          JSON.stringify({
            rule: finding!.rule_id,
            recommendation: ctx.finding.recommendation,
            strategy,
            likelyFiles: ctx.targetHints,
          }),
      },
      onEvent: async (e: { stage: string; summary: string }) => {
        events.push(`${e.stage}: ${e.summary}`);
      },
      isCancelled: async () => false,
    };

    /* 3. investigate → plan (real model) */
    const state = newToolState();
    const planned = await agent.investigateAndPlan(ctx, deps, { state, budgetUsd: 0.8 });
    console.info(`[live] activity:\n   ${events.join("\n   ")}`);
    if (!planned.ok) throw new Error(`planning failed: ${planned.code} — ${planned.message}`);
    const plan = planned.plan;
    console.info(
      `[live] plan (${planned.usage.turns} turns, $${planned.usage.costUsd.toFixed(3)}, cache read ${planned.usage.cacheReadTokens} tok): feasible=${plan.feasible} strategy="${plan.strategy}" files=${plan.files.map((f) => `${f.action}:${f.path}`).join(", ")}\n   summary: ${plan.summary}${plan.notFixableReason ? `\n   not fixable: ${plan.notFixableReason}` : ""}`,
    );
    expect(planned.filesInspected.length).toBeGreaterThan(0);
    for (const f of plan.files.filter((x) => x.action === "update"))
      expect(state.filesRead.has(f.path), f.path).toBe(true);
    if (!plan.feasible || plan.needsInput.length) {
      console.info(
        "[live] the agent concluded the fix needs a person — no patch expected",
        plan.needsInput,
      );
      expect(plan.manualSteps.length + plan.needsInput.length).toBeGreaterThan(0);
      return;
    }

    /* 4. implement → review → validate (real model) */
    events.length = 0;
    const patched = await agent.implementPlan(ctx, plan, deps, {
      state: newToolState(),
      budgetUsd: 0.7,
    });
    console.info(`[live] implementation activity:\n   ${events.join("\n   ")}`);
    if (!patched.ok) {
      console.info(`[live] patch not accepted: ${patched.code} — ${patched.message}`);
      throw new Error(`implementation failed: ${patched.code}`);
    }
    console.info(
      `[live] patch (${patched.corrections} correction(s), $${patched.usage.costUsd.toFixed(3)}): ${patched.files.map((f) => `${f.path} +${f.additions}/-${f.deletions}`).join(", ")}\n   review: ${patched.review.verdict} — ${patched.review.summary}\n   checks: ${patched.validation.checks.map((c) => `${c.id}=${c.status}`).join(" ")}\n${patched.files
        .map((f) => f.diff)
        .join("\n")
        .slice(0, 3000)}`,
    );
    expect(patched.validation.ok).toBe(true);
    expect(patched.files.every((f) => plan.files.some((p) => p.path === f.path))).toBe(true);

    /* 5. optional real pull request, then cleanup */
    if (process.env.GEO_AGENT_LIVE_PR === "1") {
      const { proposalBranchName } = await import("@/server/connectors/github/paths");
      const head = proposalBranchName(finding!.rule_id, Math.random().toString(36).slice(2, 8));
      const { commitSha } = await git.commitToNewBranch({
        installationId: installationId!,
        repo: REPO,
        baseBranch: branch!.name,
        baseSha: branch!.sha,
        headBranch: head,
        message: `Mellox live test: ${finding!.rule_id} (closed automatically)`,
        files: patched.files.map((f) => ({ path: f.path, content: f.after })),
      });
      let pr: Awaited<ReturnType<typeof git.createPullRequest>> | null = null;
      try {
        pr = await git.createPullRequest({
          installationId: installationId!,
          repo: REPO,
          headBranch: head,
          baseBranch: branch!.name,
          title: `Mellox GEO Engineer live test — ${finding!.rule_id} (closes automatically)`,
          body: `Automated live test of the Mellox GEO coding agent.\n\n${patched.explanation}\n\nThis pull request is closed and its branch deleted by the test. Nothing is merged.`,
        });
        console.info(`[live] opened ${pr.url} (commit ${commitSha.slice(0, 7)})`);
        const after = await git.getBranch(installationId!, REPO, branch!.name);
        expect(after!.sha, "the base branch must not move").toBe(branch!.sha);
      } finally {
        if (pr) await git.closePullRequest(installationId!, REPO, pr.number);
        await git.deleteMelloxBranch(installationId!, REPO, head);
      }
      expect((await git.getPullRequest(installationId!, REPO, pr!.number))?.state).toBe("closed");
      expect(await git.getBranch(installationId!, REPO, head)).toBeNull();
    }
    console.info(`[live] done in ${Math.round((Date.now() - started) / 1000)}s`);
  }, 600_000);
});
