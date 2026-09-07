import { test, expect, type Route } from "@playwright/test";

const SUPABASE_HOST = "smdravaoaeqdajmnrlpr.supabase.co";
const STORAGE_KEY = "sb-smdravaoaeqdajmnrlpr-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const JSON_HEADERS = { "content-type": "application/json" };
const URL = "https://example.com";

function session() {
  return {
    access_token: "fake",
    refresh_token: "fake",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "00000000-0000-0000-0000-000000000002",
      email: "test@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    },
  };
}

test.describe("Onboarding URL to Brand DNA", () => {
  test("uses one URL, streams the real scan, supports review, and completes", async ({
    page,
    context,
  }) => {
    const workspaceWrites: string[] = [];
    const scanBodies: string[] = [];
    let extractionAttempts = 0;

    await context.route(
      new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/.*`),
      async (route: Route) => {
        const request = route.request();
        const url = request.url();
        const single = (request.headers().accept || "").includes("pgrst.object");
        if (url.includes("/auth/v1/user"))
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(session().user),
          });
        if (url.includes("/auth/v1/session"))
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(session()),
          });
        if (url.includes("/auth/v1/token"))
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(session()),
          });
        if (url.includes("/rest/v1/workspaces")) {
          if (request.method() !== "GET") {
            workspaceWrites.push(request.postData() || "");
            return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
          }
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(
              single
                ? { id: WS_ID, onboarded_at: null, website_url: null }
                : [{ id: WS_ID, onboarded_at: null, website_url: null }],
            ),
          });
        }
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: single ? "null" : "[]" });
      },
    );

    await context.route("**/api/brand-extract", async (route) => {
      extractionAttempts += 1;
      scanBodies.push(route.request().postData() || "");
      if (extractionAttempts === 1) {
        return route.fulfill({
          status: 503,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Temporary extraction interruption" }),
        });
      }
      const events = [
        { type: "progress", stage: "fetch_home", message: "Connecting to your website", pct: 8 },
        { type: "progress", stage: "analyze", message: "Analyzing with AI", pct: 80 },
        {
          type: "result",
          data: {
            brandName: "Example",
            oneLiner: "A useful example brand",
            industry: "Technology",
            audience: "Teams",
            voice: "Clear",
            products: "Software",
            missing: [],
          },
        },
      ];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        // The final NDJSON record is intentionally unterminated. The client
        // must flush its decoder and process buffered data when the stream ends.
        body: events.map((event) => JSON.stringify(event)).join("\n"),
      });
    });

    await page.addInitScript(
      ({ storageKey, auth, workspaceId }) => {
        localStorage.setItem(storageKey, JSON.stringify(auth));
        localStorage.setItem("workspace:selected", workspaceId);
      },
      { storageKey: STORAGE_KEY, auth: session(), workspaceId: WS_ID },
    );

    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    const input = page.getByLabel("Website URL");
    await expect(input).toBeVisible();
    await input.fill(URL);
    await page.getByRole("button", { name: "Scan my brand" }).click();

    await expect(page.getByText("Review your Brand DNA.")).toBeVisible({ timeout: 15_000 });
    expect(scanBodies).toHaveLength(2);
    expect(JSON.parse(scanBodies[0]).url).toBe(URL);
    expect(workspaceWrites.join(" ")).toContain(URL);
    await expect(page.locator('input[value="Example"]')).toBeVisible();
    await page.getByRole("button", { name: /Enter Mellox/ }).click();
    await expect(page.getByText("Your workspace is ready.")).toBeVisible();

    const persistedUrl = await page.evaluate(
      (id) => localStorage.getItem(`onboarding:website:${id}`),
      WS_ID,
    );
    expect(persistedUrl).toBeNull();
  });
});
