import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end integration test for the onboarding first-prompt flow.
 *
 * Verifies that when a workspace has `first_prompt` set (as onboarding does):
 *   1. ChatPanel picks it up on mount,
 *   2. Shows the "Kicking off your first request�" loading state,
 *   3. Sends the prompt through the real chat pipeline (clarify ? /api/chat),
 *   4. Renders the user bubble AND a streamed assistant reply,
 *   5. Re-enables the composer once the reply completes.
 *
 * All external I/O (Supabase auth + REST, /api/clarify, /api/chat) is stubbed
 * at the network layer so the test is deterministic and offline-safe.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const FIRST_PROMPT = "Plan my first week of marketing";
const ASSISTANT_REPLY = "Here is your kickoff plan for the week.";

const JSON_HEADERS = { "content-type": "application/json" };

function sseFor(text: string): string {
  const chunks = text.split(" ").map((word, i, arr) => {
    const content = i === arr.length - 1 ? word : word + " ";
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
  });
  return chunks.join("") + "data: [DONE]\n";
}

function fakeSession() {
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID,
      email: "test@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

test.describe("Onboarding first-prompt flow", () => {
  test("appears in chat and streams an assistant reply end-to-end", async ({ page, context }) => {
    // Track that the auto-send actually POSTed to /api/chat.
    const chatCalls: { body: string }[] = [];

    // ----- Stub Supabase auth + REST -----
    await context.route(
      new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/v1/.*`),
      async (route: Route) => {
        const req = route.request();
        const url = req.url();
        const method = req.method();
        const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");

        // Auth endpoints
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
        if (url.includes("/auth/v1/logout")) {
          return route.fulfill({ status: 204, body: "" });
        }

        // REST tables
        if (url.includes("/rest/v1/workspaces")) {
          if (method === "GET") {
            const row = {
              id: WS_ID,
              name: "Test Brand",
              website_url: null,
              industry: null,
              onboarded_at: "2024-01-01T00:00:00Z",
              first_prompt: FIRST_PROMPT,
            };
            return route.fulfill({
              status: 200,
              headers: JSON_HEADERS,
              body: JSON.stringify(wantsSingle ? row : [row]),
            });
          }
          // PATCH/POST/DELETE � succeed silently.
          return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
        }

        if (url.includes("/rest/v1/chat_messages")) {
          if (method === "GET") {
            return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
          }
          return route.fulfill({ status: 201, headers: JSON_HEADERS, body: "[]" });
        }

        if (url.includes("/rest/v1/content_items")) {
          return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
        }

        // Any other table read/write � empty success.
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: wantsSingle ? "null" : "[]",
        });
      },
    );

    // ----- Stub app API endpoints -----
    await context.route("**/api/clarify", (route) => {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ needs_clarification: false }),
      });
    });

    await context.route("**/api/chat", (route) => {
      chatCalls.push({ body: route.request().postData() ?? "" });
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: sseFor(ASSISTANT_REPLY),
      });
    });

    // TanStack server functions � respond empty so nothing throws.
    await context.route("**/_serverFn/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
    );

    // ----- Seed session + workspace selection before app boot -----
    await page.addInitScript(
      ({ storageKey, sess, wsId, host }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sess));
          window.localStorage.setItem("workspace:selected", wsId);
          // Belt-and-braces: neutralize any stale first-prompt lock so the guard doesn't skip.
          window.localStorage.removeItem(`raval:first-prompt-fired:${wsId}`);
          // Silence realtime websocket noise � not needed for this test.
          const origWS = window.WebSocket;
          // @ts-expect-error test-only stub
          window.WebSocket = function () {
            return {
              addEventListener() {},
              removeEventListener() {},
              send() {},
              close() {},
              readyState: 3,
            };
          };
          // Reference host so linter doesn't complain about unused param.
          void host;
          void origWS;
        } catch {
          /* noop */
        }
      },
      { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID, host: SUPABASE_HOST },
    );

    // ----- Drive the app -----
    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // 1. The auto-send pipeline should render BOTH the user bubble (the
    //    onboarding prompt) and the streamed assistant reply. The transient
    //    "Kicking off�" indicator is intentionally not asserted here because
    //    with mocked instant responses it may render for < a frame.
    await expect(page.getByText(FIRST_PROMPT, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(ASSISTANT_REPLY, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 2. /api/chat was actually called with the onboarding prompt in history.
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    expect(chatCalls[0].body).toContain(FIRST_PROMPT);

    // 3. Composer re-enables once streaming completes and the busy placeholder is gone.
    await expect(page.getByPlaceholder(/Ask Mellox AI/i).first()).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByPlaceholder(/Sending your onboarding prompt/i)).toHaveCount(0);
    await expect(page.getByText(/Kicking off your first request/i)).toHaveCount(0);

    // 4. Per-workspace lock is set so a remount would NOT re-fire.
    const lock = await page.evaluate(
      (wsId) => window.localStorage.getItem(`raval:first-prompt-fired:${wsId}`),
      WS_ID,
    );
    expect(lock).toBe("1");
  });
});
