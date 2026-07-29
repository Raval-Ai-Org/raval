import { test, expect, type Route, type Page, type BrowserContext } from "@playwright/test";

/**
 * Verifies that deep-link query parameters persist the intended state
 * (Studio canvas selection, Analytics tab filter, chat prefill) across
 * navigation and full page refresh.
 *
 * State classes covered:
 *   ?canvas=<type>&artifact=<id> on /app  — Studio canvas modal
 *   ?tab=<analytics-tab>          on /app  — Analytics modal filter
 *   /app/analytics?tab=<t>                 — legacy route → redirect bridge
 *   chat:prefill event                     — composer state (NOT URL-persisted)
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const JSON_HEADERS = { "content-type": "application/json" };

function fakeSession() {
  return {
    access_token: "fake",
    refresh_token: "fake",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID, email: "t@e.com", aud: "authenticated", role: "authenticated",
      app_metadata: { provider: "email" }, user_metadata: {},
    },
  };
}

async function stubSupabase(context: BrowserContext) {
  await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
    if (url.includes("/auth/v1/user"))
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession().user) });
    if (url.includes("/auth/v1/token"))
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession()) });
    if (url.includes("/rest/v1/workspaces")) {
      const row = {
        id: WS_ID, name: "Test", website_url: null, industry: null,
        onboarded_at: "2024-01-01T00:00:00Z", first_prompt: null,
      };
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(wantsSingle ? row : [row]) });
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: wantsSingle ? "null" : "[]" });
  });
  await context.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );
}

async function seed(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        window.localStorage.removeItem("studio:suggest-dismissed");
        window.localStorage.removeItem(`studio:suggestions:${wsId}`);
        // @ts-expect-error WS stub
        window.WebSocket = function () {
          return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
        };
      } catch { /* noop */ }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

async function freshLoad(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => !!window.localStorage.getItem("workspace:name") && !!document.querySelector("textarea"),
    null,
    { timeout: 15_000 },
  );
}

function currentSearch(page: Page) {
  return page.evaluate(() => window.location.search);
}

test.describe("Deep-link query param persistence", () => {
  test.beforeEach(async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
  });

  test("?canvas=<type>&artifact=<id> — hydrates modal on fresh load and survives refresh", async ({ page }) => {
    await freshLoad(page, "/app?canvas=seo-brief&artifact=abc-123");

    // Canvas modal should be open on the requested tile after cold load.
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText(/SEO Brief/i);

    // Params preserved verbatim in the URL.
    expect(await currentSearch(page)).toMatch(/canvas=seo-brief/);
    expect(await currentSearch(page)).toMatch(/artifact=abc-123/);

    // Refresh: URL + modal must persist.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 8_000 });
    expect(await currentSearch(page)).toMatch(/canvas=seo-brief/);
    expect(await currentSearch(page)).toMatch(/artifact=abc-123/);
  });

  test("?canvas — dispatching open:canvas writes URL, closing strips both keys", async ({ page }) => {
    await freshLoad(page, "/app");
    expect(await currentSearch(page)).toBe("");

    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type: "landing-page", id: "lp-42" } })),
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForFunction(() => /canvas=landing-page/.test(window.location.search));
    expect(await currentSearch(page)).toMatch(/artifact=lp-42/);

    // Escape → close → URL is cleared of both params.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.waitForFunction(
      () => !/canvas=/.test(window.location.search) && !/artifact=/.test(window.location.search),
    );
  });

  test("/app?tab=<t> — hydrates Analytics modal on the requested tab across refresh", async ({ page }) => {
    await freshLoad(page, "/app?tab=organic");

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // Each tab has a unique blurb rendered under the tab strip; use that to
    // confirm the active selection (tabs are plain buttons without aria-selected).
    await expect(modal).toContainText(/How people find you on Google/i);
    expect(await currentSearch(page)).toMatch(/tab=organic/);

    // Switch to Social — URL should update to match.
    await modal.getByRole("button", { name: /^Social$/ }).click();
    await page.waitForFunction(() => /tab=social/.test(window.location.search));
    await expect(modal).toContainText(/Posts, reach, and what/i);

    // Refresh should reopen on Social.
    await page.reload({ waitUntil: "domcontentloaded" });
    const modal2 = page.getByRole("dialog");
    await expect(modal2).toBeVisible({ timeout: 8_000 });
    await expect(modal2).toContainText(/Posts, reach, and what/i);
    expect(await currentSearch(page)).toMatch(/tab=social/);
  });

  test("Analytics modal — closing strips ?tab so refresh does not reopen it", async ({ page }) => {
    await freshLoad(page, "/app?tab=content");
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForFunction(() => !/tab=/.test(window.location.search));

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("/app/analytics?tab=<t> — legacy route redirects and opens on the requested tab", async ({ page }) => {
    await page.goto("/app/analytics?tab=audience", { waitUntil: "domcontentloaded" });
    // Router bounces us to /app; then the shell + modal hydrate.
    await page.waitForFunction(() => window.location.pathname === "/app", null, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await expect(modal).toContainText(/Who's visiting and where from/i);
    expect(await currentSearch(page)).toMatch(/tab=audience/);
  });

  test("Invalid ?canvas / ?tab values are ignored (no crash, no modal)", async ({ page }) => {
    await freshLoad(page, "/app?canvas=not-a-real-tile&tab=not-a-real-tab");
    // Neither modal should open.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("chat:prefill fills the composer but is NOT URL-persisted", async ({ page }) => {
    await freshLoad(page, "/app");
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("chat:prefill", { detail: { text: "hello world" } })),
    );
    const composer = page.locator("textarea").first();
    await expect(composer).toHaveValue(/hello world/, { timeout: 5_000 });

    // URL is intentionally clean — prefill is transient composer state.
    expect(await currentSearch(page)).toBe("");
  });
});

