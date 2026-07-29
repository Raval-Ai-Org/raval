import { test, expect, type Route } from "@playwright/test";

/**
 * Verifies that clicking each Studio suggestion card dispatches the
 * expected window event (chat:prefill, open:client-portal, open:canvas,
 * open:content-calendar, open:brand-dna, geo:run-audit). This is the
 * "platform is actually integrated" contract for the suggestion rail.
 */

const SUPABASE_HOST = "nfgbofcxoqapaileqhon.supabase.co";
const STORAGE_KEY = "sb-nfgbofcxoqapaileqhon-auth-token";
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

/**
 * One deterministic suggestion per event we care about. `intent` + `prompt`
 * match the shape the loadAi cache reader expects so `run()` reconstructs
 * to a call to `runIntent(intent, prompt)`.
 */
const SUGGESTIONS = [
  { id: "s-geo",     label: "Run AI visibility audit", hint: "40-point scan",              accent: "blue",   icon: "Search",   intent: "geo-audit",     prompt: "" },
  { id: "s-dna",     label: "Capture your Brand DNA",   hint: "30s unlocks drafts",         accent: "violet", icon: "Brain",    intent: "brand-dna",     prompt: "" },
  { id: "s-drafts",  label: "Review drafts",            hint: "Approve or polish",          accent: "amber",  icon: "Wand2",    intent: "review-drafts", prompt: "" },
  { id: "s-share",   label: "Share with a client",      hint: "Approvals in one link",      accent: "rose",   icon: "Share2",   intent: "share",         prompt: "" },
  { id: "s-brief",   label: "Draft your first SEO brief", hint: "AEO-friendly question",    accent: "blue",   icon: "FileText", intent: "seo-brief",     prompt: "" },
  { id: "s-plan",    label: "Plan this week's content", hint: "0 published in 7 days",      accent: "green",  icon: "Calendar", intent: "plan-week",     prompt: "Plan this week's content." },
];

test.describe("Studio suggestions wiring", () => {
  test("each suggestion click dispatches the right window event", async ({ page, context }) => {
    // ---- Supabase stubs ----
    await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/.*`), async (route: Route) => {
      const req = route.request();
      const url = req.url();
      const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
      if (url.includes("/auth/v1/user")) return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession().user) });
      if (url.includes("/auth/v1/token")) return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession()) });
      if (url.includes("/rest/v1/workspaces")) {
        const row = { id: WS_ID, name: "Test", website_url: null, industry: null, onboarded_at: "2024-01-01T00:00:00Z", first_prompt: null };
        return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(wantsSingle ? row : [row]) });
      }
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: wantsSingle ? "null" : "[]" });
    });

    await context.route("**/_serverFn/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
    );

    // ---- Seed session + suggestion cache + event capture ----
    await page.addInitScript(
      ({ storageKey, sess, wsId, items }) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(sess));
          window.localStorage.setItem("workspace:selected", wsId);
          window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
          // Cache in the new shape the hook expects (intent+prompt so run() reconstructs).
          window.localStorage.setItem(
            `studio:suggestions:${wsId}`,
            JSON.stringify({ at: Date.now(), items }),
          );
          // Neutralize realtime.
          // @ts-expect-error test stub
          window.WebSocket = function () {
            return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
          };
          // Capture events dispatched by suggestion clicks.
          (window as unknown as { __ev: string[] }).__ev = [];
          const kinds = [
            "chat:prefill", "chat:focus",
            "open:brand-dna", "open:client-portal", "open:content-calendar",
            "open:canvas", "geo:run-audit",
          ];
          for (const k of kinds) {
            window.addEventListener(k, () => {
              (window as unknown as { __ev: string[] }).__ev.push(k);
            });
          }
        } catch { /* noop */ }
      },
      { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID, items: SUGGESTIONS },
    );

    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // The rail renders in xl+ viewports. Playwright default is 1440×900 so it's visible.
    // Wait for at least one suggestion card to appear.
    await expect(page.getByRole("button", { name: /Run suggestion:/ }).first()).toBeVisible({ timeout: 15_000 });

    const clickAndExpect = async (labelRe: RegExp, expectedEvent: string) => {
      const btn = page.getByRole("button", { name: labelRe }).first();
      await btn.click();
      await expect
        .poll(async () =>
          page.evaluate((k) => (window as unknown as { __ev: string[] }).__ev.includes(k), expectedEvent),
          { timeout: 3_000 },
        )
        .toBe(true);
      // Reset captured events and dismiss any modal/panel that opened so the
      // next Try button in the rail is clickable.
      await page.evaluate(() => { (window as unknown as { __ev: string[] }).__ev = []; });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    };

    await clickAndExpect(/Run suggestion: Run AI visibility audit/, "geo:run-audit");
    await clickAndExpect(/Run suggestion: Capture your Brand DNA/, "open:brand-dna");
    await clickAndExpect(/Run suggestion: Review drafts/, "open:content-calendar");
    await clickAndExpect(/Run suggestion: Share with a client/, "open:client-portal");
    await clickAndExpect(/Run suggestion: Draft your first SEO brief/, "open:canvas");
    await clickAndExpect(/Run suggestion: Plan this week's content/, "chat:prefill");
  });
});
