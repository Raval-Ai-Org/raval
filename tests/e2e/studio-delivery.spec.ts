// T057/T061 — US4 e2e: the per-platform delivery view renders in the Studio.
// Opens a social content item in the canvas (view mode) and asserts the
// delivery panel shows each destination's status + live link + failure reason.
// SDR routes are mocked (sdr-common.ts returns SDR_PUBLICATIONS for any item),
// so the spec runs WITHOUT a live SDR. Executed under the T078 harness.
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openStudio } from "./sdr-common";

test.describe("Studio delivery view (US4)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("opens a published social item and shows per-platform delivery status", async ({ page }) => {
    await openStudio(page);

    // Open a social content item in view mode — the canvas modal mounts the
    // DeliveryView for any social item with a persisted content-item id.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("open:canvas", { detail: { type: "social-post", id: "item-e2e", mode: "view" } }),
      );
    });
    await page.waitForTimeout(700); // let the canvas modal mount

    // Delivery panel header.
    await expect(page.locator("text=Delivery").first()).toBeVisible();

    // LinkedIn destination: published + live link.
    await expect(page.locator("text=LinkedIn").first()).toBeVisible();
    await expect(page.locator("text=Published").first()).toBeVisible();
    await expect(page.locator("a[href='https://linkedin.com/posts/1']")).toBeVisible();

    // X destination: failed + the surfaced reason.
    await expect(page.locator("text=X").first()).toBeVisible();
    await expect(page.locator("text=Failed").first()).toBeVisible();
    await expect(page.locator("text=Duplicate content").first()).toBeVisible();
  });
});
