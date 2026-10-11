import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [390, 1440]) {
  test.describe(`Calendar controls at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    for (const theme of ["light", "dark"]) {
      test(`date, add and view actions stay independent in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem("mellox:theme", value), theme);
        await page.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
        await page.route("**/api/**", (route) =>
          route.fulfill({ status: 503, json: { error: "Local UI fixture" } }),
        );
        await page.goto("/calendar-lab", { waitUntil: "domcontentloaded" });
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("dialog", { name: "Content Calendar" })).toBeVisible({
          timeout: 60_000,
        });
        if (width === 1440) {
          const views = page.getByRole("group", { name: "Calendar view", exact: true });
          const month = views.getByRole("button", { name: /^month$/i });
          await month.focus();
          await month.press("Space");
          await expect(month).toHaveAttribute("aria-pressed", "true");
          const date = page.getByRole("button", { name: /^\w+, \w+ \d+, \d+ posts?$/ }).first();
          await date.focus();
          await date.press("Enter");
          await expect(page.getByRole("dialog", { name: "Edit post" })).toHaveCount(0);
        } else {
          // Compact calendars intentionally use the agenda, without month controls.
          const existing = page
            .getByRole("button", { name: /^Three ways to keep oat milk fresh/ })
            .first();
          await existing.focus();
          await existing.press("Enter");
          await expect(page.getByRole("dialog", { name: "Edit post" })).toBeVisible();
          await page.getByRole("button", { name: "Close post", exact: true }).click();
          await expect(page.getByRole("dialog", { name: "Edit post" })).toHaveCount(0);
        }
        const add =
          width === 1440
            ? page.getByRole("button", { name: /^Add a post on/ }).first()
            : page.getByRole("button", { name: "New post", exact: true });
        await add.focus();
        await add.press("Enter");
        await expect(page.getByRole("dialog", { name: "Edit post" })).toBeVisible();
        await page.getByRole("button", { name: "Close post", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Edit post" })).toHaveCount(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        await mkdir(path.resolve(".tmp-run/ui-audit/workspace"), { recursive: true });
        await page.screenshot({
          path: path.resolve(`.tmp-run/ui-audit/workspace/calendar-controls-${theme}-${width}.png`),
          animations: "disabled",
        });
      });
    }
  });
}
