import { test, expect, type Route, type Page } from "@playwright/test";
import { STORAGE_KEY, SUPABASE_HOST } from "../fixtures/supabase-ref";

/**
 * Command Center (/agency) — navigation, palette, review filters, report.
 *
 * Verifies across three viewports (desktop, tablet, mobile):
 *   1. Cmd/Ctrl+K opens the palette, search narrows results, Escape closes.
 *   2. The Review view lists drafts from every client and the client filter
 *      pills switch the list.
 *   3. The Report menu copies the report without runtime errors.
 *
 * All Supabase / RPC I/O is stubbed at the network layer so the run is
 * deterministic and offline-safe.
 */

const USER_ID = "00000000-0000-0000-0000-000000000002";
const WS_A = "00000000-0000-4000-8000-0000000000a1";
const WS_B = "00000000-0000-4000-8000-0000000000b2";
const JSON_HEADERS = { "content-type": "application/json" };

function fakeSession() {
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID,
      email: "operator@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

function summary(id: string, name: string, domain: string) {
  return {
    id,
    name,
    websiteUrl: `https://${domain}`,
    domain,
    industry: null,
    clientStatus: "active",
    plan: "free",
    role: "owner",
    isOwner: true,
    duplicateOf: null,
    onboarded: true,
    createdAt: "2024-01-01T00:00:00Z",
    logoUrl: null,
    pendingApprovals: 0,
    draftCount: 1,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
    connectedSocialAccounts: 1,
    geoScore: null,
    geoScannedAt: null,
    lastActivityAt: "2024-06-01T00:00:00Z",
    health: "healthy",
  };
}

const workspaces = [
  summary(WS_A, "Acme Coffee", "acme.test"),
  summary(WS_B, "Northwind Yoga", "northwind.test"),
];

const recent = new Date(Date.now() - 3600_000).toISOString();
const contentItems = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: WS_A,
    agent: "spark",
    kind: "post",
    channel: "instagram",
    title: "Acme launch teaser",
    body: "Coming soon",
    hashtags: [],
    media_url: null,
    status: "pending",
    scheduled_at: null,
    created_at: recent,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    workspace_id: WS_B,
    agent: "spark",
    kind: "post",
    channel: "linkedin",
    title: "Northwind sunrise flow",
    body: "Join us Saturday",
    hashtags: [],
    media_url: null,
    status: "draft",
    scheduled_at: null,
    created_at: recent,
  },
];

async function stubBackend(page: Page) {
  await page
    .context()
    .route(
      new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/v1/.*`),
      async (route: Route) => {
        const req = route.request();
        const url = req.url();
        const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
        if (url.includes("/auth/v1/user")) {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(fakeSession().user),
          });
        }
        if (url.includes("/auth/v1/token")) {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(fakeSession()),
          });
        }
        if (url.includes("/rest/v1/content_items") && req.method() === "GET") {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(contentItems),
          });
        }
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: wantsSingle ? "null" : "[]",
        });
      },
    );

  await page.context().route("**/api/rpc/**", (route) => {
    const url = route.request().url();
    const result = url.includes("workspaces/listWorkspaces") ? workspaces : null;
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ result }) });
  });
  await page
    .context()
    .route("**/api/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" }),
    );
}

async function seedSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        try {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => {} },
          });
        } catch {
          /* noop */
        }
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession() },
  );
}

async function gotoAgency(page: Page, search = "") {
  await page.goto(`/agency${search}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Command Center/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Acme Coffee/).first()).toBeVisible({ timeout: 20_000 });
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 900, height: 1200 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Command Center — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubBackend(page);
      await seedSession(page);
    });

    test("Cmd+K opens palette, search filters, Escape closes", async ({ page }) => {
      await gotoAgency(page);
      const input = page.locator('input[placeholder="Search clients, actions…"]');
      // Chromium eats Ctrl+K on Linux for the address bar; dispatch directly.
      await page.evaluate(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await expect(input).toBeVisible({ timeout: 5_000 });
      const palette = page.getByRole("dialog", { name: "Search" });
      await expect(palette.getByRole("button", { name: /Review \(2\)/ })).toBeVisible();
      await expect(palette.getByRole("button", { name: /Acme Coffee/ }).first()).toBeVisible();

      await input.fill("north");
      await expect(palette.getByRole("button", { name: /Northwind Yoga/ }).first()).toBeVisible();
      await expect(palette.getByRole("button", { name: /Acme Coffee/ })).toHaveCount(0);

      await input.fill("zzznomatchzzz");
      await expect(palette.getByText(/No matches/)).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(input).toBeHidden({ timeout: 3_000 });
    });

    test("Review lists every client's drafts and filters by client", async ({ page }) => {
      await gotoAgency(page, "?view=review");
      await expect(page.getByText("Acme launch teaser").first()).toBeVisible();
      await expect(page.getByText("Northwind sunrise flow").first()).toBeVisible();

      await page.getByRole("button", { name: "Acme Coffee · 1" }).click();
      await expect(page.getByText("Northwind sunrise flow")).toHaveCount(0);
      await expect(page.getByText("Acme launch teaser").first()).toBeVisible();

      await page.getByRole("button", { name: "All clients · 2" }).click();
      await expect(page.getByText("Northwind sunrise flow").first()).toBeVisible();
    });

    test("Report copies without errors", async ({ page }) => {
      await gotoAgency(page);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.getByRole("button", { name: "Report" }).click();
      await page.getByRole("menuitem", { name: /Copy as text/ }).click();
      await expect(page.getByText("Report copied")).toBeVisible({ timeout: 5_000 });
      expect(errors, errors.join(" | ")).toHaveLength(0);
    });
  });
}
