import { expect, test } from "@playwright/test";

test("Studio shows inline account connection and platform expansion before publishing", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route("**/api/sdr/accounts**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/studio-lab", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.locator("select").first().selectOption("review-approved");
  await page.getByRole("button", { name: "Publish all" }).click();

  const dialog = page.getByRole("dialog", { name: "Publish your post" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Publish LinkedIn version" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Publish Instagram version" })).toBeChecked();
  await expect(dialog.getByText("No account connected")).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Publish all now" })).toBeDisabled();

  await dialog.getByText("Need versions for other platforms?").click();
  await expect(dialog.getByLabel("Facebook", { exact: true })).toBeVisible();
  await dialog.getByLabel("Facebook", { exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Generate selected versions" })).toBeEnabled();
});
