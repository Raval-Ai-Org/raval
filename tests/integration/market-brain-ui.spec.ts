import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

const SUPABASE_HOST = "slcmqbbjzyztqyucauol.supabase.co";
const STORAGE_KEY = "sb-slcmqbbjzyztqyucauol-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const COLLECTION_ID = "11111111-1111-1111-1111-111111111111";
const JSON_HEADERS = { "content-type": "application/json" };

function session() {
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER_ID, email: "test@example.com", aud: "authenticated", role: "authenticated" },
  };
}

const briefing = {
  greeting: "Good morning",
  headline: "Your next best move is ready",
  focus: {
    title: "Focus",
    why: "Ship the clearest move.",
    action: { label: "Ask Ravi", prompt: "Help me", intent: "market" },
  },
  wins: [],
  risks: [],
  competitors: [],
  market: [],
  plays: [],
  weekPlan: [],
  sources: [],
  generatedAt: new Date().toISOString(),
};

const intelligence = {
  summary:
    "Interest around AI marketing is strong in the United States. This creates an opportunity to teach practical strategy.",
  trendSignals: [
    {
      title: "Strong search interest",
      direction: "rising",
      evidence: ["Google Trends reported a measured value of 80."],
      significance: "A focused educational test is warranted.",
      opportunities: ["Create one explainer."],
    },
  ],
  opportunities: [
    {
      title: "Educational content test",
      explanation: "Turn the measured signal into a practical asset.",
      targetAudience: "Marketing teams",
      recommendedAction: "Publish one explainer.",
      priority: "medium",
    },
  ],
  recommendations: [
    {
      action: "Publish one practical explainer.",
      reason: "The measured signal supports a focused test.",
      expectedMarketingImpact: "Learn which angle earns response.",
      priority: "medium",
    },
  ],
  relatedQueries: ["AI marketing tools"],
  relatedTopics: [],
  confidence: "medium",
  generatedAt: new Date().toISOString(),
};

const completedCollection = {
  success: true,
  state: "completed",
  collectionId: COLLECTION_ID,
  data: {
    keywords: ["AI marketing"],
    interestOverTime: [
      { timestamp: 1, date: "2026-09-01", values: [80] },
      { timestamp: 2, date: "2026-09-02", values: [90] },
    ],
    regionalInterest: [],
    relatedQueries: [],
    relatedTopics: [],
  },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

const emptyLatest = {
  success: true,
  result: null,
  intelligence: null,
  activeScan: null,
  lastError: null,
  schedule: null,
  freshUntil: null,
};

const storedLatest = {
  success: true,
  result: {
    collectionId: COLLECTION_ID,
    keywords: ["AI marketing"],
    location: "United States",
    completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    data: completedCollection.data,
  },
  intelligence,
  activeScan: null,
  lastError: null,
  schedule: {
    nextRunAt: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
    lastRunStatus: "ok",
  },
  freshUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
};

/** Signed-in app shell with the Market tab open. Register /api/market routes first. */
async function openMarketBrain(
  page: Page,
  context: BrowserContext,
  opts: { latest?: unknown } = {},
) {
  await context.route("**/api/market/latest**", (route) => json(route, opts.latest ?? emptyLatest));
  await context.route(
    new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`),
    async (route: Route) => {
      const url = route.request().url();
      const wantsSingle = (route.request().headers()["accept"] || "").includes("pgrst.object");
      if (url.includes("/auth/v1/user")) return json(route, session().user);
      if (url.includes("/auth/v1/session")) return json(route, session());
      if (url.includes("/auth/v1/token")) return json(route, session());
      if (url.includes("/rest/v1/workspaces"))
        return json(
          route,
          wantsSingle
            ? { id: WS_ID, name: "Mellox", website_url: null }
            : [{ id: WS_ID, name: "Mellox", website_url: null }],
        );
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: wantsSingle ? "null" : "[]",
      });
    },
  );
  await context.route("**/api/rpc/coach/getCoachBriefing", (route) =>
    json(route, { result: briefing }),
  );
  await context.route("**/_serverFn/coach/getCoachBriefing", (route) =>
    json(route, { data: briefing }),
  );
  await context.route("**/_serverFn/**", (route) => json(route, { data: briefing }));

  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      localStorage.setItem(storageKey, JSON.stringify(sess));
      localStorage.setItem("workspace:selected", wsId);
      localStorage.setItem("workspace:name", "Mellox");
      localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
    },
    { storageKey: STORAGE_KEY, sess: session(), wsId: WS_ID },
  );

  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Loading workspace…")).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: /expand marketing coach/i }).click();
  await expect(page.getByText("Your next best move is ready")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /^market/i }).click();
  await expect(page.getByTestId("market-brain")).toBeVisible();
}

async function scan(page: Page) {
  await expect(page.getByText("Set your market lens")).toBeVisible();
  await page.getByLabel("Market keywords").fill("AI marketing");
  await page.getByRole("button", { name: /scan/i }).click();
}

test.describe("Market Brain UI", () => {
  test("moves from setup through collection to grounded intelligence", async ({
    page,
    context,
  }) => {
    let trendPolls = 0;
    await context.route("**/api/market/trends**", async (route) => {
      if (route.request().method() === "POST")
        return json(route, {
          success: true,
          state: "pending",
          collectionId: COLLECTION_ID,
          taskId: "task-1",
        });
      trendPolls += 1;
      if (trendPolls === 1)
        return json(route, {
          success: true,
          state: "pending",
          collectionId: COLLECTION_ID,
          taskId: "task-1",
        });
      return json(route, completedCollection);
    });
    await context.route("**/api/market/intelligence**", (route) =>
      json(route, {
        success: true,
        state: "completed",
        collectionId: COLLECTION_ID,
        data: intelligence,
      }),
    );

    await openMarketBrain(page, context);
    await scan(page);
    await expect(page.getByText(/market data is still being collected/i)).toBeVisible();
    await expect(page.getByText("Market pulse")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Interest around AI marketing is strong/i)).toBeVisible();
    await expect(page.getByTestId("market-brain-kpis")).toContainText("Interest now");
    await expect(page.getByRole("tab", { name: /next moves/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Publish one practical explainer.")).toBeVisible();
    await page.getByRole("tab", { name: /signals/i }).click();
    await expect(page.getByText("Strong search interest")).toBeVisible();
  });

  test("shows the stored result on open without starting a scan, and after reopening", async ({
    page,
    context,
  }) => {
    let scans = 0;
    await context.route("**/api/market/trends**", (route) => {
      scans += 1;
      return json(route, completedCollection);
    });

    await openMarketBrain(page, context, { latest: storedLatest });
    await expect(page.getByText("Market pulse")).toBeVisible();
    await expect(page.getByTestId("market-brain-kpis")).toContainText("Interest now");
    await expect(page.getByTestId("market-brain-lens")).toContainText("United States");
    await expect(page.getByTestId("market-brain-freshness")).toContainText("Updated 2h ago");
    await expect(page.getByText("Set your market lens")).toHaveCount(0);

    await page.getByRole("button", { name: /collapse marketing coach/i }).click();
    await page.getByRole("button", { name: /expand marketing coach/i }).click();
    await expect(page.getByText("Market pulse")).toBeVisible();
    expect(scans).toBe(0);
  });

  test("maximizes the coach into a popup without interrupting a running scan", async ({
    page,
    context,
  }) => {
    let polls = 0;
    await context.route("**/api/market/trends**", (route) => {
      if (route.request().method() === "POST")
        return json(route, { success: true, state: "pending", collectionId: COLLECTION_ID });
      polls += 1;
      return polls >= 3
        ? json(route, completedCollection)
        : json(route, { success: true, state: "pending", collectionId: COLLECTION_ID });
    });
    await context.route("**/api/market/intelligence**", (route) =>
      json(route, {
        success: true,
        state: "completed",
        collectionId: COLLECTION_ID,
        data: intelligence,
      }),
    );

    await openMarketBrain(page, context);
    await scan(page);
    await expect(page.getByTestId("market-brain-pending")).toBeVisible();

    await page.getByRole("button", { name: /maximize marketing coach/i }).click();
    const dialog = page.getByTestId("marketing-coach-maximized");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("market-brain")).toBeVisible();
    await expect(dialog.getByText("Market pulse")).toBeVisible({ timeout: 25_000 });

    await page.getByRole("button", { name: /restore marketing coach/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Market pulse")).toBeVisible();

    await page.getByRole("button", { name: /maximize marketing coach/i }).click();
    await expect(page.getByTestId("marketing-coach-maximized")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("marketing-coach-maximized")).toHaveCount(0);
  });

  test("fits a phone-sized screen without horizontal scrolling", async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openMarketBrain(page, context, { latest: storedLatest });
    await expect(page.getByText("Market pulse")).toBeVisible();
    const panelOverflow = await page
      .getByTestId("market-brain")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(panelOverflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: /maximize marketing coach/i }).click();
    const dialog = page.getByTestId("marketing-coach-maximized");
    await expect(dialog.getByText("Market pulse")).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(376);
    const dialogOverflow = await dialog
      .getByTestId("market-brain")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(dialogOverflow).toBeLessThanOrEqual(1);
  });

  test("keeps the trend evidence and shows the provider reason when analysis fails, then retries", async ({
    page,
    context,
  }) => {
    await context.route("**/api/market/trends**", (route) => json(route, completedCollection));
    let analyses = 0;
    await context.route("**/api/market/intelligence**", (route) => {
      analyses += 1;
      return analyses === 1
        ? json(route, {
            success: false,
            state: "failed",
            collectionId: COLLECTION_ID,
            error: {
              message: "Claude output for market-intelligence was cut off before completion.",
              code: "max_tokens",
            },
          })
        : json(route, {
            success: true,
            state: "completed",
            collectionId: COLLECTION_ID,
            data: intelligence,
          });
    });

    await openMarketBrain(page, context);
    await scan(page);
    const alert = page.getByTestId("market-brain-error");
    await expect(alert).toContainText("Trend data is ready, but Ravi's analysis failed");
    await expect(alert).toContainText("cut off before completion");
    await expect(page.getByText("Measured signal")).toBeVisible();

    await alert.getByRole("button", { name: /retry/i }).click();
    await expect(page.getByText("Market pulse")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("market-brain-error")).toHaveCount(0);
  });

  test("shows no_data as a neutral notice, distinct from failure", async ({ page, context }) => {
    await context.route("**/api/market/trends**", (route) =>
      json(route, {
        success: true,
        state: "no_data",
        collectionId: COLLECTION_ID,
        error: { message: "No measurable search interest.", code: "no_data" },
      }),
    );

    await openMarketBrain(page, context);
    await scan(page);
    await expect(page.getByTestId("market-brain-no-data")).toContainText(
      "found no measurable search interest",
    );
    await expect(page.getByTestId("market-brain-error")).toHaveCount(0);
    await expect(page.getByText("Set your market lens")).toBeVisible();
  });

  test("shows the provider reason when the collection fails", async ({ page, context }) => {
    await context.route("**/api/market/trends**", (route) =>
      json(route, {
        success: false,
        state: "failed",
        collectionId: COLLECTION_ID,
        error: {
          message: "DataForSEO task creation failed: Payment Required.",
          providerCode: 40200,
        },
        retryAfterSeconds: 42,
      }),
    );

    await openMarketBrain(page, context);
    await scan(page);
    const alert = page.getByTestId("market-brain-error");
    await expect(alert).toContainText("Google Trends collection failed");
    await expect(alert).toContainText("Payment Required");
    await expect(alert).toContainText("retry available in 42s");
  });

  test("keeps visible progress moving during a scan and keeps old results while refreshing", async ({
    page,
    context,
  }) => {
    let polls = 0;
    await context.route("**/api/market/trends**", async (route) => {
      if (route.request().method() === "POST")
        return json(route, { success: true, state: "pending", collectionId: COLLECTION_ID });
      polls += 1;
      return polls % 3 === 0
        ? json(route, completedCollection)
        : json(route, { success: true, state: "pending", collectionId: COLLECTION_ID });
    });
    await context.route("**/api/market/intelligence**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return json(route, {
        success: true,
        state: "completed",
        collectionId: COLLECTION_ID,
        data: { ...intelligence, generatedAt: new Date().toISOString() },
      });
    });

    await openMarketBrain(page, context);
    await scan(page);

    const progress = page.getByTestId("market-brain-pending").getByRole("progressbar");
    await expect(progress).toBeVisible();
    await expect(page.getByTestId("market-brain-skeleton")).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText("Google Trends");
    const firstValue = Number(await progress.getAttribute("aria-valuenow"));
    const firstClock = await page
      .getByTestId("market-brain-pending")
      .getByText(/^\d+:\d{2}$/)
      .textContent();
    await page.waitForTimeout(2_200);
    expect(Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(firstValue);
    await expect(page.getByTestId("market-brain-pending").getByText(/^\d+:\d{2}$/)).not.toHaveText(
      firstClock ?? "",
    );

    await expect(page.getByText(/Ravi is analyzing your market/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[aria-current="step"]')).toContainText("Analysis");
    await expect(page.getByText("Market pulse")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("market-brain-pending")).toHaveCount(0);

    // Refresh: the previous result stays on screen while the new scan runs.
    await page.getByRole("button", { name: /refresh market signals/i }).click();
    await expect(page.getByTestId("market-brain-pending")).toBeVisible();
    await expect(page.getByText("Market pulse")).toBeVisible();
    await expect(page.getByTestId("market-brain-pending")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Market pulse")).toBeVisible();
  });
});
