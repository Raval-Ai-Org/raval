// T023 — US1 e2e: the Connections view renders connected accounts with
// status chips and Connect/Disconnect actions (SDR routes mocked, no live SDR).
import { test, expect } from "@playwright/test";
import {
  loginAsTestUser,
  mockSdrRoutes,
  mockSupabase,
  openStudio,
  SDR_ACCOUNTS,
} from "./sdr-common";

test.describe("Studio Connections (US1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAsTestUser(page);
    await mockSupabase(context);
    await mockSdrRoutes(page);
  });

  test("hides Studio connections when accounts already exist", async ({ page }) => {
    await openStudio(page);
    await expect(page.getByText("Connections", { exact: true })).toHaveCount(0);
    // Connected identities are managed from Settings instead of the Studio rail.
    for (const acc of SDR_ACCOUNTS) {
      await expect(page.locator(`text=${acc.platform_username}`).first()).toHaveCount(0);
    }
  });

  test("offers a Connect action for platforms without an account", async ({ page }) => {
    await page.unroute("**/api/sdr/**");
    await mockSdrRoutes(page, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page);
    // The compact Studio rail opens the platform chooser on demand.
    await expect(page.getByRole("button", { name: "Connect social media" })).toBeVisible();
    await page.getByRole("button", { name: "Connect social media" }).click();
    await expect(page.getByRole("dialog")).toContainText("Connect social media");
    await expect(page.getByRole("button", { name: "Connect Instagram" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("opens the OAuth window from the connect click", async ({ page }) => {
    await page.unroute("**/api/sdr/**");
    await mockSdrRoutes(page, []);
    await openStudio(page);
    await page
      .context()
      .route("https://mock-oauth/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "OAuth consent mock" }),
      );
    await page.getByRole("button", { name: "Connect social media" }).click();
    await page.getByRole("button", { name: /Instagram/ }).click();
    await expect(page.getByRole("dialog")).toContainText("RavalAI will redirect you");
    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Continue to Instagram" }).click();
    const oauthPage = await popup;
    await expect(oauthPage).toHaveURL(/mock-oauth\/start/, { timeout: 10000 });
  });
});
