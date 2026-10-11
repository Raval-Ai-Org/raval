import { test, expect } from "@playwright/test";

// The lab's inline SVG assets are data: URLs. Production CSP deliberately
// excludes data: from connect-src, so allow fixture fetches for this UI test.
// All external traffic and API calls are still blocked below.
test.use({ bypassCSP: true });

for (const theme of ["light", "dark"]) {
  test(`Library actions stay independent with a keyboard in ${theme}`, async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Local UI fixture" } }),
    );
    await page.goto(`/studio-lab?scene=library&theme=${theme}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const download = page.locator('button[aria-label="Download"]:not([disabled])').first();
    await download.focus();
    await expect(download).toBeFocused();
    const downloaded = page.waitForEvent("download", { timeout: 15_000 });
    await download.press("Enter");
    await downloaded;
    // Download must not bubble its Enter key into opening the parent card.
    await expect(page.getByRole("button", { name: "Back to library", exact: true })).toHaveCount(0);
    const card = page.getByRole("button", { name: /^Open content:/ }).first();
    await card.focus();
    await card.press("Space");
    const back = page.getByRole("button", { name: "Back to library", exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect(back).toHaveCount(0);
  });
}
