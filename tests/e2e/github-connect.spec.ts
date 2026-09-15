// Real-browser journey for Settings → Connections → Connect GitHub.
//
// The browser clicks the actual button and follows real redirects; the Mellox
// server runs its real connect path against the real Supabase database. Only
// GitHub itself is replaced by a local double (GITHUB_API_BASE_OVERRIDE, which
// the server ignores in production), because authorizing on github.com needs a
// real person's GitHub login.
//
// Run against the `e2e-github` dev server (.claude/launch.json, port 8082):
//   E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… npx playwright test --project=integration tests/e2e/github-connect.spec.ts
// The test user must be an admin or owner of their selected workspace. Rows it
// creates (installation 990000001, repository 990000101) are removed afterwards.
import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE_URL = process.env.E2E_GITHUB_BASE_URL ?? "http://localhost:8082";
const DOUBLE_PORT = Number(process.env.E2E_GITHUB_DOUBLE_PORT ?? 8787);
const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const INSTALLATION_ID = "990000001";
const REPO_ID = 990000101;
const ACCOUNT = "mellox-e2e";
const REPO = `${ACCOUNT}/site`;
const SITE = "https://mellox-e2e.example";

const admin = () =>
  createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

/* ───────────────────────── GitHub double ───────────────────────── */

let denyAuthorization = false;
const requests: string[] = [];

function githubDouble(): Server {
  const now = new Date().toISOString();
  const installation = {
    id: Number(INSTALLATION_ID),
    account: { login: ACCOUNT, type: "User", avatar_url: null },
    repository_selection: "selected",
    permissions: { metadata: "read", contents: "write", pull_requests: "write" },
    html_url: `https://github.com/settings/installations/${INSTALLATION_ID}`,
    created_at: now,
    updated_at: now,
    suspended_at: null,
  };
  const repository = {
    id: REPO_ID,
    name: "site",
    full_name: REPO,
    owner: { login: ACCOUNT },
    private: true,
    default_branch: "main",
    html_url: `https://github.com/${REPO}`,
    description: "E2E website",
    homepage: SITE,
    pushed_at: now,
    archived: false,
  };
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${DOUBLE_PORT}`);
    requests.push(`${req.method} ${url.pathname}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = url.pathname;
    if (path === "/login/oauth/authorize") {
      const back = new URL("/api/integrations/github/callback", BASE_URL);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (denyAuthorization) back.searchParams.set("error", "access_denied");
      else back.searchParams.set("code", "e2e-oauth-code");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (path === "/login/oauth/access_token") return json(200, { access_token: "e2e-user-token" });
    if (path === "/app") {
      return json(200, {
        slug: (process.env.GITHUB_APP_SLUG ?? "").trim(),
        client_id: (process.env.GITHUB_CLIENT_ID ?? "").trim(),
      });
    }
    if (path === "/user/installations") {
      return json(200, { total_count: 1, installations: [installation] });
    }
    if (path === `/app/installations/${INSTALLATION_ID}`) return json(200, installation);
    if (path === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
      return json(201, {
        token: "e2e-installation-token",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    }
    if (path === "/installation/repositories") {
      return json(200, { total_count: 1, repositories: [repository] });
    }
    if (path === `/repositories/${REPO_ID}` || path === `/repos/${REPO}`) {
      return json(200, repository);
    }
    if (path.startsWith(`/repos/${REPO}/branches/`)) {
      return json(200, {
        name: "main",
        commit: { sha: "e2e0sha", commit: { tree: { sha: "t1" } } },
      });
    }
    if (path.startsWith(`/repos/${REPO}/git/trees/`)) {
      return json(200, {
        truncated: false,
        tree: [
          { path: "package.json", type: "blob" },
          { path: "src/app/robots.ts", type: "blob" },
        ],
      });
    }
    if (path === `/repos/${REPO}/contents/package.json`) {
      return json(200, {
        encoding: "base64",
        size: 40,
        content: Buffer.from(JSON.stringify({ dependencies: { next: "16.0.0" } })).toString(
          "base64",
        ),
      });
    }
    return json(404, { message: "Not Found" });
  });
}

/* ───────────────────────── Helpers ───────────────────────── */

async function cleanUp() {
  const db = admin();
  await db.from("workspace_sources").delete().eq("external_id", String(REPO_ID));
  await db.from("workspace_connections").delete().eq("external_account_id", INSTALLATION_ID);
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function openConnections(page: Page) {
  await page.goto(`${BASE_URL}/app?settings=connections`);
  const github = page.getByRole("region", { name: "GitHub" });
  await expect(github).toBeVisible({ timeout: 60_000 });
  return github;
}

/* ───────────────────────── Journey ───────────────────────── */

test.describe("Connect GitHub (browser)", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let server: Server;

  test.beforeAll(async () => {
    server = githubDouble();
    await new Promise<void>((resolve) => server.listen(DOUBLE_PORT, "127.0.0.1", resolve));
    await cleanUp();
  });

  test.afterAll(async () => {
    await cleanUp();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("a cancelled authorization is shown with a way to retry", async ({ page }) => {
    denyAuthorization = true;
    await signIn(page);
    const github = await openConnections(page);
    await github.getByRole("button", { name: "Connect GitHub" }).click();

    await page.waitForURL(/\/integrations\/github\/callback/, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "GitHub authorization was cancelled" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to Connections" })).toBeVisible();
  });

  test("connect → callback → Connected → repository linked → GEO", async ({ page }) => {
    denyAuthorization = false;
    await signIn(page);
    const workspaceId = await page.evaluate(() => localStorage.getItem("workspace:selected"));
    expect(workspaceId, "the test user has a selected workspace").toBeTruthy();

    // 1. The real button.
    const github = await openConnections(page);
    await expect(github.getByText("Not connected")).toBeVisible();
    const connect = github.getByRole("button", { name: "Connect GitHub" });
    await expect(connect).toBeEnabled();
    const authorize = page.waitForRequest((r) => r.url().includes("/login/oauth/authorize"));
    await connect.click();
    const authorizeUrl = new URL((await authorize).url());
    expect(authorizeUrl.searchParams.get("state")).toMatch(/^[\w-]{32,}$/);
    expect(authorizeUrl.searchParams.get("client_id")).toBe(
      (process.env.GITHUB_CLIENT_ID ?? "").trim(),
    );

    // 2. GitHub returns to the callback page, which completes and confirms.
    await page.waitForURL(/\/integrations\/github\/callback/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "GitHub connected successfully" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(ACCOUNT, { exact: true })).toBeVisible();
    await expect(page.getByText("Installation active")).toBeVisible();

    // 3. Automatic return to Settings → Connections, reading the saved connection.
    await page.waitForURL((url) => url.pathname === "/app", { timeout: 30_000 });
    const back = page.getByRole("region", { name: "GitHub" });
    await expect(back.getByRole("status").getByText(`GitHub connected — ${ACCOUNT}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(back.getByText("Connected", { exact: true }).first()).toBeVisible();

    // 4. The database holds it for this workspace, and the state was used.
    const db = admin();
    const { data: connection } = await db
      .from("workspace_connections")
      .select("workspace_id, status, verification, account_login")
      .eq("external_account_id", INSTALLATION_ID)
      .single();
    expect(connection).toMatchObject({
      workspace_id: workspaceId,
      status: "active",
      verification: "oauth",
      account_login: ACCOUNT,
    });

    // 5. Survives a full reload.
    const reloaded = await openConnections(page);
    await expect(reloaded.getByText(ACCOUNT, { exact: true })).toBeVisible();
    await expect(reloaded.getByText("Not connected")).toHaveCount(0);

    // 6. Repository list → select → linked to the website.
    const addRepository = reloaded.getByRole("button", { name: "Add repository" });
    if (await addRepository.isVisible()) await addRepository.click();
    const row = reloaded.getByRole("listitem").filter({ hasText: REPO });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole("button", { name: "Connect" }).click();
    await expect(reloaded.getByText("Repository linked")).toBeVisible({ timeout: 60_000 });
    const { data: source } = await db
      .from("workspace_sources")
      .select("workspace_id, full_name, site_url, status")
      .eq("external_id", String(REPO_ID))
      .single();
    expect(source).toMatchObject({ workspace_id: workspaceId, full_name: REPO, status: "active" });
    expect(source?.site_url).toContain("mellox-e2e.example");

    // 7. Still linked after another reload.
    const again = await openConnections(page);
    await expect(again.getByText("Repository linked")).toBeVisible({ timeout: 60_000 });

    // 8. The GEO return link opens AI Visibility on Findings.
    await page.goto(`${BASE_URL}/app?geo=findings`);
    await expect(page.getByRole("dialog", { name: /AI Visibility/ })).toBeVisible({
      timeout: 60_000,
    });
    expect(requests).toContain("GET /user/installations");
  });
});
