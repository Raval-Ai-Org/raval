import { test, expect, type Route } from "@playwright/test";

const SUPABASE_HOST = "slcmqbbjzyztqyucauol.supabase.co";
const STORAGE_KEY = "sb-slcmqbbjzyztqyucauol-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const JSON_HEADERS = { "content-type": "application/json" };

const session = () => ({
  access_token: "fake",
  refresh_token: "fake",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: USER_ID,
    email: "test@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
  },
});

test("keeps follow-ups in one conversation and separates New Chat", async ({ page, context }) => {
  const conversations = new Map<string, any>();
  const messages: any[] = [];
  let nextConversation = 1;

  await context.route(/https?:\/\/[^/]+\/(auth|rest|realtime)\/.*$/, async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const single = (request.headers().accept || "").includes("pgrst.object");
    if (url.includes("/auth/v1/user"))
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(session().user),
      });
    if (url.includes("/auth/v1/session") || url.includes("/auth/v1/token"))
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(session()),
      });
    if (url.includes("/rest/v1/workspaces"))
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(
          single
            ? { id: WS_ID, name: "Test", website_url: null, onboarded_at: "2024-01-01T00:00:00Z" }
            : [
                {
                  id: WS_ID,
                  name: "Test",
                  website_url: null,
                  onboarded_at: "2024-01-01T00:00:00Z",
                },
              ],
        ),
      });
    if (url.includes("/rest/v1/conversations")) {
      if (request.method() === "POST") {
        const id = `10000000-0000-0000-0000-${String(nextConversation++).padStart(12, "0")}`;
        const row = {
          id,
          workspace_id: WS_ID,
          title: "New chat",
          preview: null,
          updated_at: new Date().toISOString(),
          is_pinned: false,
        };
        conversations.set(id, row);
        return route.fulfill({
          status: 201,
          headers: JSON_HEADERS,
          body: JSON.stringify(row),
        });
      }
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(
          single ? ([...conversations.values()][0] ?? null) : [...conversations.values()],
        ),
      });
    }
    if (url.includes("/rest/v1/chat_messages")) {
      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        messages.push(body);
        return route.fulfill({
          status: 201,
          headers: JSON_HEADERS,
          body: JSON.stringify([body]),
        });
      }
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(messages),
      });
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: single ? "null" : "[]" });
  });

  await context.route("**/api/clarify", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ needs_clarification: false }),
    }),
  );
  await context.route("**/api/rpc/coach/getCoachBriefing", (route) =>
    route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        result: {
          greeting: "Good morning",
          headline: "Ship the clearest next move",
          focus: {
            title: "Publish one useful insight",
            why: "Consistency compounds.",
            action: { label: "Draft a post", prompt: "Draft a post", intent: "social" },
          },
          wins: [],
          risks: [],
          competitors: [],
          market: [],
          plays: [],
          weekPlan: [],
          sources: [],
          generatedAt: new Date().toISOString(),
        },
      }),
    }),
  );
  await context.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: "A useful reply" } }] })}\ndata: [DONE]\n`,
    }),
  );
  await page.addInitScript(
    ({ key, auth, workspaceId }) => {
      localStorage.setItem(key, JSON.stringify(auth));
      localStorage.setItem("workspace:selected", workspaceId);
    },
    { key: STORAGE_KEY, auth: session(), workspaceId: WS_ID },
  );

  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mellox AI Workspace" })).toBeVisible({
    timeout: 15_000,
  });
  const coachToggle = page.getByRole("button", { name: "Expand Marketing Coach" });
  await expect(coachToggle).toBeVisible({ timeout: 15_000 });
  await coachToggle.click();
  await expect(page.getByRole("button", { name: "Collapse Marketing Coach" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Checklist" })).toBeVisible();
  await page.getByRole("tab", { name: "Checklist" }).click();
  await expect(page.getByRole("tabpanel", { name: "Checklist" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse Marketing Coach" }).click();
  await expect(page.getByRole("button", { name: "Expand Marketing Coach" })).toBeVisible();
  const composer = page.getByPlaceholder(/Ask Mellox AI/i).first();
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Plan my launch");
  await page.getByRole("button", { name: /Send message/i }).click();
  await expect(page.getByText("A useful reply")).toBeVisible({ timeout: 15_000 });

  expect(new Set(messages.map((message) => message.conversation_id)).size).toBe(1);
  const firstConversation = [...new Set(messages.map((message) => message.conversation_id))][0];
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("button", { name: "New Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/chat\//);
  expect(conversations.size).toBe(2);
  const conversationIds = [...conversations.keys()];
  expect(conversationIds[1]).not.toBe(firstConversation);
  expect(page.url()).toContain(conversationIds[1]);
});
