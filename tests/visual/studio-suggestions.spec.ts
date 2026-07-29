import { test, expect, type Route } from "@playwright/test";

/**
 * Visual regression for the Studio rail "Suggestions for you" cards.
 *
 * Locks in the multi-line label/hint clamping and card spacing across the
 * two breakpoints where the rail is visible: tablet-landscape (xl, 1280px,
 * 300px rail) and desktop (2xl, 1440px, 316px rail). This catches regressions
 * where labels overflow the card, collapse to a single line without ellipsis,
 * or lose their two-line clamp.
 *
 * Auth + REST + streaming endpoints are stubbed exactly like the main desktop
 * workspace snapshot so runs are deterministic and offline-safe.
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

/**
 * Deterministic suggestions with a mix of short and deliberately long
 * labels/hints so the two-line clamp behavior is exercised in the pixel diff.
 */
const SEEDED_SUGGESTIONS = [
  {
    id: "seed-1",
    label: "Capture your Brand DNA to unlock personalised drafts",
    hint: "30s onboarding · powers every future generation",
    accent: "violet",
    icon: "Brain",
  },
  {
    id: "seed-2",
    label: "Run AI visibility audit",
    hint: "40-point GEO / AEO scan across your public surface area",
    accent: "blue",
    icon: "Search",
  },
  {
    id: "seed-3",
    label: "Plan this week's content across LinkedIn and Instagram",
    hint: "0 published in the last 7 days",
    accent: "green",
    icon: "Calendar",
  },
  {
    id: "seed-4",
    label: "Review 12 drafts",
    hint: "Approve or polish to keep momentum",
    accent: "amber",
    icon: "Wand2",
  },
];

type SeededSuggestion = {
  id: string;
  label: string;
  hint: string;
  accent: string;
  icon: string;
};

async function primeSuggestions(
  page: import("@playwright/test").Page,
  items: readonly SeededSuggestion[] = SEEDED_SUGGESTIONS,
) {
  // The hook exposes an internal cache keyed per workspace. Seeding it here
  // sidesteps supabase count queries + AI refresh so the rendered cards are
  // byte-identical every run.
  await page.addInitScript(
    ({ wsId, items }) => {
      try {
        window.localStorage.setItem(
          `studio:suggestions:${wsId}`,
          JSON.stringify({ at: Date.now(), items }),
        );
        window.localStorage.removeItem("studio:suggest-dismissed");
      } catch { /* noop */ }
    },
    { wsId: WS_ID, items },
  );
}

/**
 * Adversarial payloads that stress every failure mode we've hit historically:
 *   - Very long multi-word labels that must clamp to 2 lines.
 *   - Very long multi-word hints that must clamp to 1 line.
 *   - A single unbroken 60+ char "URL-ish" token that would blow out the
 *     card horizontally without break-words / overflow-wrap:anywhere.
 *   - Mixed CJK + emoji where line-box heights can drift on WebKit.
 *   - A minimal short row to prove the min-height keeps rows aligned even
 *     when neighbouring cards have wildly different content.
 * Every card must render at the same height as the shortest card — that's
 * what "row heights don't jitter" means in practice.
 */
const EXTREME_SUGGESTIONS: readonly SeededSuggestion[] = [
  {
    id: "x-long-label-and-hint",
    label:
      "Capture your Brand DNA to unlock personalised drafts across every channel including LinkedIn, Instagram, X, TikTok, newsletters and long-form SEO briefs",
    hint: "30s onboarding · powers every future generation with tone, voice and factual grounding baked in for every single downstream draft",
    accent: "violet",
    icon: "Brain",
  },
  {
    id: "x-unbroken-token",
    label:
      "Draft launch email for https://raval.ai/campaigns/2026-Q3-launch-superlongslug-nobreakpoints-anywhere",
    hint: "Uses supercalifragilisticexpialidocious-lookinglongtokenwithnowhitespaceatallseriously as the CTA",
    accent: "green",
    icon: "Calendar",
  },
  {
    id: "x-cjk-emoji-and-short-neighbour",
    label:
      "为您的品牌撰写介绍文案 ✨🚀 — Generate a bilingual brand intro that mixes 中文 and English with emoji",
    hint: "混合 CJK + emoji で行の高さが崩れないことを確認する 🧪",
    accent: "amber",
    icon: "Wand2",
  },
];


async function stubBackend(context: import("@playwright/test").BrowserContext) {
  await context.route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/v1/.*`), async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");

    if (url.includes("/auth/v1/user")) {
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession().user) });
    }
    if (url.includes("/auth/v1/token")) {
      return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(fakeSession()) });
    }
    if (url.includes("/auth/v1/logout")) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.includes("/rest/v1/workspaces")) {
      const row = {
        id: WS_ID,
        name: "Acme Studio",
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
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: wantsSingle ? "null" : "[]" });
  });

  await context.route("**/api/clarify", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ needs_clarification: false }) }),
  );
  await context.route("**/api/chat", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "data: [DONE]\n" }),
  );
  await context.route("**/api/geo-audit", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" }),
  );
  await context.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ data: null }) }),
  );
}

async function seedSession(page: import("@playwright/test").Page) {
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
        // @ts-expect-error test stub
        window.WebSocket = function () {
          return { addEventListener() {}, removeEventListener() {}, send() {}, close() {}, readyState: 3 };
        };
      } catch { /* noop */ }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession(), wsId: WS_ID },
  );
}

async function freezeVisuals(page: import("@playwright/test").Page) {
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
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(400);
}

/**
 * On <xl viewports the desktop rail is `hidden xl:flex` and the studio lives
 * inside a bottom sheet (`StudioBottomDock`). To pin down mobile card CSS
 * without depending on sheet-open animation timing, force the rail aside
 * visible and let it fill the mobile viewport — this mirrors exactly what
 * the sheet's `[&_aside]:!flex [&_aside]:!w-full` overrides do at runtime.
 */
async function forceRailVisibleForMobile(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      aside.hidden {
        display: flex !important;
        width: 100% !important;
        max-width: 100vw !important;
        padding: 8px !important;
      }
    `,
  });
}

const CASES = [
  { name: "mobile", viewport: { width: 375, height: 812 }, snapshot: "studio-suggestions-mobile.png", forceMobile: true },
  { name: "tablet", viewport: { width: 1280, height: 900 }, snapshot: "studio-suggestions-tablet.png", forceMobile: false },
  { name: "desktop", viewport: { width: 1440, height: 900 }, snapshot: "studio-suggestions-desktop.png", forceMobile: false },
] as const;

test.describe("Studio rail suggestion cards", () => {
  for (const c of CASES) {
    test(`${c.name} (${c.viewport.width}px) matches baseline`, async ({ page, context }) => {
      await page.setViewportSize(c.viewport);
      await stubBackend(context);
      await seedSession(page);
      await primeSuggestions(page);

      await page.goto("/app", { waitUntil: "domcontentloaded" });

      if (c.forceMobile) await forceRailVisibleForMobile(page);

      // Wait for the rail + the seeded suggestion cards to render.
      await expect(page.getByRole("button", { name: /create a new canvas/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("heading", { name: /suggestions for you/i })).toBeVisible({ timeout: 15_000 });
      // Ensure at least the seeded cards mounted before snapshotting.
      await expect(page.getByRole("button", { name: /Run suggestion:/i }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);

      await freezeVisuals(page);

      // Snapshot just the suggestions section — includes eyebrow header + all cards.
      const section = page
        .getByRole("heading", { name: /suggestions for you/i })
        .locator("xpath=ancestor::section[1]");
      await expect(section).toHaveScreenshot(c.snapshot, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});

/**
 * Adversarial content: extremely long labels/hints, unbroken tokens and
 * CJK+emoji. Guards against three regressions at once:
 *   1. Horizontal overflow — an unbroken URL/token pushing the card wider
 *      than the rail.
 *   2. Row-height jitter — a long card growing taller than a short card
 *      and misaligning the column.
 *   3. Line-clamp regressions — Safari specifically has bitten us before
 *      when Tailwind's `line-clamp-*` failed to emit `display:-webkit-box`.
 */
const EXTREME_CASES = [
  { name: "mobile", viewport: { width: 375, height: 812 }, snapshot: "studio-suggestions-extreme-mobile.png", forceMobile: true },
  { name: "tablet", viewport: { width: 1280, height: 900 }, snapshot: "studio-suggestions-extreme-tablet.png", forceMobile: false },
  { name: "desktop", viewport: { width: 1440, height: 900 }, snapshot: "studio-suggestions-extreme-desktop.png", forceMobile: false },
] as const;

// Card min-height in StudioRail.tsx is min-h-[72px]; a 1px tolerance covers
// sub-pixel rounding across engines.
const EXPECTED_CARD_HEIGHT = 72;
const HEIGHT_TOLERANCE = 1;

test.describe("Studio rail suggestion cards — extreme content", () => {
  for (const c of EXTREME_CASES) {
    test(`${c.name} (${c.viewport.width}px) never overflows or jitters`, async ({ page, context }) => {
      await page.setViewportSize(c.viewport);
      await stubBackend(context);
      await seedSession(page);
      await primeSuggestions(page, EXTREME_SUGGESTIONS);

      await page.goto("/app", { waitUntil: "domcontentloaded" });

      if (c.forceMobile) await forceRailVisibleForMobile(page);

      await expect(page.getByRole("button", { name: /create a new canvas/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("heading", { name: /suggestions for you/i })).toBeVisible({ timeout: 15_000 });
      // At minimum every seeded card must have mounted (the hook also merges
      // runtime-computed defaults, so allow >=).
      // Wait for every seeded card specifically — the hook merges seeded
      // aiItems into deterministic items asynchronously, so a simple count
      // check races the second render.
      const runButtons = page.getByRole("button", { name: /Run suggestion:/i });
      for (const seed of EXTREME_SUGGESTIONS) {
        await expect(
          page.getByRole("button", { name: `Run suggestion: ${seed.label}` }),
        ).toBeVisible({ timeout: 15_000 });
      }
      await expect
        .poll(async () => await runButtons.count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(EXTREME_SUGGESTIONS.length);
      await page.waitForTimeout(300);

      await freezeVisuals(page);

      // Structural assertions BEFORE the pixel snapshot so a genuine layout
      // regression fails with a readable message, not just a diff image.
      const metrics = await page.evaluate(() => {
        const runBtns = Array.from(
          document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Run suggestion:"]'),
        );
        return runBtns.map((run) => {
          // The card is the flex row containing the icon, text button and actions.
          const card = run.closest("div")!.parentElement as HTMLElement;
          const railWidth = (card.parentElement?.parentElement as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
          const textBtn = card.querySelector<HTMLButtonElement>("button[title]");
          const spans = Array.from(card.querySelectorAll<HTMLSpanElement>("button[title] > span"));
          const labelSpan = spans[0];
          const hintSpan = spans[1];
          return {
            cardHeight: Math.round(card.getBoundingClientRect().height),
            cardWidth: Math.round(card.getBoundingClientRect().width),
            railWidth: Math.round(railWidth),
            cardHorizOverflow: card.scrollWidth > card.clientWidth + 1,
            textBtnHorizOverflow: textBtn ? textBtn.scrollWidth > textBtn.clientWidth + 1 : false,
            labelClientH: labelSpan?.clientHeight ?? 0,
            hintClientH: hintSpan?.clientHeight ?? 0,
            labelClipped: labelSpan ? labelSpan.scrollHeight > labelSpan.clientHeight + 1 : false,
            hintClipped: hintSpan ? hintSpan.scrollHeight > hintSpan.clientHeight + 1 : false,
            labelTitle: labelSpan?.getAttribute("title") ?? "",
            hintTitle: hintSpan?.getAttribute("title") ?? "",
          };
        });
      });

      // The hook always merges runtime-computed defaults with our seeded
      // cache — we only care that every seeded extreme card is present and
      // well-behaved, so index by label.
      const bySeedLabel = new Map(metrics.map((m) => [m.labelTitle, m]));
      for (const seed of EXTREME_SUGGESTIONS) {
        expect(
          bySeedLabel.has(seed.label),
          `seeded card missing: ${seed.id}\n  looking for: ${seed.label}\n  rendered labels: ${JSON.stringify(Array.from(bySeedLabel.keys()), null, 2)}`,
        ).toBe(true);
      }
      const seededMetrics = EXTREME_SUGGESTIONS.map((s) => bySeedLabel.get(s.label)!);
      expect(seededMetrics).toHaveLength(EXTREME_SUGGESTIONS.length);

      const heights = metrics.map((m) => m.cardHeight);
      const minH = Math.min(...heights);
      const maxH = Math.max(...heights);

      // 1) Row-height jitter guard: every card is the same height.
      expect(maxH - minH, `card heights jitter: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
      // 2) Cards honour the min-h-[72px] contract exactly (no accidental growth).
      expect(minH).toBeGreaterThanOrEqual(EXPECTED_CARD_HEIGHT - HEIGHT_TOLERANCE);
      expect(maxH).toBeLessThanOrEqual(EXPECTED_CARD_HEIGHT + HEIGHT_TOLERANCE);

      for (const seed of EXTREME_SUGGESTIONS) {
        const m = bySeedLabel.get(seed.label)!;
        // 3) No horizontal overflow, even with unbroken URL/token labels.
        expect(m.cardHorizOverflow, `card ${seed.id} overflowed horizontally`).toBe(false);
        expect(m.textBtnHorizOverflow, `text button ${seed.id} overflowed horizontally`).toBe(false);
        expect(m.cardWidth, `card ${seed.id} wider than rail`).toBeLessThanOrEqual(m.railWidth);
        // 4) Line clamps hold: label ≤ 2 lines (~40px), hint ≤ 1 line (~18px).
        //    Bounds are generous to absorb font-metric drift across engines
        //    without letting a real regression slip through.
        expect(m.labelClientH, `label span for ${seed.id} exceeded 2 lines`).toBeLessThanOrEqual(40);
        expect(m.hintClientH, `hint span for ${seed.id} exceeded 1 line`).toBeLessThanOrEqual(18);
        // 5) Long text is actually being clipped (proves clamp is active,
        //    not just that the text happened to be short).
        if (seed.label.length > 40) {
          expect(m.labelClipped, `label for ${seed.id} should be clipped by line-clamp`).toBe(true);
        }
        if (seed.hint.length > 40) {
          expect(m.hintClipped, `hint for ${seed.id} should be clipped by line-clamp`).toBe(true);
        }
        // 6) Tooltip preservation: hovering must still surface the full text.
        expect(m.labelTitle).toBe(seed.label);
        expect(m.hintTitle).toBe(seed.hint);
      }

      const section = page
        .getByRole("heading", { name: /suggestions for you/i })
        .locator("xpath=ancestor::section[1]");
      await expect(section).toHaveScreenshot(c.snapshot, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});

