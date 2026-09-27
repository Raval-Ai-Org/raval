import { expect, test } from "@playwright/test";

for (const { width, height } of [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 540, height: 720 },
  { width: 667, height: 375 },
]) {
  test(`Studio phone controls remain reachable at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/studio-lab", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await page.getByRole("combobox", { name: "Window size" }).selectOption("phone");

    const close = page.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    expect((closeBox?.x ?? 0) + (closeBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);

    const frame = page.locator('[data-testid="studio-lab-frame"]');
    const frameBox = await frame.boundingBox();
    expect(frameBox?.x).toBeGreaterThanOrEqual(0);
    expect((frameBox?.x ?? 0) + (frameBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);

    await page.locator("select").first().selectOption("brief-social");
    const goal = page.getByRole("group", { name: "Goal" }).getByRole("button").first();
    await expect(goal).toBeVisible();
    const goalBox = await goal.boundingBox();
    expect(goalBox?.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
  });
}
