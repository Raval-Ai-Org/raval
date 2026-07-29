import { test, expect, type Page } from "@playwright/test";

/**
 * Responsive layout regression suite.
 *
 * Renders the main public routes at mobile / tablet / desktop breakpoints
 * and asserts:
 *   1. No horizontal overflow (body scrollWidth <= viewport width + 1).
 *   2. The page produced real content (not a blank shell).
 *   3. No console errors were raised during load.
 *
 * The workspace shell (/app) is not covered here because it requires an
 * authenticated Supabase session — see tests/integration/onboarding-*.
 */

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 900 },
  { name: "desktop-wide", width: 1440, height: 900 },
] as const;

const ROUTES = ["/", "/login", "/signup"] as const;

async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyText: document.body.innerText.trim().length,
  }));
  // Allow 1px of subpixel slack.
  expect(
    metrics.scrollWidth,
    `${label}: horizontal overflow (scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.bodyText, `${label}: page rendered no text`).toBeGreaterThan(20);
}

for (const bp of BREAKPOINTS) {
  test.describe(`layout @ ${bp.name} (${bp.width}x${bp.height})`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    for (const route of ROUTES) {
      test(`${route} has no overflow and renders`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.ok(), `HTTP ${response?.status()} for ${route}`).toBeTruthy();

        // Let hydration + first paint settle.
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(300);

        await assertNoOverflow(page, `${bp.name} ${route}`);

        // Filter noisy known-safe errors: favicons, analytics, benign
        // ResizeObserver loops, and dev-only React hydration warnings caused
        // by the source-tagging transform (data-tsd-source). Fail on real
        // app errors only.
        const meaningful = consoleErrors.filter(
          (e) =>
            !/favicon|manifest|analytics|Tracking Prevention|ResizeObserver loop/i.test(e) &&
            !/hydrat|data-tsd-source|Warning: Prop |did not match/i.test(e),
        );
        expect(meaningful, `${bp.name} ${route} console errors:\n${meaningful.join("\n")}`).toHaveLength(0);
      });
    }
  });
}
