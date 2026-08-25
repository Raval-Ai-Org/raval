// T035 — US2 e2e: publishing calls the real /api/sdr/publish proxy and shows
// the publishing state (SDR routes mocked, no live SDR).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openCanvas, openStudio } from "./sdr-common";

test.describe("Studio publish (US2)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("the social canvas renders its destination controls", async ({ page }) => {
    await openStudio(page);
    // Open a social-post canvas.
    await openCanvas(page, { type: "social-post" });
    await expect(page.getByText("Publish to · 3 platforms")).toBeVisible();
    await expect(page.getByRole("button", { name: /LinkedIn/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /X \/ Twitter/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Instagram/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Threads" })).toBeVisible();
  });
});
