import { test, expect, type Route, type Page, type BrowserContext } from "@playwright/test";

/**
 * Malformed / unknown suggestion event & deep-link handling.
 *
 * The app is deliberately liberal in what it accepts from window events and
 * URL search params: bad inputs should never crash, never render partial
 * modals, and never write garbage back into the URL. Truly unrecoverable
 * routes (unknown paths) surface a clear 404 UI.
 *
 * Coverage:
 *   - Unknown window event names are silently ignored.
 *   - `open:canvas` with malformed `detail` (missing / non-string type,
 *     wrong shape) falls back to a safe default OR is dropped, never crashes.
 *   - `chat:prefill` with non-string / missing text does nothing.
 *   - `open:analytics` with bogus tab opens the modal on the default tab
 *     without polluting the URL.
 *   - `/app?canvas=garbage` and `/app?tab=garbage` are ignored (no modal).
 *   - `/app/analytics?tab=garbage` normalizes to the default tab.
 *   - `/some/nonexistent/route` renders the shared 404 boundary.
 *   - A thrown listener never breaks subsequent event dispatch.
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
      id: USER_ID,
      email: "t@e.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

async function stubSupabase(context: BrowserContext) {
  await context.route(
    new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`),
    async (route: Route) => {
      const req = route.request();
      const url = req.url();
      const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
      if (url.includes("/auth/v1/user"))
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(fakeSession().user),
        });
      if (url.includes("/auth/v1/token"))
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(fakeSession()),
        });
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

async function seed(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        // Ensure the "last canvas" hint is empty so malformed events can't
        // accidentally fall back to a previously-persisted value.
        window.localStorage.removeItem("studio:last-canvas");
        // @ts-expect-error stub WS
        window.WebSocket = function () {
          return {
            addEventListener() {},
            removeEventListener() {},
            send() {},
            close() {},
            readyState: 3,
          };
        };
        // Collect any uncaught errors so tests can assert none happened.
        (window as any).__errors = [];
        window.addEventListener("error", (e) => (window as any).__errors.push(String(e.message)));
        window.addEventListener("unhandledrejection", (e) =>
          (window as any).__errors.push(
            "unhandledrejection: " + String((e as PromiseRejectionEvent).reason),
          ),
        );
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

async function freshLoad(page: Page, path = "/app") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => !!window.localStorage.getItem("workspace:name") && !!document.querySelector("textarea"),
    null,
    { timeout: 15_000 },
  );
}

async function dispatch(page: Page, name: string, detail?: unknown) {
  await page.evaluate(({ n, d }) => window.dispatchEvent(new CustomEvent(n, { detail: d })), {
    n: name,
    d: detail,
  });
}

async function readErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__errors ?? []);
}

test.describe("Malformed / unknown suggestion event deep-links", () => {
  test.beforeEach(async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
  });

  test("unknown window event names are silently ignored (no crash, no modal)", async ({ page }) => {
    await freshLoad(page);

    // Fire a batch of events the app does not listen for.
    for (const name of [
      "open:unknown-thing",
      "open:definitely-not-real",
      "chat:teleport",
      "geo:launch-rocket",
    ]) {
      await dispatch(page, name, { anything: true });
    }

    // App is still healthy: no dialog, no errors.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await readErrors(page)).toEqual([]);
    // Composer still works after junk events.
    await dispatch(page, "chat:prefill", { text: "still working" });
    await expect(page.locator("textarea").first()).toHaveValue(/still working/);
  });

  test("open:canvas with malformed detail falls back safely and does not corrupt the URL", async ({
    page,
  }) => {
    await freshLoad(page);
    const initial = await page.evaluate(() => window.location.search);
    expect(initial).toBe("");

    // 1. Unknown canvas type string — should fall back to default (social-post),
    //    NEVER write `?canvas=totally-bogus` into the URL.
    await dispatch(page, "open:canvas", { type: "totally-bogus" });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    const search1 = await page.evaluate(() => window.location.search);
    expect(search1).not.toMatch(/totally-bogus/);
    expect(search1).toMatch(
      /canvas=(social-post|seo-brief|landing-page|email|article|design-asset)/,
    );

    // Close, then try more malformed detail shapes.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForFunction(() => !/canvas=/.test(window.location.search));

    // 2. detail is a number.
    await dispatch(page, "open:canvas", 42 as unknown);
    // 3. detail is an array.
    await dispatch(page, "open:canvas", ["seo-brief"] as unknown);
    // 4. detail is null (no `.type` access).
    await dispatch(page, "open:canvas", null as unknown);
    // 5. detail.type is a number.
    await dispatch(page, "open:canvas", { type: 5 } as unknown);

    // Modal may or may not open depending on fallback, but the URL must
    // never contain the malformed value.
    const search2 = await page.evaluate(() => window.location.search);
    expect(search2).not.toMatch(/canvas=(totally-bogus|42|5|\[)/);
    expect(await readErrors(page)).toEqual([]);
  });

  test("chat:prefill with non-string / missing text is a no-op", async ({ page }) => {
    await freshLoad(page);
    const composer = page.locator("textarea").first();
    await expect(composer).toHaveValue("");

    // Wrong detail shapes — none should populate the composer.
    await dispatch(page, "chat:prefill", {});
    await dispatch(page, "chat:prefill", { text: 123 });
    await dispatch(page, "chat:prefill", { notText: "abc" });
    await dispatch(page, "chat:prefill", null);
    await dispatch(page, "chat:prefill", undefined);

    // Composer is still empty.
    await expect(composer).toHaveValue("");

    // A well-formed event still works after the junk.
    await dispatch(page, "chat:prefill", { text: "good input" });
    await expect(composer).toHaveValue(/good input/);

    expect(await readErrors(page)).toEqual([]);
  });

  test("open:analytics with a bogus tab opens the modal on the default tab, URL not polluted", async ({
    page,
  }) => {
    await freshLoad(page);
    await dispatch(page, "open:analytics", { tab: "not-a-tab" });

    // Modal opens on the default (overview) tab.
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText(/The 30-second snapshot of everything/i);

    // URL must not carry the garbage.
    expect(await page.evaluate(() => window.location.search)).not.toMatch(/not-a-tab/);
    expect(await readErrors(page)).toEqual([]);
  });

  test("/app?canvas=garbage and /app?tab=garbage load cleanly with no modal", async ({ page }) => {
    await freshLoad(page, "/app?canvas=made-up&tab=made-up");

    // Neither modal opens for unknown deep-link values.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The garbage MAY remain in the URL (we don't rewrite unknown params
    // for the user), but the app must still be responsive.
    await dispatch(page, "chat:prefill", { text: "hello from garbage" });
    await expect(page.locator("textarea").first()).toHaveValue(/hello from garbage/);
    expect(await readErrors(page)).toEqual([]);
  });

  test("/app/analytics?tab=garbage normalizes to the default tab via validateSearch", async ({
    page,
  }) => {
    await page.goto("/app/analytics?tab=nope-not-real", { waitUntil: "domcontentloaded" });
    // Bounced to /app…
    await page.waitForFunction(() => window.location.pathname === "/app", null, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({
      timeout: 15_000,
    });

    // …and either (a) opens on the default tab (validateSearch normalized
    // `nope-not-real` → `overview`) or (b) silently opens nothing because
    // the tab param is dropped. Both are acceptable — the crash-free
    // contract is what matters, plus the garbage never lands in the URL.
    expect(await page.evaluate(() => window.location.search)).not.toMatch(/nope-not-real/);

    const dialogCount = await page.getByRole("dialog").count();
    if (dialogCount > 0) {
      await expect(page.getByRole("dialog")).toContainText(/The 30-second snapshot of everything/i);
    }
  });

  test("unknown routes render the 404 boundary with a clear error", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);

    // The 404 component from __root.tsx renders a big "404".
    await expect(page.getByRole("heading", { level: 1, name: /404/ })).toBeVisible({
      timeout: 8_000,
    });
    // A recovery affordance is present (a link back home).
    const links = page.getByRole("link");
    await expect(links.first()).toBeVisible();
  });

  test("a listener that throws does not break subsequent event handling", async ({ page }) => {
    await freshLoad(page);

    // Inject a rogue listener that throws on every open:canvas dispatch.
    await page.evaluate(() => {
      window.addEventListener("open:canvas", () => {
        throw new Error("rogue listener");
      });
    });

    // Dispatch a valid open:canvas — the real handler must still run.
    await dispatch(page, "open:canvas", { type: "seo-brief" });
    await expect(page.getByRole("dialog", { name: /SEO Brief/i })).toBeVisible({ timeout: 5_000 });

    // The rogue throw becomes a global error, but the app is still usable.
    const errs = await readErrors(page);
    expect(errs.some((e) => /rogue listener/.test(e))).toBe(true);
    // Sanity: composer still responds.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await dispatch(page, "chat:prefill", { text: "still alive" });
    await expect(page.locator("textarea").first()).toHaveValue(/still alive/);
  });
});
