import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Load axe-core's UMD bundle from disk so the test works offline (no CDN).
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/**
 * Light-theme regression suite.
 *
 * Guards against three classes of regression that we've fought before:
 *   1. "Pure white" canvas — the design uses a softly tinted paper
 *      (~hsl(220 22% 95.5%)). If someone flips --background back to
 *      100% L or 0 0% 100%, the eye-strain returns. We assert the body
 *      background is meaningfully darker than white.
 *   2. Pale hairline borders — --border must stay dark enough to be
 *      visible against the canvas (WCAG 1.4.11 non-text ≥ 3:1 for
 *      essential UI boundaries like input outlines).
 *   3. Any axe-core color-contrast violation on real, rendered DOM
 *      across the public routes we can hit unauthenticated.
 *
 * If an intended design change trips this, update the numeric thresholds
 * and re-run `bun run test:visual:update` to refresh screenshots.
 */

// ---- pure JS contrast helpers (kept inline so the spec is self-contained) ----

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) throw new Error(`Unparseable color: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function relLum([r, g, b]: [number, number, number]) {
  const chan = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrast(a: string, b: string) {
  const la = relLum(parseRgb(a));
  const lb = relLum(parseRgb(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

async function useLightTheme(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("reach-theme", "light");
    } catch {
      /* private mode etc. */
    }
  });
}

test.describe("Light theme — tokens & contrast", () => {
  test.use({ colorScheme: "light" });

  test("canvas is a tinted paper, not pure white", async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = parseRgb(bg);

    // Reject #fff or anything within a hair of pure white.
    expect(r, `canvas red channel: ${bg}`).toBeLessThanOrEqual(250);
    expect(g, `canvas green channel: ${bg}`).toBeLessThanOrEqual(250);
    expect(b, `canvas blue channel: ${bg}`).toBeLessThanOrEqual(250);
    // Should still be a *light* surface — reject accidental dark-theme leaks.
    const lum = relLum([r, g, b]);
    expect(lum).toBeGreaterThan(0.75);
  });

  test("body text hits WCAG AAA against canvas", async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    const { bg, fg } = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { bg: s.backgroundColor, fg: s.color };
    });
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(7);
  });

  test("hairline borders are visible on the canvas", async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    // Sample the first bordered card on the landing page.
    const probe = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        "div.rounded-2xl.border, div.rounded-xl.border, [class*='border-border']",
      );
      if (!el) return null;
      const s = getComputedStyle(el);
      const body = getComputedStyle(document.body);
      return {
        borderColor: s.borderTopColor,
        borderWidth: s.borderTopWidth,
        bodyBg: body.backgroundColor,
      };
    });
    expect(probe, "found at least one bordered card").not.toBeNull();
    expect(parseFloat(probe!.borderWidth)).toBeGreaterThan(0);
    // Non-text UI boundary: WCAG 1.4.11 targets 3:1. We allow a small
    // buffer (2.5:1) for softly decorative container edges.
    expect(contrast(probe!.borderColor, probe!.bodyBg)).toBeGreaterThanOrEqual(2.5);
  });

  test("primary CTA label hits WCAG AA on its surface", async ({ page }) => {
    await useLightTheme(page);
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    const cta = page.getByRole("link", { name: /get started/i }).first();
    await expect(cta).toBeVisible();
    const { color, background } = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });

  for (const route of ["/", "/login", "/signup", "/reset-password"] as const) {
    test(`axe-core color-contrast has no violations on ${route}`, async ({ page }) => {
      await useLightTheme(page);
      await page.goto(route);
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      await page.waitForTimeout(400);

      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        // @ts-expect-error injected global
        const result = await axe.run(document, {
          runOnly: { type: "rule", values: ["color-contrast"] },
          resultTypes: ["violations"],
        });
        return result.violations.map((v: any) => ({
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n: any) => ({
            target: n.target,
            summary: (n.failureSummary || "").split("\n").pop(),
          })),
        }));
      });
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }
});

test.describe("Light theme — visual baselines", () => {
  test.use({ colorScheme: "light" });

  for (const route of ["/", "/login", "/signup"] as const) {
    test(`baseline: ${route}`, async ({ page }) => {
      await useLightTheme(page);
      await page.goto(route);
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      // Wait for web fonts so text metrics are stable.
      await page.evaluate(() => (document as any).fonts?.ready);
      await page.waitForTimeout(400);

      await expect(page).toHaveScreenshot(
        `light${route === "/" ? "-landing" : route.replace("/", "-")}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.02 },
      );
    });
  }
});
