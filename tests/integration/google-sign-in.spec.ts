import { test, expect, type Page } from "@playwright/test";
import { SUPABASE_HOST, STORAGE_KEY } from "../fixtures/supabase-ref";

const USER_ID = "00000000-0000-0000-0000-000000000002";
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: USER_ID, exp, aud: "authenticated" })}.fake-signature`,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: USER_ID,
      email: "gis@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: "GIS Tester" },
    },
  };
}

async function mockAuth(page: Page, rejectFirst = false) {
  const authSession = session();
  const state = { exchanges: [] as Record<string, string>[], workspaceCalls: 0, authorizeCalls: 0 };
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.__gisAttempts = [];
      window.google = { accounts: { id: {
        initialize(options) { window.__gisOptions = options; window.__gisAttempts.push(options); },
        renderButton(host) {
          const options = window.__gisOptions;
          const button = document.createElement('button');
          button.textContent = 'Continue with Google';
          button.onclick = () => {
            options.callback({ credential: 'test-google-id-token' });
            options.callback({ credential: 'test-google-id-token' });
          };
          host.appendChild(button);
        }
      } } };`,
    }),
  );
  await page.route(`https://${SUPABASE_HOST}/auth/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/authorize")) state.authorizeCalls++;
    if (url.pathname.endsWith("/token")) {
      const body = request.postDataJSON();
      if (url.searchParams.get("grant_type") === "id_token") {
        state.exchanges.push(body);
        if (rejectFirst && state.exchanges.length === 1)
          return route.fulfill({
            status: 400,
            json: { code: "bad_jwt", message: "Invalid nonce: private-provider-details" },
          });
      }
      return route.fulfill({ json: authSession });
    }
    if (url.pathname.endsWith("/signup"))
      return route.fulfill({ json: { user: authSession.user, session: null } });
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ json: authSession.user });
  });
  await page.route("**/api/rpc/workspaces/ensureAuthWorkspace", async (route) => {
    state.workspaceCalls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${authSession.access_token}`);
    return route.fulfill({ json: { result: null } });
  });
  return state;
}

for (const path of ["/login", "/signup"]) {
  test(`${path}: GIS exchange persists cookies, consumes callback once, sets up workspace and preserves next`, async ({
    page,
    context,
  }) => {
    const state = await mockAuth(page);
    await page.goto(`${path}?next=${encodeURIComponent("/privacy?gis=success")}`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/privacy\?gis=success$/);
    expect(state.exchanges).toHaveLength(1);
    expect(state.exchanges[0]).toMatchObject({
      provider: "google",
      id_token: "test-google-id-token",
    });
    const nonce = state.exchanges[0].nonce;
    expect(nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(state.workspaceCalls).toBe(1);
    expect(state.authorizeCalls).toBe(0);
    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name.startsWith(STORAGE_KEY))).toBe(true);
    await page.reload();
    expect((await context.cookies()).some((cookie) => cookie.name.startsWith(STORAGE_KEY))).toBe(
      true,
    );
    expect(page.url()).not.toContain("supabase.co");
  });

  test(`${path}: rejected token stays on Mellox and retries with a fresh matching nonce`, async ({
    page,
  }) => {
    const state = await mockAuth(page, true);
    await page.goto(`${path}?next=${encodeURIComponent("/privacy?gis=retry")}`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByText("Google sign-in failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(page.url()).toContain(path);
    expect(state.workspaceCalls).toBe(0);
    expect(await page.content()).not.toContain("private-provider-details");
    const hashedNonce = await page.evaluate(
      () => (window as unknown as { __gisOptions: { nonce: string } }).__gisOptions.nonce,
    );
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/privacy\?gis=retry$/);
    expect(state.exchanges).toHaveLength(2);
    expect(state.exchanges[0].nonce).not.toBe(state.exchanges[1].nonce);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(state.exchanges[1].nonce),
    );
    expect(Buffer.from(digest).toString("hex")).toBe(hashedNonce);
  });
}

test("blocked GIS script can retry while email login remains usable", async ({ page }) => {
  await mockAuth(page);
  await page.route("https://accounts.google.com/gsi/client", (route) => route.abort());
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await page.getByPlaceholder("Email", { exact: true }).fill("gis@example.com");
  await page.getByPlaceholder("Password", { exact: true }).fill("test-password");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.unroute("https://accounts.google.com/gsi/client");
  await mockAuth(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("email signup still sends confirmation instead of Google authentication", async ({ page }) => {
  const state = await mockAuth(page);
  await page.goto("/signup");
  await page.getByPlaceholder("Name", { exact: true }).fill("Email Tester");
  await page.getByPlaceholder("Email", { exact: true }).fill("email@example.com");
  await page
    .getByPlaceholder("Password (8+ characters)", { exact: true })
    .fill("safe-test-password");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.getByText("Check your email to confirm", { exact: true })).toBeVisible();
  expect(state.exchanges).toHaveLength(0);
  expect(state.workspaceCalls).toBe(0);
});

test("email login still persists a session and preserves its destination", async ({
  page,
  context,
}) => {
  const state = await mockAuth(page);
  await page.goto(`/login?next=${encodeURIComponent("/privacy?email=success")}`);
  await page.getByPlaceholder("Email", { exact: true }).fill("email@example.com");
  await page.getByPlaceholder("Password", { exact: true }).fill("safe-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy\?email=success$/);
  expect(state.exchanges).toHaveLength(0);
  expect(state.workspaceCalls).toBe(1);
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith(STORAGE_KEY))).toBe(
    true,
  );
});

test("legacy existing session remains signed in without a Google token exchange", async ({
  page,
  context,
}) => {
  const state = await mockAuth(page);
  await page.addInitScript(
    ({ key, data }) => {
      window.localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: session() },
  );
  await page.goto(`/login?next=${encodeURIComponent("/privacy?existing=session")}`);
  await expect(page).toHaveURL(/\/privacy\?existing=session$/);
  expect(state.exchanges).toHaveLength(0);
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith(STORAGE_KEY))).toBe(
    true,
  );
});

test("missing credential never reaches Supabase and leaves sign-in retryable", async ({ page }) => {
  const state = await mockAuth(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.evaluate(() => {
    const options = (window as unknown as { __gisOptions: { callback: (value: object) => void } })
      .__gisOptions;
    options.callback({});
  });
  await expect(page.getByText("Google sign-in failed", { exact: true })).toBeVisible();
  expect(state.exchanges).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("an expired attempt is rejected locally and rerendered with a fresh nonce", async ({
  page,
}) => {
  const state = await mockAuth(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.now() + 11 * 60 * 1000));
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByText("That Google sign-in attempt expired. Please try again.", { exact: true }),
  ).toBeVisible();
  expect(state.exchanges).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("credentials from an unmounted login button are ignored after switching to signup", async ({
  page,
}) => {
  const state = await mockAuth(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.evaluate(() => {
    const attempts = (
      window as unknown as { __gisAttempts: { callback: (value: object) => void }[] }
    ).__gisAttempts;
    attempts[0].callback({ credential: "stale-credential" });
  });
  expect(state.exchanges).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});
