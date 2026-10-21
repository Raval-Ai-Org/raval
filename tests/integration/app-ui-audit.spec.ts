import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prepareAppUi, openAppUi } from "../fixtures/app-ui";

const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const screenshots = path.resolve(".tmp-run/ui-audit/workspace");
for (const theme of ["light", "dark"] as const) {
  test(`workspace in ${theme}: responsive chrome, navigation and dialogs`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.stack || e.message));
    await prepareAppUi(page, theme);
    await mkdir(screenshots, { recursive: true });
    await openAppUi(page);
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*\bdark\b)/);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(350);
      await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, `${theme} ${size.width}: workspace overflow`).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: path.join(screenshots, `workspace-${theme}-${size.width}.png`),
        animations: "disabled",
      });
    }
    // Both account identity and authenticated billing must finish loading:
    // an auth listener that re-enters getUser can stall these session calls.
    const account = page.getByRole("button", { name: "Account — Alex Morgan" });
    await expect(account).toBeVisible();
    await expect(page.getByText("500", { exact: true }).first()).toBeVisible();
    await account.click();
    await page
      .getByRole("menuitem", { name: theme === "light" ? "Dark mode" : "Light mode" })
      .click();
    await expect(page.locator("html")).toHaveClass(theme === "light" ? /dark/ : /^(?!.*\bdark\b)/);
    await page
      .getByRole("menuitem", { name: theme === "light" ? "Light mode" : "Dark mode" })
      .click();
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*\bdark\b)/);
    await page.keyboard.press("Escape");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        await page.getByRole("button", { name: "Open menu", exact: true }).click();
        await expect(page.locator("#app-inline-nav")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#app-inline-nav")).toHaveCount(0);
      }
      for (const event of [
        "open:analytics",
        "open:content-calendar",
        "open:share",
        "open:publish",
        "open:settings",
        "open:create-launcher",
      ]) {
        await page.evaluate((evt) => window.dispatchEvent(new CustomEvent(evt)), event);
        const dialog = page.getByRole("dialog").last();
        await expect(dialog, event).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(400);
        const box = await dialog.boundingBox();
        expect(box!.x, event).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width, event).toBeLessThanOrEqual(width + 1);
        expect(box!.y, event).toBeGreaterThanOrEqual(-1);
        expect(box!.y + box!.height, event).toBeLessThanOrEqual(901);
        await page.screenshot({
          path: path.join(screenshots, `${event.replace("open:", "")}-${theme}-${width}.png`),
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10000 });
        await expect
          .poll(() =>
            page.evaluate(() =>
              document.body ? document.body.hasAttribute("data-scroll-locked") : true,
            ),
          )
          .toBe(false);
        await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible({
          timeout: 30_000,
        });
      }
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("open:settings", { detail: { section: "website" } })),
      );
      const connections = page.getByRole("dialog");
      await expect(connections).toBeVisible();
      await page.screenshot({
        path: path.join(screenshots, `connections-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(connections).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
