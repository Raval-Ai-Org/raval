// T047 — US3 e2e: the canvas Schedule action calls the /api/sdr/schedule proxy
// (SDR routes mocked).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openCanvas, openStudio } from "./sdr-common";

test.describe("Studio schedule (US3)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("the canvas exposes the Schedule action", async ({ page }) => {
    await openStudio(page);
    await openCanvas(page, { type: "social-post" });
    await expect(page.locator("button", { hasText: "Schedule" }).first()).toBeVisible();
  });
});
