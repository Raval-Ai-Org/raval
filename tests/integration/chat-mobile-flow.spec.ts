import { expect, test } from "@playwright/test";

for (const { width, height } of [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 540, height: 720 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
]) {
  test(`chat stays usable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/chat-lab", { waitUntil: "domcontentloaded" });
    const composer = page.getByRole("textbox", { name: "Message Mellox" });
    await expect(composer).toBeVisible();
    await expect(page.locator(".mx-greeting > span")).toHaveClass(/opacity-100/);
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);

    await composer.fill("First line");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    if (width < 768) {
      await composer.press("Enter");
      await expect(composer).toHaveValue("First line\n");
      await page.getByRole("button", { name: "Send" }).click();
    } else {
      await composer.press("Enter");
    }
    await expect(page.getByText("First line", { exact: true })).toBeVisible();
  });
}
