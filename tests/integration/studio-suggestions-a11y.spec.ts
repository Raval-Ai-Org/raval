import { test, expect, type Route } from "@playwright/test";

/**
 * Accessibility contract for Studio suggestion cards + the "Try" action.
 *
 *   1. Every card exposes:
 *        - an accessible name on Try (aria-label="Run suggestion: <label>")
 *        - a native tooltip on the card body (title="<label> — <hint>")
 *        - a native tooltip on the label span (title="<label>")
 *        - a native tooltip on the hint  span (title="<hint>")
 *        - an accessible name AND title on Dismiss
 *   2. Tab order visits, per card in DOM order:
 *        card-body button → Try button → Dismiss button
 *      (no skipped / trapped controls; no positive tabindex).
 *   3. Both Enter and Space activate the Try button and dispatch the
 *      suggestion's window event — same contract mouse clicks use.
 *   4. Dismiss is keyboard-activatable and removes the card.
 *
 * The "integration" Playwright project runs Chromium in CI, but these
 * assertions (ARIA name lookups, keyboard activation, native `title`
 * attributes) are engine-agnostic and pass under Firefox/WebKit when
 * that project list is expanded.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
const WS_ID = "00000000-0000-0000-0000-000000000001";
const JSON_HEADERS = { "content-type": "application/json" };

function fakeSession() {
  return {
    access_token: "fake",
    refresh_token: "fake",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "00000000-0000-0000-0000-000000000002",
      email: "t@e.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

async function stubSupabase(context: import("@playwright/test").BrowserContext) {
  await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
    if (url.includes("/auth/v1/user"))
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession().user) });
    if (url.includes("/auth/v1/token"))
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession()) });
    if (url.includes("/rest/v1/workspaces")) {
      const row = { id: WS_ID, name: "Test", website_url: null, industry: null, onboarded_at: "2024-01-01T00:00:00Z", first_prompt: null };
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(wantsSingle ? row : [row]) });
    }
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: wantsSingle ? "null" : "[]" });
  });
  await context.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );
}

async function seed(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ storageKey, sess, wsId }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
        window.localStorage.setItem("workspace:selected", wsId);
        window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        window.localStorage.removeItem("studio:suggest-dismissed");
        // No cached AI items — we rely on the deterministic suggestions the
        // hook always produces from Supabase counts (all 0 in this stub).
        window.localStorage.removeItem(`studio:suggestions:${wsId}`);
        // @ts-expect-error test stub
        window.WebSocket = function () {
          return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
        };
        (window as unknown as { __ev: string[] }).__ev = [];
        for (const k of [
          "chat:prefill", "chat:focus",
          "open:brand-dna", "open:client-portal", "open:content-calendar",
          "open:canvas", "geo:run-audit",
        ]) {
          window.addEventListener(k, () => {
            (window as unknown as { __ev: string[] }).__ev.push(k);
          });
        }
      } catch { /* noop */ }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

/** Read every rendered suggestion card straight from the DOM. */
async function readCards(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const tries = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Run suggestion: "]')];
    return tries.map((tryBtn) => {
      // Card container: the `.group` ancestor wraps body + try + dismiss.
      const card = tryBtn.closest(".group") as HTMLElement | null;
      const bodyBtn = card?.querySelector<HTMLButtonElement>('button[title*="—"]') ?? null;
      const dismissBtn = card?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss suggestion"]') ?? null;
      const labelSpan = bodyBtn?.querySelector<HTMLSpanElement>("span[title]:not([title=''])") ?? null;
      const spans = bodyBtn ? [...bodyBtn.querySelectorAll<HTMLSpanElement>("span[title]")] : [];
      return {
        label: tryBtn.getAttribute("aria-label")!.replace(/^Run suggestion: /, ""),
        tryAria: tryBtn.getAttribute("aria-label"),
        bodyTitle: bodyBtn?.getAttribute("title") ?? null,
        labelSpanTitle: spans[0]?.getAttribute("title") ?? null,
        hintSpanTitle: spans[1]?.getAttribute("title") ?? null,
        dismissAria: dismissBtn?.getAttribute("aria-label") ?? null,
        dismissTitle: dismissBtn?.getAttribute("title") ?? null,
        // Neither of the three should have tabindex >= 1 (no positive tabindex).
        positiveTabindex: [bodyBtn, tryBtn, dismissBtn]
          .filter(Boolean)
          .some((el) => Number(el!.getAttribute("tabindex") ?? "0") > 0),
      };
    });
  });
}

test.describe("Studio suggestion a11y", () => {
  test.beforeEach(async ({ context, page }) => {
    await stubSupabase(context);
    await seed(page);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Run suggestion:/ }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("every card exposes accessible names + native tooltip titles", async ({ page }) => {
    const cards = await readCards(page);
    expect(cards.length).toBeGreaterThan(0);

    for (const c of cards) {
      expect(c.tryAria, `Try aria-label for ${c.label}`).toBe(`Run suggestion: ${c.label}`);
      expect(c.bodyTitle, `body title for ${c.label}`).toMatch(new RegExp(`^${c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — .+`));
      expect(c.labelSpanTitle, `label span title for ${c.label}`).toBe(c.label);
      expect(c.hintSpanTitle, `hint span title for ${c.label}`).toBeTruthy();
      // hint span title matches what the body title ends with.
      expect(c.bodyTitle!.endsWith(` — ${c.hintSpanTitle}`)).toBe(true);
      expect(c.dismissAria).toBe("Dismiss suggestion");
      expect(c.dismissTitle).toBe("Dismiss");
      expect(c.positiveTabindex).toBe(false);
    }
  });

  test("tab order per card: body → Try → Dismiss, in DOM order", async ({ page }) => {
    const cards = await readCards(page);
    // Focus the first card's body button, then walk forward with Tab.
    const firstBodySelector = `button[title="${cards[0].bodyTitle}"]`;
    await page.locator(firstBodySelector).focus();

    const expected: string[] = [];
    for (const c of cards) {
      expected.push(`body:${c.label}`);
      expected.push(`try:${c.label}`);
      expected.push("dismiss");
    }

    const classify = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "none";
        const aria = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        if (aria.startsWith("Run suggestion: ")) return `try:${aria.slice("Run suggestion: ".length)}`;
        if (aria === "Dismiss suggestion") return "dismiss";
        if (title.includes(" — ")) return `body:${title.split(" — ")[0]}`;
        return `other:${el.tagName}:${aria || title}`;
      });

    const seen: string[] = [await classify()];
    for (let i = 1; i < expected.length; i++) {
      await page.keyboard.press("Tab");
      seen.push(await classify());
    }
    expect(seen).toEqual(expected);
  });

  test("Enter activates the Try button (keyboard = click)", async ({ page }) => {
    const cards = await readCards(page);
    // Pick a card whose event we listen for; the deterministic list always
    // contains "Run AI visibility audit" (fires geo:run-audit) when the
    // stubbed workspace has no recent audit — which is the default here.
    const target = cards.find((c) => /visibility audit/i.test(c.label)) ?? cards[0];
    const tryBtn = page.getByRole("button", { name: `Run suggestion: ${target.label}` });
    await tryBtn.focus();
    await page.evaluate(() => { (window as unknown as { __ev: string[] }).__ev = []; });
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __ev: string[] }).__ev.length > 0), { timeout: 3_000 })
      .toBe(true);
  });

  test("Space activates the Try button (keyboard = click)", async ({ page }) => {
    const cards = await readCards(page);
    const target = cards.find((c) => /Brand DNA/i.test(c.label)) ?? cards[0];
    const tryBtn = page.getByRole("button", { name: `Run suggestion: ${target.label}` });
    await tryBtn.focus();
    await page.evaluate(() => { (window as unknown as { __ev: string[] }).__ev = []; });
    await page.keyboard.press("Space");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __ev: string[] }).__ev.length > 0), { timeout: 3_000 })
      .toBe(true);
  });

  test("Dismiss is keyboard-activatable and removes the card", async ({ page }) => {
    const cards = await readCards(page);
    const target = cards[cards.length - 1];
    const tryBtn = page.getByRole("button", { name: `Run suggestion: ${target.label}` });
    await tryBtn.focus();
    // Tab from Try → Dismiss (next control in the card).
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") || "");
    expect(focused).toBe("Dismiss suggestion");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: `Run suggestion: ${target.label}` })).toHaveCount(0, { timeout: 3_000 });
  });
});
