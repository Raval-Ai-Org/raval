// "Brand my clips" in Studio: the captions switch is offered (on by default)
// and the price on the button is the clip price in credits, never video
// credits (the brand's own footage uses no video provider).
import { expect, test } from "@playwright/test";

test("brand my clips offers captions and shows the clip price", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/studio-lab?scene=brief-own-clips");
  await page.getByRole("button", { name: /More settings/ }).click();
  const captions = page.getByRole("switch", { name: "Captions" });
  await expect(captions).toBeVisible();
  await expect(captions).toHaveAttribute("data-state", "checked");
  await expect(
    page.getByText("Mellox picks the best part of each", { exact: false }),
  ).toBeVisible();
  const footer = page.locator("footer").last();
  await expect(footer).toContainText("45 credits");
  await expect(footer).not.toContainText("video credit");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("own-clips-mobile.png"), fullPage: true });
});
