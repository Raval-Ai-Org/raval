import { test, expect, type Route, type Page, type BrowserContext } from "@playwright/test";

/**
 * Expired-session deep-link tests.
 *
 * A user opens an authenticated route (`/app`, `/app/analytics`) with a
 * stale/expired session in storage. The refresh call fails, so:
 *
 *   1. The app forces the user to `/login`, preserving the original
 *      target as `?next=<path>`.
 *   2. After a successful sign-in, the login page redirects to `next`,
 *      not the default `/projects` fallback.
 *
 * This is the contract that lets a suggestion, notification, or
 * shared deep-link survive a re-auth without silently dumping the
 * user on the wrong page.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const JSON_HEADERS = { "content-type": "application/json" };

function freshSession() {
  return {
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID,
      email: "t@e.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

function expiredSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "expired-access",
    refresh_token: "expired-refresh",
    token_type: "bearer",
    // supabase-js checks expires_at against now — negative delta forces a
    // refresh attempt on the very first getSession() call.
    expires_in: -3600,
    expires_at: now - 3600,
    user: freshSession().user,
  };
}

async function stubSupabase(context: BrowserContext) {
  // Track whether the user has "signed in" via password grant. Before that,
  // /auth/v1/token (refresh grant) returns 401 so getSession() clears the
  // expired session. After password sign-in, subsequent refreshes succeed.
  const state = { signedIn: false };

  await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");

    if (url.includes("/auth/v1/token")) {
      const grant = new URL(url).searchParams.get("grant_type");
      if (grant === "password") {
        state.signedIn = true;
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(freshSession()) });
      }
      // Refresh grant (or anything else) — succeed once the user has signed
      // in, fail otherwise so the initial expired session gets cleared.
      if (state.signedIn) {
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(freshSession()) });
      }
      return route.fulfill({
        status: 401,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "invalid_grant", error_description: "Refresh token expired" }),
      });
    }

    if (url.includes("/auth/v1/user")) {
      if (state.signedIn) return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(freshSession().user) });
      return route.fulfill({ status: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "invalid_token" }) });
    }

    if (url.includes("/rest/v1/workspaces")) {
      const row = { id: WS_ID, name: "Test", website_url: null, industry: null, onboarded_at: "2024-01-01T00:00:00Z", first_prompt: null };
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(wantsSingle ? row : [row]) });
    }

    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: wantsSingle ? "null" : "[]" });
  });

  await context.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );

  return state;
}

async function seedExpired(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        // @ts-expect-error test stub
        window.WebSocket = function () {
          return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
        };
      } catch { /* noop */ }
    },
    { storageKey: STORAGE_KEY, sess: expiredSession(), wsId: WS_ID },
  );
}

async function signIn(page: Page) {
  const email = page.getByPlaceholder("Email");
  const password = page.getByPlaceholder("Password");
  const submit = page.getByRole("button", { name: /^Sign in$/ });
  await expect(email).toBeVisible();
  // Focus + type character-by-character so React's controlled onChange
  // fires per keystroke — plain `.fill()` can race the hydration re-render
  // that briefly resets useState back to "".
  await email.click();
  await email.pressSequentially("t@e.com", { delay: 10 });
  await password.click();
  await password.pressSequentially("hunter2", { delay: 10 });
  await expect(email).toHaveValue("t@e.com");
  await expect(password).toHaveValue("hunter2");
  await submit.click();
}

test.describe("Expired session deep-link recovery", () => {
  test("/app → /login?next=/app → back to /app after sign-in", async ({ context, page }) => {
    await stubSupabase(context);
    await seedExpired(page);

    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // 1. App forces sign-in and preserves the target.
    await page.waitForURL(/\/login\?.*next=%2Fapp/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();

    // 2. Sign in → land back on the original target.
    await signIn(page);
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 15_000 });
    // Confirm the app shell actually mounted (not a bare redirect loop).
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
  });

  test("session cleared mid-session on /app forces /login?next=/app and returns after sign-in", async ({ context, page }) => {
    // Different failure mode: the user is already signed in and on /app,
    // then their session is invalidated (server-side logout, expiring
    // refresh token, another tab signing out). AppShell's
    // onAuthStateChange listener must send them to /login with the
    // current path preserved, and sign-in must land them back on /app.
    await stubSupabase(context);

    // Seed a fresh, non-expired session so the initial /app load succeeds.
    await page.addInitScript(
      ({ storageKey, sess, wsId }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sess));
          window.localStorage.setItem("workspace:selected", wsId);
          window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
          // @ts-expect-error test stub
          window.WebSocket = function () {
            return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
          };
        } catch { /* noop */ }
      },
      { storageKey: STORAGE_KEY, sess: freshSession(), wsId: WS_ID },
    );

    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });

    // Simulate the session going away (e.g. another tab signed out).
    await page.evaluate(async () => {
      const mod = await import("/src/integrations/supabase/client.ts");
      await (mod as unknown as { supabase: { auth: { signOut(): Promise<unknown> } } }).supabase.auth.signOut();
    });

    await page.waitForURL(/\/login\?.*next=%2Fapp/, { timeout: 15_000 });
    await signIn(page);
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
  });

});
