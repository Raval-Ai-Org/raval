import { test, expect, type Page } from "@playwright/test";

/**
 * MotionMox (ADR-0045), played with sample data at /motionmox-lab (dev only,
 * no sign-in). `?frame=` holds the player on one frame, so each element is
 * checked at the moment the plan puts it on screen.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function at(page: Page, query: string) {
  await page.goto(`/motionmox-lab${query}`, { waitUntil: "domcontentloaded" });
  const stage = page.locator("main .rounded-2xl");
  await expect(stage.locator("img").first()).toBeVisible({ timeout: 30_000 });
  return stage;
}

for (const vp of VIEWPORTS) {
  test.describe(`MotionMox lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("headline, badge and captions open the video", async ({ page }) => {
      const stage = await at(page, "?frame=60");
      await expect(stage).toContainText("Same-day plumbing");
      await expect(stage).toContainText("We fix it");
      await expect(stage).toContainText("the same day");
    });

    test("the price tag comes in mid-video, the button near the end", async ({ page }) => {
      await expect(await at(page, "?frame=150")).toContainText("From Rs 2,500");
      await expect(await at(page, "?frame=260")).toContainText("Book now");
    });

    test("turning an element off removes it", async ({ page }) => {
      const stage = await at(page, "?frame=60");
      await page.getByRole("button", { name: "Headline" }).click();
      await expect(stage).not.toContainText("Same-day plumbing");
    });

    test("no sideways scroll", async ({ page }) => {
      await at(page, "?frame=0&ratio=16:9");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
