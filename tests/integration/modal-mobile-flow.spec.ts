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
  test(`analytics workspace modal fits at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/analytics-lab", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "In the modal" }).click();
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box ? box.x >= -1 && box.x + box.width <= width + 1 : false;
      })
      .toBe(true);
    const close = dialog.getByRole("button", { name: "Close dialog" });
    await expect(close).toBeVisible();
    const range = dialog.getByRole("group", { name: "Date range" });
    await expect(range).toBeVisible();
    const rangeBox = await range.boundingBox();
    expect(rangeBox?.x).toBeGreaterThanOrEqual(0);
    expect((rangeBox?.x ?? 0) + (rangeBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    if (width <= 320) {
      await range.getByRole("button", { name: "Custom" }).click();
      const apply = page.getByRole("button", { name: "Apply" });
      await expect(apply).toBeVisible();
      const applyBox = await apply.boundingBox();
      expect(applyBox?.x).toBeGreaterThanOrEqual(0);
      expect((applyBox?.x ?? 0) + (applyBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      await page.keyboard.press("Escape");
    }
    if (width < 1024) {
      // Measure after the popup's entrance scale animation has settled.
      await expect
        .poll(async () => {
          const box = await close.boundingBox();
          return box ? Math.min(box.width, box.height) : 0;
        })
        .toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Insights", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Insights" })).toBeVisible();
    await close.click();
    await expect(dialog).toHaveCount(0);
  });
}
