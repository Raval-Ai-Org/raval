import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);
const brandA = "00000000-0000-4000-8000-000000000001";
const brandB = "00000000-0000-4000-8000-000000000003";
const empty = () => ({ ready: [], scheduled: [], website: [], problems: [] });
const queued = (title: string) => ({
  ...empty(),
  ready: [
    {
      key: "post",
      group: "ready",
      title,
      detail: "Post · approved",
      at: null,
      contentItemId: "post",
    },
  ],
});

async function openPublish(page: Page) {
  await page.route("https://**", (route) => route.abort());
  await page.goto("/layout-lab?scene=publish", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open publish" }).click();
  await expect(page.getByRole("dialog", { name: "Publish", exact: true })).toBeVisible();
}

test("partial failures do not falsely present a complete empty publish list", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/rpc/publish/getPublishQueue", (route) => {
    calls++;
    return route.fulfill({
      json: {
        result:
          calls === 1
            ? { ...empty(), unavailableSources: ["Articles", "Website fixes"] }
            : queued("Recovered article"),
      },
    });
  });
  await openPublish(page);
  await expect(page.getByText("The list is incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing waiting to go out", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Some work couldn't be loaded" }),
  ).toContainText("Articles, Website fixes");
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByText("Recovered article", { exact: true })).toBeVisible();
  await expect(page.getByText("The list is incomplete", { exact: true })).toHaveCount(0);
});

test("an older request cannot overwrite a newer publish list", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let oldFinished = false;
  await page.route("**/api/rpc/publish/getPublishQueue", async (route) => {
    calls++;
    if (calls === 1) {
      await gate;
      await route.fulfill({ json: { result: queued("Old response") } });
      oldFinished = true;
    } else await route.fulfill({ json: { result: queued("Newest response") } });
  });
  await openPublish(page);
  await expect.poll(() => calls).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("content:changed")));
  await expect(page.getByText("Newest response", { exact: true })).toBeVisible();
  release();
  await expect.poll(() => oldFinished).toBe(true);
  await expect(page.getByText("Newest response", { exact: true })).toBeVisible();
  await expect(page.getByText("Old response", { exact: true })).toHaveCount(0);
});

test("a pending response from another brand never appears after switching workspace", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  let oldFinished = false;
  await page.route("**/api/rpc/publish/getPublishQueue", async (route) => {
    const brand = route.request().postDataJSON().data.workspaceId as string;
    calls.push(brand);
    if (brand === brandA) {
      await gate;
      await route.fulfill({ json: { result: queued("Brand A private post") } });
      oldFinished = true;
    } else await route.fulfill({ json: { result: queued("Brand B post") } });
  });
  await openPublish(page);
  await expect.poll(() => calls.length).toBe(1);
  // Simulate a workspace prop change while the modal's request is pending.
  await page
    .getByTestId("switch-publish-brand")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText("Brand B post", { exact: true })).toBeVisible();
  release();
  await expect.poll(() => oldFinished).toBe(true);
  expect(calls).toEqual([brandA, brandB]);
  await expect(page.getByText("Brand A private post", { exact: true })).toHaveCount(0);
});

for (const initialStatus of ["draft", "pending", "scheduled", "publishing"]) {
  test(`content review handles a ${initialStatus} post safely`, async ({ page }) => {
    let status = initialStatus;
    const writes: string[] = [];
    await page.route("**/api/rpc/publish/getPublishQueue", (route) =>
      route.fulfill({ json: { result: queued("Review this post") } }),
    );
    await page.route("**/api/rpc/content/updateContentItem", (route) => {
      const next = route.request().postDataJSON().data.patch.status as string;
      writes.push(next);
      expect(status === "draft" && next === "rejected").toBe(false);
      status = next;
      return route.fulfill({ json: { result: { id: "post", status } } });
    });
    await openPublish(page);
    // Register after the broad offline route so this synthetic read takes precedence.
    await page.route("**/rest/v1/content_items?*", (route) =>
      route.fulfill({
        json: {
          id: "post",
          title: "Review this post",
          body: "A sample draft for review.",
          status,
          kind: "post",
          channel: "linkedin",
          media_url: null,
        },
      }),
    );
    await page.getByRole("button", { name: "Set a time", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review this post", exact: true });
    await expect(review).toBeVisible();
    if (initialStatus === "scheduled" || initialStatus === "publishing") {
      await expect(review.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
      expect(writes).toEqual([]);
    } else {
      await review.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(review).toHaveCount(0);
      expect(writes).toEqual(initialStatus === "draft" ? ["pending", "rejected"] : ["rejected"]);
    }
  });
}
