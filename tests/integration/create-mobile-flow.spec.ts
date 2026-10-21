import { expect, test } from "@playwright/test";

for (const { width, height } of [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
]) {
  test(`Create picker works at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/studio-lab?scene=brief-social&device=phone", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: "Close dialog", exact: true }) });
    await page.getByRole("button", { name: "Open Create" }).click();
    await expect(dialog).toBeVisible({ timeout: 60_000 });
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
