import { test, expect } from "@playwright/test";

test("Clarity's queue exists before its remote tag executes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
  await page.route("https://www.clarity.ms/tag/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `if(typeof window.clarity!=="function") throw new Error("Clarity queue is missing");
      window.clarity("event","qa-bootstrap");
      window.__clarityQueued=window.clarity.q.length;`,
    }),
  );
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect
    .poll(
      () => page.evaluate(() => (window as Window & { __clarityQueued?: number }).__clarityQueued),
      { timeout: 60_000 },
    )
    .toBe(1);
  await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
