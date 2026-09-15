// Live check of repository ↔ website ownership against the real GitHub App
// installation (reads .env). Read-only: no database writes, no repository writes.
//
//   GEO_AGENT_LIVE_REPO   owner/repo that is expected to build GEO_AGENT_LIVE_SITE
//   GEO_AGENT_LIVE_SITE   host of the live site (e.g. threereach.lovable.app)
//   GEO_OWNERSHIP_NEGATIVE_REPO / _SITE   a pair that must NOT be verified
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/geo-ownership.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suites skip below.
}

const hasGitHub = !!process.env.GITHUB_APP_ID && !!process.env.GITHUB_APP_PRIVATE_KEY;
const repo = process.env.GEO_AGENT_LIVE_REPO ?? "ZainIqbal-01/threereach";
const site = process.env.GEO_AGENT_LIVE_SITE ?? "threereach.lovable.app";
const negativeRepo = process.env.GEO_OWNERSHIP_NEGATIVE_REPO ?? "ZainIqbal-01/SnapProveWebsite";
const negativeSite = process.env.GEO_OWNERSHIP_NEGATIVE_SITE ?? "failory.com";

async function installationFor(fullName: string): Promise<string | null> {
  const { appRequest, installationRequest } = await import("@/server/connectors/github/api.server");
  const installations = (await appRequest<{ id: number }[]>("/app/installations")) ?? [];
  for (const inst of installations) {
    const r = await installationRequest<{ id: number }>(
      String(inst.id),
      `/repos/${fullName}`,
    ).catch(() => null);
    if (r) return String(inst.id);
  }
  return null;
}

async function livePages(host: string) {
  const { fetchPublicText } = await import("@/server/safe-fetch");
  const { analyzePage } = await import("@/lib/geo/analyze-page");
  const { pageFingerprintInput } = await import("@/server/connectors/github/ownership.server");
  const url = `https://${host}/`;
  const html = await fetchPublicText(url, {
    timeoutMs: 20_000,
    maxBytes: 2_000_000,
    onOverflow: "truncate",
  });
  return html ? [pageFingerprintInput(analyzePage(html, url))] : [];
}

(hasGitHub ? describe : describe.skip)("repository ownership (live GitHub)", () => {
  it("collects evidence for the configured repository and site", async () => {
    const { collectOwnershipEvidence } =
      await import("@/server/connectors/github/ownership.server");
    const { getRepository } = await import("@/server/connectors/github/git.server");
    const installationId = await installationFor(repo);
    expect(installationId, `the App can't read ${repo}`).toBeTruthy();
    const info = await getRepository(installationId!, repo);
    const pages = await livePages(site);
    console.info(
      `[live] ${site}: ${pages.length} page(s) fetched, title=${pages[0]?.title ?? "-"}`,
    );
    const result = await collectOwnershipEvidence({
      installationId: installationId!,
      repo,
      branch: info!.defaultBranch,
      siteHost: site,
      pages,
    });
    console.info(
      `[live] ${repo} ↔ ${site}: ${result.status} (${result.confidence})\n` +
        result.evidence
          .map(
            (e) =>
              `   ${e.polarity === "negative" ? "−" : e.polarity === "positive" ? "+" : "·"} ${e.signal} ${e.weight}: ${e.detail}`,
          )
          .join("\n"),
    );
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(["verified", "likely", "unverified", "mismatch"]).toContain(result.status);
  }, 240_000);

  it("does not verify a repository against a website it doesn't build", async () => {
    const { collectOwnershipEvidence } =
      await import("@/server/connectors/github/ownership.server");
    const { getRepository } = await import("@/server/connectors/github/git.server");
    const installationId = await installationFor(negativeRepo);
    if (!installationId) return;
    const info = await getRepository(installationId, negativeRepo);
    const result = await collectOwnershipEvidence({
      installationId,
      repo: negativeRepo,
      branch: info!.defaultBranch,
      siteHost: negativeSite,
      pages: await livePages(negativeSite),
    });
    console.info(
      `[live] ${negativeRepo} ↔ ${negativeSite}: ${result.status} (${result.confidence})`,
    );
    expect(result.status).not.toBe("verified");
    expect(result.status).not.toBe("likely");
  }, 240_000);
});
