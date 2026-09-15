// Live check of the GitHub connector against the real GitHub App and the real
// Supabase project (reads .env). Read-only on GitHub: no installation,
// repository or pull request is created or changed. Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/github-app.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.GITHUB_APP_ID && process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

describeLive("GitHub App connector (live)", () => {
  it("reports only safe production diagnostic statuses", async () => {
    const { diagnoseGitHub } = await import("@/server/connectors/github/api.server");
    const diagnostic = await diagnoseGitHub();
    expect(Object.values(diagnostic).every((value) => typeof value === "boolean")).toBe(true);
    console.info(`[live] github diagnostic ${JSON.stringify(diagnostic)}`);
  });

  it("loads a valid App configuration from the environment", async () => {
    const { getGitHubConfigCheck } = await import("@/server/connectors/github/config.server");
    const check = getGitHubConfigCheck();
    expect(check.ok, check.issues.join("; ")).toBe(true);
    if (check.ok) {
      expect(check.config.privateKey.asymmetricKeyType).toBe("rsa");
      console.info(
        `[live] install verification: ${check.config.installVerification}; notes: ${check.issues.join(" | ") || "none"}`,
      );
    }
  });

  it("authenticates as the App and reads its permissions", async () => {
    const { appRequest } = await import("@/server/connectors/github/api.server");
    const app = await appRequest<{ slug: string; permissions: Record<string, string> }>("/app");
    expect(app?.slug).toBe(process.env.GITHUB_APP_SLUG);
    // The App must not ask for more than the connection + pull-request workflow needs
    // (checks / statuses are optional, read-only, for CI status on fix PRs).
    const allowed = new Set(["metadata", "contents", "pull_requests", "checks", "statuses"]);
    const extra = Object.keys(app?.permissions ?? {}).filter((k) => !allowed.has(k));
    expect(extra, `unexpected permissions: ${extra.join(", ")}`).toEqual([]);
    console.info(`[live] app ${app?.slug} permissions ${JSON.stringify(app?.permissions)}`);
  });

  it("mints an installation token and lists repositories for each linked installation (if any)", async () => {
    const [{ appRequest, installationRequest }] = await Promise.all([
      import("@/server/connectors/github/api.server"),
    ]);
    const installations =
      (await appRequest<{ id: number; account: { login: string } }[]>("/app/installations")) ?? [];
    console.info(`[live] installations: ${installations.length}`);
    for (const installation of installations.slice(0, 3)) {
      const repos = await installationRequest<{ total_count: number }>(
        String(installation.id),
        "/installation/repositories?per_page=1",
      );
      expect(typeof repos?.total_count).toBe("number");
      console.info(
        `[live] ${installation.account.login}: ${repos?.total_count} repositories accessible`,
      );
    }
  });

  it("treats an unknown installation as revoked, not as a server error", async () => {
    const { installationRequest, GitHubAccessError } =
      await import("@/server/connectors/github/api.server");
    await expect(installationRequest("1", "/installation/repositories")).rejects.toBeInstanceOf(
      GitHubAccessError,
    );
  });

  it("has the connector tables with row-level security reachable by the service role", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const table of [
      "workspace_connections",
      "workspace_sources",
      "connector_install_states",
    ] as const) {
      const { error } = await supabaseAdmin
        .from(table)
        .select("id", { head: true, count: "exact" });
      expect(error, `${table}: ${error?.message}`).toBeNull();
    }
  });
});
