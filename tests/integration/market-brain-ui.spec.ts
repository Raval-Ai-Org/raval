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

/** Signed-in app shell with the Market tab open. Register /api/market routes first. */
async function openMarketBrain(page: Page, context: BrowserContext) {
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
  await page.getByRole("tab", { name: /market/i }).click();
  await expect(page.getByTestId("market-brain")).toBeVisible();
  await expect(page.getByText("Set your market lens")).toBeVisible();
}

async function scan(page: Page) {
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
    await expect(page.getByText("What’s changing")).toBeVisible();
    await expect(page.getByText("What to do next")).toBeVisible();
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
});
