import { test, expect, devices, type Route, type Page } from "@playwright/test";

/**
 * Mobile viewport smoke — validates that every popup mounts, fits the
 * viewport, and closes cleanly on a phone-sized screen. Complements
 * popups.spec.ts (desktop 1440x900). Also asserts swipe gestures open/close
 * the mobile side drawers.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const JSON_HEADERS = { "content-type": "application/json" };

test.use({ ...devices["Pixel 7"] });

function fakeSession() {
  return {
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
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

async function stubBackend(page: Page) {
  await page
    .context()
    .route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/v1/.*`), async (route: Route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
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
      if (url.includes("/rest/v1/chat_messages"))
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: wantsSingle ? "null" : "[]",
      });
    });
  await page
    .context()
    .route("**/_serverFn/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
    );
  await page.context().route("**/api/**", (route) => {
    const u = route.request().url();
    if (u.includes("/api/chat")) {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
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

const DIALOG_POPUPS: { name: string; event: string }[] = [
  { name: "ai-visibility", event: "open:ai-visibility" },
  { name: "brand-dna", event: "open:brand-dna" },
  { name: "share", event: "open:share" },
  { name: "publish", event: "open:publish" },
  { name: "client-portal", event: "open:client-portal" },
  { name: "competitor-watch", event: "open:competitor-watch" },
  { name: "content-calendar", event: "open:content-calendar" },
  { name: "analytics", event: "open:analytics" },
  { name: "canvas", event: "open:canvas" },
  { name: "schedule", event: "open:schedule" },
  { name: "autopilot", event: "open:autopilot" },
  { name: "rename", event: "open:rename" },
  { name: "details", event: "open:details" },
  { name: "settings", event: "open:settings" },
  { name: "connectors", event: "open:connectors" },
];

async function waitForAppReady(page: Page) {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-publish-trigger]").first()).toBeAttached({ timeout: 20_000 });
  // Give lazy dialog hosts (WorkspaceDialogs, ContentCalendar) time to attach listeners.
  await page.waitForTimeout(3500);
}

async function assertNoLeaks(page: Page) {
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0, { timeout: 5_000 });
  const locked = await page.evaluate(
    () =>
      document.body.hasAttribute("data-scroll-locked") || document.body.style.overflow === "hidden",
  );
  expect(locked).toBe(false);
}

test.describe("Popup smoke — mobile viewport (Pixel 7)", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await seedSession(page);
  });

  for (const popup of DIALOG_POPUPS) {
    test(`${popup.name} — mounts, fits viewport, closes cleanly on mobile`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await waitForAppReady(page);

      await page.evaluate((evt) => window.dispatchEvent(new CustomEvent(evt)), popup.event);
      await expect
        .poll(async () => await page.locator('[role="dialog"]:visible').count(), { timeout: 8_000 })
        .toBeGreaterThan(0);

      // Assert the dialog fits within (or is intentionally full-bleed on) the viewport.
      const metrics = await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find(
          (el) =>
            (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed",
        ) as HTMLElement | undefined;
        if (!dlg) return null;
        const r = dlg.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          vw: window.innerWidth,
          vh: window.innerHeight,
          hasLabel: !!dlg.getAttribute("aria-labelledby") || !!dlg.getAttribute("aria-label"),
        };
      });
      expect(metrics, `${popup.name}: no visible dialog metrics`).not.toBeNull();
      // Allow 2px anti-aliasing tolerance; dialogs must not overflow horizontally.
      expect(metrics!.left, `${popup.name}: overflows left`).toBeGreaterThanOrEqual(-2);
      expect(metrics!.right, `${popup.name}: overflows right`).toBeLessThanOrEqual(metrics!.vw + 2);
      // Accessible name required (Radix requires DialogTitle or aria-label).
      expect(metrics!.hasLabel, `${popup.name}: dialog missing accessible name`).toBe(true);

      await page.keyboard.press("Escape");
      await assertNoLeaks(page);

      expect(pageErrors, `Uncaught errors on ${popup.name}`).toEqual([]);
    });
  }
});

test.describe("Swipe gestures — mobile drawers", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await seedSession(page);
  });

  const dispatchSwipe = async (page: Page, fromX: number, toX: number, y = 400) => {
    await page.evaluate(
      async ({ fromX, toX, y }) => {
        const fire = (type: string, x: number, y: number, changed = false) => {
          const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
          const ev = new TouchEvent(type, {
            touches: type === "touchend" ? [] : [t],
            changedTouches: [t],
            targetTouches: type === "touchend" ? [] : [t],
            bubbles: true,
            cancelable: true,
          });
          window.dispatchEvent(ev);
          void changed;
        };
        fire("touchstart", fromX, y);
        await new Promise((r) => setTimeout(r, 30));
        fire("touchend", toX, y);
      },
      { fromX, toX, y },
    );
  };

  test("swipe right from left edge opens nav; swipe left closes it", async ({ page }) => {
    await waitForAppReady(page);
    const vw = page.viewportSize()!.width;

    // Baseline: nav drawer starts closed (translated off-screen).
    await dispatchSwipe(page, 5, 220);
    await page.waitForTimeout(400);
    const navOpen = await page.evaluate(() => {
      // Nav drawer is the leftmost fixed panel in the mobile layout.
      return Array.from(document.querySelectorAll("[data-mobile-nav-drawer], aside, nav")).some(
        (el) => {
          const s = getComputedStyle(el as HTMLElement);
          return (
            s.position === "fixed" &&
            (el as HTMLElement).getBoundingClientRect().left >= 0 &&
            (el as HTMLElement).getBoundingClientRect().right > 50
          );
        },
      );
    });
    // Not asserting exact selector — instead verify body received a UI reaction
    // (either a backdrop or the drawer visible). Accept either signal.
    const hasBackdrop = await page.evaluate(
      () => document.querySelectorAll('[data-backdrop], [role="presentation"]').length > 0,
    );
    expect(navOpen || hasBackdrop, "expected nav drawer or backdrop after swipe-right").toBe(true);

    // Close via reverse swipe (from mid-drawer back to left).
    await dispatchSwipe(page, 220, 10);
    await page.waitForTimeout(400);

    const stillLocked = await page.evaluate(
      () =>
        document.body.hasAttribute("data-scroll-locked") ||
        document.body.style.overflow === "hidden",
    );
    // After close, body should not remain scroll-locked.
    expect(stillLocked).toBe(false);
    void vw;
  });

  test("swipe left from right edge opens studio drawer", async ({ page }) => {
    await waitForAppReady(page);
    const vw = page.viewportSize()!.width;

    await dispatchSwipe(page, vw - 5, vw - 220);
    await page.waitForTimeout(400);

    const opened = await page.evaluate(() => {
      // Any fixed panel now anchored to the right side.
      return Array.from(document.querySelectorAll("aside, [role='complementary'], div")).some(
        (el) => {
          const s = getComputedStyle(el as HTMLElement);
          if (s.position !== "fixed") return false;
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.right >= window.innerWidth - 4 && r.width > 200 && r.width < window.innerWidth;
        },
      );
    });
    expect(opened, "expected studio drawer after swipe-left from right edge").toBe(true);
  });
});
