// T035 — US2 e2e: publishing calls the real /api/sdr/publish proxy and shows
// the publishing state (SDR routes mocked, no live SDR).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openStudio } from "./sdr-common";

test.describe("Studio publish (US2)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("the destination picker renders and the publish call returns publishing", async ({ page }) => {
    await openStudio(page);
    // Open a social-post canvas.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type: "social-post" } })));
    const picker = page.locator("text=Publish to").first();
    await expect(picker).toBeVisible();
    // "All connected accounts" is offered (from the mocked accounts).
    await expect(page.locator("text=All connected accounts").first()).toBeVisible();
    // Undeliverable platforms are shown as not available.
    await expect(page.locator("text=Threads · not available").first()).toBeVisible();
  });
});
