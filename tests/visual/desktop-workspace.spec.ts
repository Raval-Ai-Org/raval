import { test, expect, type Route } from "@playwright/test";

/**
 * Desktop workspace visual regression.
 *
 * Snapshots the main /app screen — top bar (Analytics/Schedule/Autopilot/
 * Calendar/Share/Publish), ChatPanel empty state, site preview, and Studio
 * rail with its empty "Needs approval" panel — so future work that tries
 * to reintroduce loud/oversized CTAs, giant empty states, or reorganizes
 * the rail is caught by a pixel diff before it ships.
 *
 * Auth + backend + streaming APIs are stubbed at the network layer so the
 * test is deterministic and offline-safe. Animations, blinking cursors and
 * async live regions are disabled at snapshot time.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
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
      email: "test@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

test.describe("Desktop workspace visual", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("main /app screen matches baseline", async ({ page, context }) => {
    // --- Stub Supabase auth + REST so the workspace boots without network ---
    await context.route(
      new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/v1/.*`),
      async (route: Route) => {
        const req = route.request();
        const url = req.url();
        const method = req.method();
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
        if (url.includes("/auth/v1/logout")) {
          return route.fulfill({ status: 204, body: "" });
        }

        if (url.includes("/rest/v1/workspaces")) {
          if (method === "GET") {
            const row = {
              id: WS_ID,
              name: "Acme Studio",
              website_url: null,
              industry: null,
              onboarded_at: "2024-01-01T00:00:00Z",
              // NOTE: first_prompt intentionally null — we want the calm empty
              // chat state, not the mid-stream auto-send experience.
              first_prompt: null,
            };
            return route.fulfill({
              status: 200,
              headers: JSON_HEADERS,
              body: JSON.stringify(wantsSingle ? row : [row]),
            });
          }
          return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
        }

        // Empty datasets everywhere else — locks in the empty-state layout.
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: wantsSingle ? "null" : "[]",
        });
      },
    );

    // App endpoints — respond empty so nothing streams onto the page.
    await context.route("**/api/clarify", (route) =>
      route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ needs_clarification: false }),
      }),
    );
    await context.route("**/api/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: "data: [DONE]\n",
      }),
    );
    await context.route("**/api/geo-audit", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" }),
    );
    await context.route("**/_serverFn/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
    );

    // Seed session + workspace + saved chat width so layout is deterministic.
    await page.addInitScript(
      ({ storageKey, sess, wsId }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sess));
          window.localStorage.setItem("workspace:selected", wsId);
          window.localStorage.setItem("workspace:name", "Acme Studio");
          window.localStorage.setItem("chat:width", "360");
          window.localStorage.setItem("chat:collapsed", "0");
          window.localStorage.setItem("studio:open", "1");
          window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
          window.localStorage.setItem("reach-theme", "light");
          // Silence realtime websockets — irrelevant for a static snapshot.
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

    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // Wait for chrome — top-bar Publish and Studio rail — to render.
    await expect(page.getByRole("button", { name: /publish project/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /create a new canvas/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /open analytics/i }).first()).toBeVisible();

    // Freeze animations, hide caret, neutralize any live "just now" strings.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
        html { scroll-behavior: auto !important; }
      `,
    });

    // Let fonts + one paint settle so text metrics are stable across runs.
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(400);

    // Full desktop screen — top bar, chat, preview, studio rail.
    await expect(page).toHaveScreenshot("desktop-workspace.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});
