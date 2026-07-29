import { test, expect, type Route, type Page, type BrowserContext } from "@playwright/test";

/**
 * Deep-link tests for every window event a Studio suggestion can fire.
 *
 * "Deep-link" here means: the app is opened directly at its route on a
 * FRESH load (no preceding UI navigation), and we dispatch the event
 * that the suggestion's `run()` would dispatch. The corresponding UI
 * MUST respond exactly as if the user had clicked the suggestion in
 * the rail:
 *
 *   geo:run-audit         → GeoAeoPanel posts to /api/geo-audit
 *   open:brand-dna        → Brand DNA (Memory) dialog opens
 *   open:content-calendar → Content Calendar dialog opens
 *   open:client-portal    → Client portal dialog opens
 *   open:canvas           → Studio canvas modal opens on the requested tile
 *   chat:prefill          → Chat composer textarea is populated + focused
 *
 * Every listener must survive a fresh mount — no reliance on prior
 * clicks having primed state, no reliance on the suggestion rail
 * having rendered first.
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

async function stubSupabase(context: BrowserContext, opts: { websiteUrl?: string | null } = {}) {
  const websiteUrl = opts.websiteUrl ?? null;
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
        id: WS_ID, name: "Test",
        website_url: websiteUrl, industry: null,
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

type SeedOpts = {
  brandDna?: Record<string, unknown> | null;
};

async function seed(page: Page, opts: SeedOpts = {}) {
  await page.addInitScript(
    ({ storageKey, sess, wsId, brandDna }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        window.localStorage.removeItem("studio:suggest-dismissed");
        window.localStorage.removeItem(`studio:suggestions:${wsId}`);
        if (brandDna) {
          window.localStorage.setItem(`brand-dna:v3:${wsId}`, JSON.stringify(brandDna));
        }
        // @ts-expect-error test stub
        window.WebSocket = function () {
          return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
        };
      } catch { /* noop */ }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID, brandDna: opts.brandDna ?? null },
  );
}

async function freshLoad(page: Page) {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  // Wait for the shell + workspace to hydrate. AppShell only mounts the
  // ChatPanel / dialog listeners once workspaceId is set, so a naive wait
  // on the Studio rail races the event dispatch.
  await expect(page.getByRole("button", { name: "Collapse Studio panel" })).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => !!window.localStorage.getItem("workspace:name") && !!document.querySelector("textarea"),
    null,
    { timeout: 15_000 },
  );
}

async function dispatch(page: Page, name: string, detail?: unknown) {
  await page.evaluate(
    ({ n, d }) => window.dispatchEvent(new CustomEvent(n, { detail: d })),
    { n: name, d: detail },
  );
}

test.describe("Suggestion event deep-links", () => {
  test("chat:prefill fills and focuses the composer on a fresh /app load", async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await freshLoad(page);

    const prompt = "Plan this week's content — 5 posts across LinkedIn and Instagram.";
    await dispatch(page, "chat:prefill", prompt);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toHaveValue(prompt, { timeout: 3_000 });
    const isFocused = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
    expect(isFocused).toBe(true);
  });

  test("open:brand-dna opens the Memory (Brand DNA) dialog", async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await freshLoad(page);

    await dispatch(page, "open:brand-dna");
    await expect(page.getByRole("dialog", { name: /Memory/i })).toBeVisible({ timeout: 3_000 });
  });

  test("open:content-calendar opens the Content Calendar dialog", async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await freshLoad(page);

    // ContentCalendar is lazy-loaded and its listener only registers after
    // the chunk mounts, so retry the dispatch until the dialog appears.
    const dialog = page.getByRole("dialog", { name: /Content Calendar/i });
    await expect.poll(async () => {
      await dispatch(page, "open:content-calendar");
      return dialog.isVisible().catch(() => false);
    }, { timeout: 10_000, intervals: [250, 500, 1000] }).toBe(true);
  });

  test("open:client-portal opens the Client Portal dialog", async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await freshLoad(page);

    await dispatch(page, "open:client-portal");
    // The dialog's accessible name is "Share your work. Stay in control." —
    // match on the distinctive phrase so a copy tweak doesn't break the test.
    await expect(page.getByRole("dialog", { name: /Stay in control/i })).toBeVisible({ timeout: 3_000 });
  });

  test("open:canvas opens the Studio canvas modal on the requested tile", async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await freshLoad(page);

    await dispatch(page, "open:canvas", { type: "seo-brief" });
    // StudioCanvasModal sets DialogPrimitive.Title to the tile label.
    await expect(page.getByRole("dialog", { name: /SEO Brief/i })).toBeVisible({ timeout: 3_000 });
  });

  test("geo:run-audit triggers a POST to /api/geo-audit from GeoAeoPanel", async ({ context, page }) => {
    // Panel gates run() on having a website URL — seed via brand-dna cache.
    await stubSupabase(context, { websiteUrl: "https://example.com" });
    await seed(page, { brandDna: { brandName: "Example", websiteUrl: "https://example.com" } });

    let auditHit = false;
    let auditBody: string | null = null;
    await context.route("**/api/geo-audit", async (route) => {
      auditHit = true;
      auditBody = route.request().postData();
      // Keep the request pending briefly so the test polls the flag, then
      // fulfill with a minimal valid AuditResult so the panel doesn't error.
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          url: "https://example.com",
          overall: 72,
          subscores: [],
          actions: [],
          fetchedAt: new Date().toISOString(),
        }),
      });
    });

    await freshLoad(page);
    await dispatch(page, "geo:run-audit");

    await expect.poll(() => auditHit, { timeout: 5_000 }).toBe(true);
    expect(auditBody ?? "").toContain("example.com");
  });
});
