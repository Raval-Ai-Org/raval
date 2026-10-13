import { test, expect } from "@playwright/test";
for (const width of [390, 1440])
  test(`visual taste follows the existing UI at ${width}px`, async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrated|hydration|didn't match/i.test(message.text()))
        hydrationErrors.push(message.text());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/visual-taste-lab");
    await expect(page.getByRole("heading", { name: "Look & voice" })).toBeVisible();
    await expect(page.getByTestId("visual-taste-panel")).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Use editable text and layouts" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Keep this theme consistent" }),
    ).not.toBeChecked();
    await page.getByText("Review captured details", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Exclude", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use as reference", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByText("Review captured details", { exact: true }).click();
    await page.screenshot({ path: `.tmp-run/visual-taste-${width}-light.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: /Product first/ }).click();
    await expect(page.getByRole("button", { name: /Product first/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("switch", { name: "Use editable text and layouts" }).click();
    await expect(page.getByRole("switch", { name: "Use editable text and layouts" })).toBeChecked();
    await page.getByRole("button", { name: "Use this direction" }).click();
    await expect(
      page.getByText("Following Product first. New scans wait for your choice."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.tmp-run/visual-taste-${width}-dark.png`, fullPage: true });
    await page.getByRole("button", { name: "Use manual look", exact: true }).click();
    await expect(
      page.getByText("Following Product first. New scans wait for your choice."),
    ).not.toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });
