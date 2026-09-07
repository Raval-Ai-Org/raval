import { test, expect, type Route } from "@playwright/test";

/**
 * Verifies the chat surfaces the correct user-facing message when
 * /api/chat responds with 429 (rate limited) and 402 (credits exhausted),
 * and that the composer recovers gracefully so the user can retry.
 */

const SUPABASE_HOST = "smdravaoaeqdajmnrlpr.supabase.co";
const STORAGE_KEY = "sb-smdravaoaeqdajmnrlpr-auth-token";
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

async function stubSupabase(context: import("@playwright/test").BrowserContext) {
  const conversations = new Map<
    string,
    { id: string; title: string; preview: string | null; updated_at: string; is_pinned: boolean }
  >();
  await context.route(/https?:\/\/[^/]+\/(auth|rest|realtime)\/.*$/, async (route: Route) => {
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
    if (url.includes("/auth/v1/session"))
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
    if (url.includes("/rest/v1/conversations")) {
      if (req.method() === "POST") {
        const id = "10000000-0000-0000-0000-000000000001";
        const row = {
          id,
          title: "New chat",
          preview: null,
          updated_at: new Date().toISOString(),
          is_pinned: false,
        };
        conversations.set(id, row);
        return route.fulfill({
          status: 201,
          headers: JSON_HEADERS,
          body: JSON.stringify(wantsSingle ? row : [row]),
        });
      }
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(
            wantsSingle ? ([...conversations.values()][0] ?? null) : [...conversations.values()],
          ),
        });
      }
      return route.fulfill({ status: 204, headers: JSON_HEADERS, body: "" });
    }
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: wantsSingle ? "null" : "[]",
    });
  });
  await context.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );
  await context.route("**/api/clarify", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ needs_clarification: false }),
    }),
  );
}

async function seed(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        // Prevent onboarding auto-send from interfering.
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        // @ts-expect-error test stub
        window.WebSocket = function () {
          return {
            addEventListener() {},
            removeEventListener() {},
            send() {},
            close() {},
            readyState: 3,
          };
        };
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

async function typeAndSend(page: import("@playwright/test").Page, text: string) {
  const composer = page.getByPlaceholder(/Ask Mellox AI/i).first();
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.click();
  await composer.fill(text);
  await page.getByRole("button", { name: /Send message/i }).click();
}

test.describe("Chat error handling", () => {
  test("shows rate-limit toast on 429 and recovers", async ({ page, context }) => {
    await stubSupabase(context);

    let calls = 0;
    await context.route("**/api/chat", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          status: 429,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Rate limited. Please try again in a moment." }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body:
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Recovered reply." } }] })}\n` +
          `data: [DONE]\n`,
      });
    });

    await seed(page);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Mellox AI Workspace" })).toBeVisible({
      timeout: 15_000,
    });
    await typeAndSend(page, "First try � should hit rate limit");

    // 1. The rate-limit toast is shown to the user.
    await expect(page.getByText(/Rate limit hit\. Wait a moment and try again\./i)).toBeVisible({
      timeout: 10_000,
    });

    // 2. Composer & Send button recover (not stuck streaming).
    const sendBtn = page.getByRole("button", { name: /Send message/i });
    await expect(sendBtn).toBeVisible({ timeout: 10_000 });
    const composer = page.getByPlaceholder(/Ask Mellox AI/i).first();
    await expect(composer).toBeEnabled();

    // 3. User can retry � the next send now succeeds.
    await composer.fill("Retry after backoff");
    await sendBtn.click();
    await expect(page.getByText(/Recovered reply\./i)).toBeVisible({ timeout: 10_000 });
    expect(calls).toBe(2);
  });

  test("shows credits-exhausted toast on 402 and recovers", async ({ page, context }) => {
    await stubSupabase(context);

    let calls = 0;
    await context.route("**/api/chat", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          status: 402,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: "AI credits exhausted. Add credits in Settings ? Plans & credits.",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body:
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Back online." } }] })}\n` +
          `data: [DONE]\n`,
      });
    });

    await seed(page);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Mellox AI Workspace" })).toBeVisible({
      timeout: 15_000,
    });
    await typeAndSend(page, "First try � should hit credits");

    // 1. The credits-exhausted toast is shown to the user.
    await expect(page.getByText(/AI credits exhausted\./i)).toBeVisible({ timeout: 10_000 });

    // 2. Composer & Send button recover.
    const sendBtn = page.getByRole("button", { name: /Send message/i });
    await expect(sendBtn).toBeVisible({ timeout: 10_000 });
    const composer = page.getByPlaceholder(/Ask Mellox AI/i).first();
    await expect(composer).toBeEnabled();

    // 3. User can retry after topping up credits.
    await composer.fill("Retry after top-up");
    await sendBtn.click();
    await expect(page.getByText(/Back online\./i)).toBeVisible({ timeout: 10_000 });
    expect(calls).toBe(2);
  });
});
