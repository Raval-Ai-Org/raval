import { expect, test } from "@playwright/test";

test.setTimeout(90_000);

for (const width of [320, 390, 768, 1440]) {
  test(`Library filters and billing labels fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
    await page.goto("/studio-lab?scene=library&device=phone", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    const library = page.locator('[class*="@container/library"]');
    const bounds = await library.boundingBox();
    const metadata = library.getByTestId("library-post-meta");
    await expect(metadata.first()).toBeVisible();
    expect(
      await metadata.evaluateAll((rows) =>
        rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
      ),
    ).toBe(true);
    for (const control of [
      library.getByRole("combobox", { name: "Status", exact: true }),
      library.getByRole("combobox", { name: "Sort", exact: true }),
      library.getByRole("radio", { name: "Grid view", exact: true }),
      library.getByRole("radio", { name: "List view", exact: true }),
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    await library.getByRole("radio", { name: "List view", exact: true }).click();
    await expect(library.getByRole("radio", { name: "List view", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const yearly = page.locator(".px-toggle button").filter({ hasText: "Yearly" });
    await expect(yearly).toBeVisible();
    const fits = await yearly.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
  });
}
