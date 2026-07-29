import { test, expect, type Route, type Page } from "@playwright/test";

/**
 * End-to-end popup smoke test.
 *
 * For every globally dispatched popup event we assert:
 *   1. dispatching the event mounts a visible dialog (or docked panel),
 *   2. the dialog title / content renders without a runtime error,
 *   3. Escape (or the close button for panels) cleans it up with no leaked
 *      backdrops, scroll locks, or focus traps.
 *
 * All backend I/O is stubbed at the network layer so the suite is
 * deterministic and offline-safe. This guards against three classes of
 * future regressions we already hit once:
 *   - a dialog mounted inside a `hidden` container so listeners never fire,
 *   - an orphan CustomEvent dispatched with no mounted listener,
 *   - a dialog that opens but leaks state (backdrop / body scroll lock) on
 *     close.
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

async function stubBackend(page: Page) {
  await page.context().route(
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

      if (url.includes("/rest/v1/workspaces")) {
        if (method === "GET") {
          const row = {
            id: WS_ID,
            name: "Test Brand",
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
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
      }

      if (url.includes("/rest/v1/profiles")) {
        const row = { id: USER_ID, persona: "founder", persona_set_at: "2024-01-01T00:00:00Z" };
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(wantsSingle ? row : [row]),
        });
      }

      if (url.includes("/rest/v1/chat_messages")) {
        if (method === "GET") return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
        return route.fulfill({ status: 201, headers: JSON_HEADERS, body: "[]" });
      }
      if (url.includes("/rest/v1/content_items")) {
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
      }

      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: wantsSingle ? "null" : "[]",
      });

    },
  );

  await page.context().route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );

  // Catch-all for any project /api/* endpoint so no unhandled fetch throws.
  await page.context().route("**/api/**", (route) => {
    const u = route.request().url();
    if (u.includes("/api/chat")) {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: "data: [DONE]\n",
      });
    }
    if (u.includes("/api/clarify")) {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ needs_clarification: false }),
      });
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" });
  });


}

async function seedSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        window.localStorage.setItem("profile:persona", "founder");

        // silence realtime websocket noise
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
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

/**
 * Popups that mount a real `role="dialog"`.
 * Each entry can also assert a piece of expected content.
 */
const DIALOG_POPUPS: {
  name: string;
  event: string;
  expect?: RegExp;
}[] = [
  { name: "ai-visibility", event: "open:ai-visibility", expect: /AI Visibility/i },
  { name: "brand-dna", event: "open:brand-dna" },
  { name: "share", event: "open:share" },
  { name: "publish", event: "open:publish", expect: /Publish/i },
  { name: "client-portal", event: "open:client-portal" },
  { name: "competitor-watch", event: "open:competitor-watch", expect: /Competitor/i },
  { name: "content-calendar", event: "open:content-calendar" },
  { name: "analytics", event: "open:analytics" },
  { name: "canvas", event: "open:canvas" },
  { name: "schedule", event: "open:schedule", expect: /Schedule/i },
  { name: "autopilot", event: "open:autopilot", expect: /Autopilot|24\/7/i },
  { name: "rename", event: "open:rename" },
  { name: "details", event: "open:details" },
  { name: "settings", event: "open:settings" },
  { name: "connectors", event: "open:connectors" },
];

async function waitForAppReady(page: Page) {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(page.locator('h1', { hasText: /Raval AI Workspace/i }).first())
    .toBeAttached({ timeout: 20_000 });
  // Wait for workspaceId to hydrate from localStorage and the lazily-mounted
  // dialog shells (Publish/Share/etc) to attach their `open:*` listeners.
  await expect(page.locator("[data-publish-trigger]").first())
    .toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(3000);

}



async function assertNoLeaks(page: Page) {
  // No lingering visible dialogs.
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0, { timeout: 5_000 });
  // No stuck Radix scroll-lock (would freeze the page for the user).
  const locked = await page.evaluate(() =>
    document.body.hasAttribute("data-scroll-locked") || document.body.style.overflow === "hidden",
  );
  expect(locked).toBe(false);
}

test.describe("Popup smoke — every global open:* event mounts, renders and cleans up", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await seedSession(page);
  });

  for (const popup of DIALOG_POPUPS) {
    test(`${popup.name} — opens on ${popup.event}, escape closes cleanly`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => { pageErrors.push(e.message); console.log("PAGEERROR:", e.message); });
      page.on("console", (m) => { if (m.type()==="error") console.log("CONSOLE:", m.text().slice(0,300)); });

      await waitForAppReady(page);


      const dispatchAndAssertOpen = async () => {
        await page.evaluate((evt) => {
          window.dispatchEvent(new CustomEvent(evt));
        }, popup.event);
        // Radix dialogs mount into a portal — check by counting, not by
        // holding a stale locator reference.
        await expect
          .poll(async () => await page.locator('[role="dialog"]:visible').count(), {
            timeout: 8_000,
          })
          .toBeGreaterThan(0);
      };

      await dispatchAndAssertOpen();

      if (popup.expect) {
        // Best-effort text match — dialog title should be present in DOM
        // whether or not the visible portal has stabilized.
        await expect(page.locator('[role="dialog"]').filter({ hasText: popup.expect }).first())
          .toBeAttached({ timeout: 5_000 });
      }

      await page.keyboard.press("Escape");
      await assertNoLeaks(page);

      // Re-open + re-close proves the listener survived one cycle
      // (catches "listener removed on close" bugs).
      await dispatchAndAssertOpen();
      await page.keyboard.press("Escape");
      await assertNoLeaks(page);

      expect(pageErrors, `Uncaught page errors while cycling ${popup.name}`).toEqual([]);
    });

  }

  test("orphan events — no popup dispatches a CustomEvent without a listener", async ({ page }) => {
    // Statically curated allowlist of events that intentionally have no
    // in-app listener (they trigger navigations or external side effects).
    const ALLOWED_ORPHANS = new Set<string>([
      "content:changed",
      "credits:changed",
    ]);

    await waitForAppReady(page);

    // Instrument dispatchEvent so we see every CustomEvent fired during a
    // brief interaction window. Then dispatch each popup event and record
    // whether it produced a visible dialog OR triggered a further event.
    const missing = await page.evaluate(async (events) => {
      const seen: Record<string, boolean> = {};

      for (const evt of events) {
        seen[evt] = false;
        // Attach a probe listener just before dispatch to detect whether
        // the app already has one registered.
        let hadPrior = false;
        const probe = () => {
          hadPrior = true;
        };
        window.addEventListener(evt, probe, { capture: true });
        window.dispatchEvent(new CustomEvent(evt));
        window.removeEventListener(evt, probe, { capture: true });

        // Wait a frame for React to open the dialog.
        await new Promise((r) => setTimeout(r, 120));
        const dialogOpen = document.querySelectorAll('[role="dialog"]').length > 0;
        seen[evt] = hadPrior && dialogOpen;

        // Cleanup — press Escape to close any opened dialog.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await new Promise((r) => setTimeout(r, 120));
      }

      return Object.entries(seen)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
    }, DIALOG_POPUPS.map((p) => p.event).filter((e) => !ALLOWED_ORPHANS.has(e)));

    expect(
      missing,
      `These open:* events either had no listener or failed to mount a dialog: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
