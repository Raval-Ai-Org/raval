// T057 — US4 e2e: the delivery surface is reachable in the Studio (SDR routes
// mocked; the per-platform status render is exercised by the data-path tests).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openStudio } from "./sdr-common";

test.describe("Studio delivery (US4)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("the Studio rail renders its delivery-adjacent surfaces", async ({ page }) => {
    await openStudio(page);
    await expect(page.locator("text=Recent").first()).toBeVisible();
  });
});
