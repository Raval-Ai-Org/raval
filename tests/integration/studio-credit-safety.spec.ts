import { expect, test } from "@playwright/test";

test("Studio shows revision prices, source photos and the script-to-video handoff", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Local UI fixture" } }),
  );
  await page.goto("/studio-lab", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const scenes = page.locator("select").first();
  await scenes.selectOption("review-image");
  await expect(page.getByRole("button", { name: /New take · 30 credits/ })).toBeVisible();
  await expect(page.getByText("Improve · 4 credits", { exact: true })).toBeVisible();
  await scenes.selectOption("review-script");
  await expect(page.getByRole("button", { name: "Make video", exact: true })).toBeVisible();
  await expect(page.getByText("Your script is ready.", { exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "Window size" }).selectOption("phone");
  await page.screenshot({ path: testInfo.outputPath("script-video-mobile.png"), fullPage: true });
  await scenes.selectOption("brief-template");
  await expect(page.getByRole("button", { name: "Upload photo", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose from Library", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Uploading is free.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Upload photo", exact: true }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("reference-photos-mobile.png"),
    fullPage: true,
  });
  await scenes.selectOption("review-carousel");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Slide 1 heading", exact: true })
    .fill("A clearer heading");
  const updateVisuals = page.getByRole("button", {
    name: "Update visuals · 30 credits",
    exact: true,
  });
  await expect(updateVisuals).toBeVisible();
  await updateVisuals.scrollIntoViewIfNeeded();
  const updateBox = await updateVisuals.boundingBox();
  expect(updateBox?.x).toBeGreaterThanOrEqual(0);
  expect((updateBox?.x ?? 0) + (updateBox?.width ?? 0)).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: testInfo.outputPath("priced-visual-update-mobile.png"),
    fullPage: true,
  });
});
