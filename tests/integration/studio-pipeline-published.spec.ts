import { expect, test } from "@playwright/test";

test("Studio keeps scheduled and published posts together with accurate delivery labels", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/studio-lab?scene=rail", { waitUntil: "domcontentloaded" });
  const pipeline = page.getByRole("region", { name: "Content pipeline" });
  const tab = pipeline.getByRole("tab", { name: "Scheduled & Published: 3", exact: true });
  await expect(tab).toBeVisible({ timeout: 60_000 });
  await tab.click();

  const scheduled = pipeline
    .getByRole("listitem")
    .filter({ hasText: "Is your cold brew under-extracted?" });
  await expect(scheduled).toBeVisible();
  await expect(scheduled.getByText(/Tomorrow|Today/)).toBeVisible();

  const published = pipeline
    .getByRole("listitem")
    .filter({ hasText: "Meet the farmers behind your coffee" });
  await expect(published.getByText("Published", { exact: true })).toBeVisible();
  await expect(published.getByRole("button", { name: "View delivery" })).toBeVisible();
  await expect(
    published.getByRole("button", { name: /Approve|Discard|Schedule or post/ }),
  ).toHaveCount(0);

  const publishing = pipeline.getByRole("listitem").filter({ hasText: "Fresh roast delivery" });
  await expect(publishing.getByText("Publishing", { exact: true })).toBeVisible();
  await expect(publishing.getByText("Published", { exact: true })).toHaveCount(0);
  await expect(pipeline.getByText(/1 published · 1 publishing/)).toBeVisible();
  await expect(
    pipeline.getByText("Pay the farmer, taste the difference", { exact: true }),
  ).toHaveCount(0);
});

test("Library supports the combined pipeline filter", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/studio-lab?scene=library", { waitUntil: "domcontentloaded" });
  const status = page.getByRole("combobox", { name: "Status", exact: true });
  await expect(status).toBeVisible({ timeout: 60_000 });
  await status.selectOption("scheduled-published");
  await expect(
    page.getByRole("button", { name: "Open content: Meet the farmers behind your coffee" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open content: Is your cold brew under-extracted?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open content: Fresh roast delivery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open content: Pay the farmer, taste the difference" }),
  ).toHaveCount(0);
});
