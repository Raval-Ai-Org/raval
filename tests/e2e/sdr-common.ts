// sdr-common.ts — shared helpers for the SDR e2e specs (T023/T035/T047/T057/T064).
// Injects a fake Supabase session (no real login — mirrors the existing
// integration specs) and intercepts the /api/sdr/* proxy routes with
// deterministic MockSDR-shaped responses, so the specs run WITHOUT a live SDR.
import { test, expect, type Page, type Route, type BrowserContext } from "@playwright/test";

export const SUPABASE_HOST = "smdravaoaeqdajmnrlpr.supabase.co";
// Supabase stores the session under sb-<project-ref>-auth-token (the ref, not
// the full host). Must match the project the dev server loads from .env
// (SUPABASE_URL / VITE_SUPABASE_URL → smdravaoaeqdajmnrlpr).
export const STORAGE_KEY = "sb-smdravaoaeqdajmnrlpr-auth-token";
export const WS_ID = "00000000-0000-0000-0000-000000000001";

function fakeSession() {
  return {
    access_token: "fake",
    refresh_token: "fake",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "00000000-0000-0000-0000-000000000002", email: "t@e.com", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {} },
  };
}

/** Inject the fake session + set the selected workspace. */
export async function loginAsTestUser(page: Page) {
  await page.addInitScript(
    ([key, session, ws]) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("workspace:selected", ws);
      localStorage.setItem("workspace:name", "Test Workspace");
    },
    [STORAGE_KEY, fakeSession(), WS_ID] as const,
  );
}

export const SDR_ACCOUNTS = [
  { account_id: "tw-1", workspace_id: WS_ID, platform: "twitter", platform_username: "Brand X", status: "active", token_expires_at: null },
  { account_id: "li-1", workspace_id: WS_ID, platform: "linkedin", platform_username: "Brand LI", status: "active", token_expires_at: null },
];

export const SDR_PUBLISH_RESPONSE = {
  job_id: "job-e2e-1",
  workspace_id: WS_ID,
  idempotency_key: "publish:e2e",
  status: "publishing",
  targets: [
    { target_id: "t-tw", account_id: "tw-1", platform: "twitter", status: "publishing" },
    { target_id: "t-li", account_id: "li-1", platform: "linkedin", status: "publishing" },
  ],
};

/** Stub the Supabase auth/rest/realtime + server-fn routes so the app shell
 * renders with the fake session (mirrors the integration-spec pattern). */
export async function mockSupabase(context: BrowserContext) {
  const JSON_HEADERS = { "content-type": "application/json" };
  const user = fakeSession().user;
  await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
    if (url.includes("/auth/v1/user")) {
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(user) });
    }
    if (url.includes("/auth/v1/token")) {
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession()) });
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
}

/** Intercept /api/sdr/* with deterministic MockSDR responses. */
export function mockSdrRoutes(page: Page) {
  return page.route("**/api/sdr/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/sdr/accounts") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SDR_ACCOUNTS) });
    }
    if (path === "/api/sdr/oauth/start") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorizationUrl: "https://mock-oauth/start", stateToken: "st", expiresIn: 600 }) });
    }
    if (path === "/api/sdr/publish") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ contentItemId: "item-e2e", status: "publishing", sdrJobId: "job-e2e-1", targets: 2 }] }) });
    }
    if (path === "/api/sdr/schedule") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ contentItemId: "item-e2e", status: "publishing", sdrJobId: "job-e2e-1", targets: 2, scheduledAt: "2026-08-10T09:00:00.000Z" }] }) });
    }
    if (path === "/api/sdr/cancel") {
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/sdr/disconnect") {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND" } }) });
  });
}

/** Open the Studio rail by dispatching the app's own toggle:studio event. */
export async function openStudio(page: Page) {
  await page.goto("/app");
  await page.waitForTimeout(1500); // let the shell render + hydrate
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("toggle:studio")));
  await page.waitForTimeout(700); // let the rail animate open
}
