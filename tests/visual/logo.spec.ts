import { expect, test } from "@playwright/test";

/**
 * Visual regression guard for the Mellox AI brand lockup (<Logo />).
 *
 * The Logo scales fluidly via CSS clamp() between a mobile floor and a
 * desktop ceiling. These tests lock the *proportions* and *bounds* so an
 * accidental font-size / height / clamp tweak surfaces immediately:
 *
 *   1. Bounding-box height stays inside the expected clamp() envelope for
 *      the current viewport width.
 *   2. Mark : wordmark size ratio stays within a tight tolerance
 *      (mark height � 82% of lockup height by design).
 *   3. A screenshot of the header logo is diffed against a stored baseline
 *      (per project/viewport). First run creates the baseline; later runs
 *      fail on visual drift larger than the pixel/ratio threshold.
 *
 * Run:  bun run test:visual            (all viewports)
 *       bun run test:visual:update     (refresh baselines after an intended change)
 */

// Envelope derived from src/components/brand/Logo.tsx clamp() formula:
//   desktop = heightProp             // default heightProp = 18px
//   mobile  = desktop * 0.78         //                          ? 10.53px
// Fluid between 360px (mobile) and 1280px (desktop) viewport widths.
function expectedLogoHeight(viewportWidth: number, heightProp = 18) {
  const desktop = heightProp;
  const mobile = desktop * 0.78;
  const t = Math.max(0, Math.min(1, (viewportWidth - 360) / (1280 - 360)));
  return mobile + (desktop - mobile) * t;
}

test.describe("Logo � size regression", () => {
  test("landing header logo fits its clamp envelope", async ({ page, viewport }) => {
    await page.goto("/");
    const logo = page.getByRole("img", { name: "Mellox AI" }).first();
    await expect(logo).toBeVisible();

    const box = await logo.boundingBox();
    expect(box, "logo has a bounding box").not.toBeNull();

    // Landing header renders <Logo height={28} /> � see src/routes/index.tsx.
    const expected = expectedLogoHeight(viewport!.width, 28);
    // �2px tolerance covers subpixel rounding + browser layout differences.
    expect(Math.abs(box!.height - expected)).toBeLessThanOrEqual(2);

    // Mark : lockup ratio (mark should be ~82% of overall height).
    const markBox = await logo.locator("img").first().boundingBox();
    expect(markBox).not.toBeNull();
    const ratio = markBox!.height / box!.height;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.9);
  });

  test("landing header logo matches visual baseline", async ({ page }) => {
    await page.goto("/");
    const logo = page.getByRole("img", { name: "Mellox AI" }).first();
    await expect(logo).toBeVisible();
    // Wait for web fonts so the wordmark isn't measured mid-swap.
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(logo).toHaveScreenshot("landing-header-logo.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
