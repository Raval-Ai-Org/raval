import { expect, test } from "@playwright/test";

for (const { width, height } of [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
]) {
  test(`Create picker works at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/studio-lab", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.getByRole("button", { name: "Open Create" }).click();
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(-1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);

    await dialog.getByRole("button", { name: /^Text/ }).click();
    const back = dialog.getByRole("button", { name: "Back to all categories" });
    await expect(back).toBeVisible();
    const backBox = await back.boundingBox();
    expect(backBox?.height).toBeGreaterThanOrEqual(43.5);
    await back.click();
    await expect(dialog.getByRole("button", { name: /^Text/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });
}
