// T064 — US5 e2e: with the SDR feature flag off, publish degrades to today's
// mock (status flip) — the platform never regresses. The flag is server-side,
// so this asserts the UI still renders its publish surfaces (the degrade logic
// is unit-tested in T062/T063).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openStudio } from "./sdr-common";

test.describe("Non-regression (US5)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("the Studio shell and publish surfaces still render", async ({ page }) => {
    await openStudio(page);
    await expect(page.locator("text=Connections").first()).toBeVisible();
  });
});
