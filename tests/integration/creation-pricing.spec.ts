import { expect, test } from "@playwright/test";

test("creation pricing and included edits fit a phone without starting paid work", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  let paidRequests = 0;
  await page.route("**/api/**", (route) => {
    if (
      route.request().method() === "POST" &&
      /\/api\/studio\/jobs$/.test(new URL(route.request().url()).pathname)
    )
      paidRequests++;
    return route.fulfill({ status: 503, json: { error: "Local fixture" } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio-lab", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
  await page.getByRole("combobox", { name: "Window size" }).selectOption("phone");
  const scene = page.locator("select").first();
  await scene.selectOption("brief-creation");
  await expect(
    page
      .locator('[data-slot="cost-chip"]')
      .filter({ hasText: /2 (creation )?points/ })
      .first(),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await scene.selectOption("review-creation");
  await expect(
    page.getByRole("button", { name: /Same description, a new version · 2 creation points/ }),
  ).toBeVisible();
  await expect(page.getByText("Words · Included caption edit", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("included-edits-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 280, height: 653 });
  await scene.selectOption("brief-creation");
  const generate = page.getByRole("button", { name: "Generate", exact: true });
  await expect(generate).toBeVisible();
  const box = await generate.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(281);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(paidRequests).toBe(0);
});
