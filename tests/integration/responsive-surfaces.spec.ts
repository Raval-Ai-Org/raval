import { expect, test, type Page } from "@playwright/test";
import { openAppUi, prepareAppUi } from "../fixtures/app-ui";

test.setTimeout(90_000);

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
});

// Check inside the actual surfaces: hiding body overflow alone cannot catch
// buttons cut off by a card, a modal body, or a narrow toolbar.
async function clippedControls(page: Page) {
  return page.evaluate(() => {
    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, input, select, [role=tab]")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || el.closest('[aria-hidden="true"]')) continue;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        // An intentional horizontal scroller makes its controls reachable.
        if (style.overflowX === "auto" || style.overflowX === "scroll") break;
        const bounds = parent.getBoundingClientRect();
        if (
          (style.overflowX === "hidden" || style.overflowX === "clip") &&
          (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)
        ) {
          clipped.push(el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
          break;
        }
      }
    }
    return clipped;
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test.describe(`surface controls at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("analytics tables scroll inside cards without clipping their actions", async ({
      page,
    }) => {
      await page.goto("/analytics-lab", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Top landing pages" })).toBeVisible({
        timeout: 60_000,
      });
      await expect.poll(() => clippedControls(page)).toEqual([]);
      for (const name of ["All pages", "All terms"]) {
        const action = await page.getByRole("button", { name, exact: true }).boundingBox();
        expect(action!.x + action!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    });

    test("workspace chat and navigation fit the screen", async ({ page }) => {
      await prepareAppUi(page, "light");
      await openAppUi(page);
      await expect.poll(() => clippedControls(page)).toEqual([]);
      const composer = await page.getByRole("textbox", { name: "Message Mellox" }).boundingBox();
      expect(composer!.x).toBeGreaterThanOrEqual(-1);
      expect(composer!.x + composer!.width).toBeLessThanOrEqual(viewport.width + 1);
    });

    test("calendar navigation, search and filter menu remain reachable", async ({ page }) => {
      await page.goto("/calendar-lab", { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog").first();
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeVisible();
      await expect.poll(() => clippedControls(page)).toEqual([]);

      await page.getByRole("button", { name: "Search posts", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Search posts" })).toBeVisible();
      await expect.poll(() => clippedControls(page)).toEqual([]);

      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const menu = page.locator("[data-radix-popper-content-wrapper]").last();
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect.poll(() => clippedControls(page)).toEqual([]);
    });

    for (const scene of ["home", "strategy", "look"] as const) {
      test(`Brain ${scene} fits its surface`, async ({ page }) => {
        await page.goto(`/brain-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="brain-lab-frame"]')).toHaveAttribute(
          "data-ready",
          "true",
          { timeout: 60_000 },
        );
        await expect.poll(() => clippedControls(page)).toEqual([]);
      });
    }
  });
}
