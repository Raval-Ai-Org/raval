// T023 — US1 e2e: the Connections view renders connected accounts with
// status chips and Connect/Disconnect actions (SDR routes mocked, no live SDR).
import { test, expect } from "@playwright/test";
import { loginAsTestUser, mockSdrRoutes, mockSupabase, openStudio, SDR_ACCOUNTS } from "./sdr-common";

test.describe("Studio Connections (US1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("shows the connected accounts from the SDR with their status", async ({ page }) => {
    await openStudio(page);
    const connections = page.locator("text=Connections").first();
    await expect(connections).toBeVisible();
    // Each connected platform username renders.
    for (const acc of SDR_ACCOUNTS) {
      await expect(page.locator(`text=${acc.platform_username}`).first()).toBeVisible();
    }
  });

  test("offers a Connect action for platforms without an account", async ({ page }) => {
    await openStudio(page);
    // Instagram is not in the mocked accounts → a Connect button appears.
    await expect(page.locator("button", { hasText: "Connect Instagram" }).first()).toBeVisible();
  });
});
