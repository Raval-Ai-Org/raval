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
    user: {
      id: "00000000-0000-0000-0000-000000000002",
      email: "t@e.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
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
  {
    account_id: "tw-1",
    workspace_id: WS_ID,
    platform: "twitter",
    platform_username: "Brand X",
    status: "active",
    token_expires_at: null,
  },
  {
    account_id: "li-1",
    workspace_id: WS_ID,
    platform: "linkedin",
    platform_username: "Brand LI",
    status: "active",
    token_expires_at: null,
  },
];

/** The shape the /api/sdr/accounts SERVER route returns to the UI (camelCase,
 * tokens excluded). The raw SDR rows above are what the SDR returns; the proxy
 * maps account_id→accountId and platform_username→platformUsername (sdr.handlers
 * mapAccount). The e2e mock must return THIS mapped shape. */
export const SDR_CONNECTED_ACCOUNTS = [
  {
    accountId: "tw-1",
    platform: "twitter",
    platformUsername: "Brand X",
    status: "active",
    tokenExpiresAt: null,
  },
  {
    accountId: "li-1",
    platform: "linkedin",
    platformUsername: "Brand LI",
    status: "active",
    tokenExpiresAt: null,
  },
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

/** The webhook-fed delivery mirror for a published item (US4 / FR-010). */
export const SDR_PUBLICATIONS = [
  {
    id: "pub-li",
    platform: "linkedin",
    account_id: "li-1",
    status: "published",
    platform_post_url: "https://linkedin.com/posts/1",
    platform_post_id: "post-li",
    error_category: null,
    last_error: null,
    delivered_at: "2026-08-09T10:00:00.000Z",
  },
  {
    id: "pub-tw",
    platform: "twitter",
    account_id: "tw-1",
    status: "failed",
    platform_post_url: null,
    platform_post_id: null,
    error_category: "fatal",
    last_error: "Duplicate content",
    delivered_at: null,
  },
];

/** Stub the Supabase auth/rest/realtime + server-fn routes so the app shell
 * renders with the fake session (mirrors the integration-spec pattern). */
export async function mockSupabase(context: BrowserContext) {
  const JSON_HEADERS = { "content-type": "application/json" };
  const user = fakeSession().user;
  await context.route(
    new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`),
    async (route: Route) => {
      const req = route.request();
      const url = req.url();
      const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
      if (url.includes("/auth/v1/user")) {
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(user) });
      }
      if (url.includes("/auth/v1/token")) {
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(fakeSession()),
        });
      }
      if (url.includes("/rest/v1/workspaces")) {
        const row = {
          id: WS_ID,
          name: "Test",
          website_url: null,
          industry: null,
          onboarded_at: "2024-01-01T00:00:00Z",
          first_prompt: null,
        };
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(wantsSingle ? row : [row]),
        });
      }
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: wantsSingle ? "null" : "[]",
      });
    },
  );
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
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SDR_CONNECTED_ACCOUNTS),
      });
    }
    if (path === "/api/sdr/oauth/start") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authorizationUrl: "https://mock-oauth/start",
          stateToken: "st",
          expiresIn: 600,
        }),
      });
    }
    if (path === "/api/sdr/publish") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            { contentItemId: "item-e2e", status: "publishing", sdrJobId: "job-e2e-1", targets: 2 },
          ],
        }),
      });
    }
    if (path === "/api/sdr/schedule") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              contentItemId: "item-e2e",
              status: "publishing",
              sdrJobId: "job-e2e-1",
              targets: 2,
              scheduledAt: "2026-08-10T09:00:00.000Z",
            },
          ],
        }),
      });
    }
    if (path === "/api/sdr/cancel") {
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/sdr/disconnect") {
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/sdr/publications") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SDR_PUBLICATIONS),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "NOT_FOUND" } }),
    });
  });
}

/** Open the Studio rail by dispatching the app's own toggle:studio event.
 * Waits for the shell's "Open Studio" button first — that proves the app has
 * hydrated and the toggle:studio listener is mounted (a blind timeout races
 * the listener mount and the dispatch is silently lost). */
export async function openStudio(page: Page) {
  await page.goto("/app");
  const studioButton = page.getByRole("button", { name: /(?:Open )?Studio/ }).first();
  await expect(studioButton).toBeVisible({ timeout: 30000 });
  await studioButton.click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible({ timeout: 15000 });
}

export async function openCanvas(page: Page, detail: { type: string; id?: string; mode?: string }) {
  await page.evaluate((canvasDetail) => {
    window.dispatchEvent(new CustomEvent("open:canvas", { detail: canvasDetail }));
  }, detail);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("canvas"), { timeout: 5000 })
    .toBe(detail.type);
  if (detail.mode === "view") {
    await expect(page.getByText("Delivery").first()).toBeVisible({ timeout: 15000 });
  } else {
    await expect(page.getByText("Publish to").first()).toBeVisible({ timeout: 15000 });
  }
}
