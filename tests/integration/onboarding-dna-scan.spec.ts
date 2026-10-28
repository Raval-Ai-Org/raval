import { test, expect, type Route } from "@playwright/test";
import { STORAGE_KEY, SUPABASE_HOST } from "../fixtures/supabase-ref";

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
  test("asks the goal during the scan, then review, products and channels", async ({
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

    const rpcCalls: { fn: string; data: Record<string, unknown> }[] = [];
    const product = {
      id: "00000000-0000-4000-8000-0000000000aa",
      kind: "product",
      name: "Example Pro",
      description: "",
      price: "USD 49",
      url: "https://example.com/products/pro",
      category: "",
      benefits: [],
      images: [],
      primaryAssetId: null,
      source: "shopify",
      position: 0,
      status: "active",
    };
    await context.route("**/api/rpc/**", async (route) => {
      const fn = new URL(route.request().url()).pathname.replace("/api/rpc/", "");
      const data = (JSON.parse(route.request().postData() || "{}").data ?? {}) as Record<
        string,
        unknown
      >;
      rpcCalls.push({ fn, data });
      const goals = {
        focus: "leads",
        targets: [],
        timeframeWeeks: 12,
        postsPerWeek: 3,
        channels: ["linkedin"],
        startedAt: "2026-11-01T00:00:00.000Z",
        note: "",
      };
      const result =
        fn === "goals/getGoals"
          ? { goals: null, version: 0, updatedAt: null }
          : fn === "goals/saveGoals"
            ? { goals, version: 1, updatedAt: "2026-11-01T00:00:00Z", warnings: [] }
            : fn === "products/listProducts"
              ? []
              : fn === "products/importProducts"
                ? [product]
                : fn.startsWith("competitors/")
                  ? { competitors: [] }
                  : null;
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ result }),
      });
    });
    await context.route("**/api/sdr/**", (route) =>
      route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ enabled: false, canPublish: false, platforms: [] }),
      }),
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
        {
          type: "discovery",
          kind: "site",
          data: {
            hostname: "example.com",
            siteName: "Example",
            title: "Example — useful software",
            description: "A useful example brand",
            themeColor: "#112233",
            faviconUrl: null,
            logoUrl: null,
            ogImageUrl: null,
          },
        },
        {
          type: "discovery",
          kind: "pages",
          data: { paths: ["/about", "/pricing"], sitemapUrls: 3 },
        },
        {
          type: "discovery",
          kind: "identity",
          data: {
            colors: ["#112233", "#ffaa00"],
            fonts: ["Inter"],
            structuredData: 1,
            headings: 6,
            socialPlatforms: ["linkedin"],
          },
        },
        {
          type: "discovery",
          kind: "products",
          data: {
            products: [
              {
                name: "Example Pro",
                description: "",
                price: "USD 49",
                url: "https://example.com/products/pro",
                category: "",
                images: [],
                source: "shopify",
                fingerprint: "url:example.com/products/pro",
              },
            ],
          },
        },
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
            doRules: "Lead with outcomes; Use plain language",
            colors: [{ name: "Primary", hex: "#112233" }],
            fonts: ["Inter"],
            competitors: [{ name: "Globex", positioning: "Enterprise suite" }],
            customerSignals: { painPoints: "Manual reporting" },
            insights: [{ title: "Targets small teams", body: "Not enterprise" }],
            extras: { pagesCrawled: ["https://example.com", "https://example.com/about"] },
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

    // The goal is asked while the scan runs.
    await expect(page.getByText("What should your marketing do first?")).toBeVisible();
    await page.getByRole("radio", { name: /Get new customers/ }).click();
    await page.getByRole("button", { name: "LinkedIn" }).click();
    await page.getByRole("button", { name: /Set my goal/ }).click();
    await expect.poll(() => rpcCalls.some((c) => c.fn === "goals/saveGoals")).toBe(true);
    expect(rpcCalls.find((c) => c.fn === "goals/saveGoals")!.data.goals).toMatchObject({
      focus: "leads",
      channels: ["linkedin"],
    });

    await expect(page.getByText("Review your Brand DNA.")).toBeVisible({ timeout: 15_000 });
    expect(scanBodies).toHaveLength(2);
    expect(JSON.parse(scanBodies[0]).url).toBe(URL);
    expect(workspaceWrites.join(" ")).toContain(URL);
    await expect(page.locator('input[value="Example"]')).toBeVisible();
    // The reveal renders the real extracted fields.
    await expect(page.getByRole("button", { name: "Copy Primary #112233" })).toBeVisible();
    await expect(page.getByText("Lead with outcomes")).toBeVisible();
    await expect(page.getByText("Globex")).toBeVisible();
    await expect(page.getByText("Targets small teams")).toBeVisible();
    await page.getByLabel("Industry").fill("Developer tools");
    await page.getByRole("button", { name: /Looks right, continue/ }).click();

    // Products found on the site; at least one is needed to go on.
    await expect(page.getByText("Found on your site")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("button", { name: /Keep 1/ }).click();
    await expect(page.getByRole("heading", { name: "Example Pro" })).toBeVisible();
    expect(
      (rpcCalls.find((c) => c.fn === "products/importProducts")!.data.candidates as unknown[])
        .length,
    ).toBe(1);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Where should your posts go?")).toBeVisible();
    await page
      .getByRole("button", { name: /Skip for now/ })
      .last()
      .click();
    await expect(page.getByText(/first three posts/)).toBeVisible();

    const stored = await page.evaluate(
      (id) => ({
        url: localStorage.getItem(`onboarding:website:${id}`),
        dna: JSON.parse(localStorage.getItem(`brand-dna:v3:${id}`) || "{}"),
      }),
      WS_ID,
    );
    expect(stored.url).toBeNull();
    expect(stored.dna.industry).toBe("Developer tools");
    // Brand DNA's products line comes from the catalogue the person kept.
    expect(stored.dna.products).toBe("Example Pro");
    expect(stored.dna.customer.painPoints).toBe("Manual reporting");
    expect(stored.dna.competitors[0]).toMatchObject({ name: "Globex", id: expect.any(String) });
    expect(stored.dna).not.toHaveProperty("customerSignals");
    expect(stored.dna).not.toHaveProperty("insights");
    expect(workspaceWrites.join(" ")).toContain("Developer tools");
  });
});
