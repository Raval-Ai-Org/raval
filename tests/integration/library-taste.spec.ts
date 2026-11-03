import { test, expect, type Page } from "@playwright/test";

// The Library shows every picture at its true shape and lets the team love a
// post (ADR-0038). Lab fixtures only: external traffic and API calls are blocked.
test.use({ bypassCSP: true });

async function openLab(page: Page, query: string) {
  await page.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Local UI fixture" } }),
  );
  await page.goto(`/studio-lab?scene=library&${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.getByTestId("library-tile").first()).toBeVisible();
}

for (const theme of ["light", "dark"]) {
  test(`Library tiles are never cropped and hearts work in ${theme}`, async ({ page }) => {
    await openLab(page, `theme=${theme}`);
    const grid = page.getByTestId("library-grid");

    // Every loaded picture fills a tile of its own shape.
    await expect
      .poll(async () =>
        grid
          .locator('img[data-testid="library-tile-media"]')
          .evaluateAll(
            (imgs) =>
              (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth).length,
          ),
      )
      .toBeGreaterThan(2);
    const mismatches = await grid
      .locator('img[data-testid="library-tile-media"]')
      .evaluateAll((imgs) =>
        (imgs as HTMLImageElement[])
          .filter((i) => i.complete && i.naturalWidth)
          .map((i) => {
            const box = i.getBoundingClientRect();
            return Math.abs(box.width / box.height - i.naturalWidth / i.naturalHeight);
          })
          .filter((d) => d > 0.03),
      );
    expect(mismatches).toEqual([]);

    await expect(page.getByTestId("library-new").first()).toBeVisible();
    await expect(page.getByTestId("library-taste")).toBeVisible();

    // Love a post that isn't loved yet.
    const tiles = grid.getByTestId("library-tile");
    const index = (
      await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-reaction")))
    ).indexOf("");
    expect(index).toBeGreaterThanOrEqual(0);
    const tile = tiles.nth(index);
    await tile.hover();
    await tile.getByRole("button", { name: "Love", exact: true }).click();
    await expect(tile).toHaveAttribute("data-reaction", "love");
    await expect(tile.getByTestId("library-loved-badge")).toBeVisible();
    await tile.getByRole("button", { name: "Loved", exact: true }).click();
    await expect(tile).toHaveAttribute("data-reaction", "");

    // Less like this lives in the ••• menu.
    await tile.hover();
    await tile.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Less like this" }).click();
    await expect(tile).toHaveAttribute("data-reaction", "less");

    // The Loved tab only shows loved posts.
    await page.getByRole("tab", { name: /Loved/ }).click();
    const shown = grid.getByTestId("library-tile");
    await expect(shown.first()).toBeVisible();
    const reactions = await shown.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-reaction")),
    );
    expect(reactions.length).toBeGreaterThan(0);
    expect(reactions.every((r) => r === "love")).toBe(true);
  });
}

test("Library fits a phone without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLab(page, "device=phone&theme=dark");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const tabs = page.getByRole("tablist", { name: "Library filter" });
  const fits = await tabs.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  // Every tile keeps a heart and the ••• menu.
  const tile = page.getByTestId("library-tile").first();
  await expect(tile.getByRole("button", { name: /^Loved?$/ })).toBeVisible();
  await expect(tile.getByRole("button", { name: "More", exact: true })).toBeVisible();
});
