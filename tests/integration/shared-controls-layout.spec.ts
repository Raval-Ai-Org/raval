import { expect, test, type Locator } from "@playwright/test";
import { prepareAppUi } from "../fixtures/app-ui";

async function inViewport(element: Locator, width: number, height: number) {
  await expect
    .poll(async () => {
      const b = await element.boundingBox();
      return b
        ? b.x >= -2 && b.x + b.width <= width + 2 && b.y >= -2 && b.y + b.height <= height + 2
        : false;
    })
    .toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 390, height: 844 },
    { width: 667, height: 375 },
    { width: 1440, height: 900 },
  ]) {
    test(`shared controls ${theme} ${viewport.width}px: long labels, menus and confirmation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await prepareAppUi(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/layout-lab?scene=controls", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("control-stress");
      await expect(frame).toBeVisible({ timeout: 60_000 });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      const longButton = frame.getByRole("button", {
        name: "Try loading all of your website connections and social accounts again",
      });
      expect
        .soft(
          await longButton.evaluate((el) => el.scrollHeight - el.clientHeight),
          "Button clips its wrapped label",
        )
        .toBeLessThanOrEqual(2);
      const tabs = frame.getByRole("tablist");
      const frameBox = (await frame.boundingBox())!;
      const tabBox = (await tabs.boundingBox())!;
      expect
        .soft(tabBox.x + tabBox.width, "Tab strip spills out of its card")
        .toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
      expect
        .soft(
          await tabs.evaluate((el) => {
            const b = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll('[role="tab"]')).every((tab) => {
              const r = tab.getBoundingClientRect();
              return (
                r.left >= b.left - 1 &&
                r.right <= b.right + 1 &&
                r.top >= b.top - 1 &&
                r.bottom <= b.bottom + 1
              );
            });
          }),
          "Tab controls extend beyond their background",
        )
        .toBe(true);
      await page.screenshot({
        path: `test-results/controls-${theme}-${viewport.width}.png`,
        fullPage: true,
      });

      const select = frame.getByRole("combobox", { name: "Connected workspace" });
      expect
        .soft(
          await select.evaluate((el) => el.scrollWidth - el.clientWidth),
          "Select's long value pushes past its chevron",
        )
        .toBeLessThanOrEqual(2);
      await select.click();
      const choices = page.getByRole("listbox");
      await inViewport(choices, viewport.width, viewport.height);
      await page.getByRole("option", { name: /^https:\/\/northwind/ }).click();
      await expect(select).toContainText("https://northwind");

      await frame.getByRole("button", { name: "Workspace actions" }).click();
      const menu = page.getByRole("menu").first();
      await inViewport(menu, viewport.width, viewport.height);
      await page.getByRole("menuitem", { name: "Connected social accounts" }).hover();
      const submenu = page.getByRole("menu").last();
      await expect(submenu.getByRole("menuitem")).toHaveCount(12);
      await inViewport(submenu, viewport.width, viewport.height);
      await submenu
        .getByRole("menuitem", { name: "Northwind regional account 12", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        submenu.getByRole("menuitem", { name: "Northwind regional account 12", exact: true }),
      ).toBeInViewport();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // Narrow-screen overlap must retain Radix's keyboard navigation.
      await frame.getByRole("button", { name: "Workspace actions" }).click();
      await page.mouse.move(0, 0);
      const subTrigger = page.getByRole("menuitem", { name: "Connected social accounts" });
      await subTrigger.focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("menu")).toHaveCount(2);
      await expect(page.getByRole("menu").last().getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByRole("menu")).toHaveCount(1);
      await expect(subTrigger).toBeFocused();
      await page.keyboard.press("Escape");

      await frame.getByRole("button", { name: "Connection details", exact: true }).hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      // Radix's accessible tooltip is hidden; measure its visible content.
      const tooltipContent = tooltip.locator("..");
      await inViewport(tooltipContent, viewport.width, viewport.height);
      await page.mouse.move(0, 0);

      await frame.getByRole("button", { name: "Review connection change" }).click();
      const confirmation = page.getByRole("alertdialog");
      await inViewport(confirmation, viewport.width, viewport.height);
      const keep = confirmation.getByRole("button", { name: "Keep connection" });
      await keep.scrollIntoViewIfNeeded();
      await keep.click();
      await expect(confirmation).toHaveCount(0);
    });
  }
}
