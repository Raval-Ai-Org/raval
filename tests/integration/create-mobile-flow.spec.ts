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
    expect(box?.y).toBeGreaterThanOrEqual(-1);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height + 1);
    expect(
      await dialog.evaluate((element) => {
        const body = element.lastElementChild as HTMLElement;
        return body.scrollHeight <= body.clientHeight + 1;
      }),
    ).toBe(true);

    for (const [category, format] of [
      ["Video", "Creator video ad"],
      ["Picture", "Image post"],
      ["Text", "Social post"],
    ]) {
      await dialog.getByRole("button", { name: new RegExp(`^${category}`) }).click();
      await expect(dialog.getByRole("button", { name: new RegExp(`^${format}`) })).toBeVisible();
      const back = dialog.getByRole("button", { name: "Back to all categories" });
      const backBox = await back.boundingBox();
      expect(backBox?.height).toBeGreaterThanOrEqual(43.5);
      await back.click();
      await expect(dialog.getByRole("button", { name: new RegExp(`^${category}`) })).toBeVisible();
    }

    for (const category of ["Stories", "Ads"]) {
      await dialog.getByRole("button", { name: new RegExp(`^${category}`) }).click();
      await expect(page.getByText("Choose a workspace first").first()).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Back to all categories" })).toHaveCount(0);
    }

    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });
}
