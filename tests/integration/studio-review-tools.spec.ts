import { test, expect } from "@playwright/test";

/**
 * Studio's review tools, rendered with sample data at /studio-lab (dev only,
 * no sign-in): the version strip, the edit chat and the swipeable ideas deck.
 */

async function openScene(page: import("@playwright/test").Page, scene: string) {
  await page.goto(`/studio-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-ready='true']")).toBeVisible({ timeout: 120_000 });
}

test.describe("Studio review tools", () => {
  test.use({ viewport: { width: 1300, height: 1000 } });
  test.setTimeout(180_000);

  test("versions show under the preview with the picture in use first", async ({ page }) => {
    await openScene(page, "review-versions");
    const strip = page.getByTestId("version-strip");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(strip.getByText("4 versions · tap one to use it")).toBeVisible();
    await expect(strip.getByRole("button", { name: "Picture in use" })).toBeDisabled();
    await expect(strip.getByRole("button", { name: "Use version 2" })).toBeEnabled();
    await expect(strip.getByRole("button", { name: "Version couldn't be made" })).toBeDisabled();
  });

  test("the edit chat shows what a message changes and what it costs", async ({ page }) => {
    await openScene(page, "review-versions");
    const chat = page.getByRole("region", { name: "Edit with chat" });
    await expect(chat.getByText("Make the background warmer")).toBeVisible({ timeout: 30_000 });
    await expect(chat.getByRole("button", { name: "Undo" })).toBeVisible();
    await chat.getByLabel("Describe a change").fill("Make the background darker");
    await expect(chat.getByRole("button", { name: "Picture", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(chat.getByText(/credits$/).first()).toBeVisible();
    await chat.getByRole("button", { name: "Words", exact: true }).click();
    await expect(chat.getByRole("button", { name: "Words", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(chat.getByRole("button", { name: /Make 3 more versions/ })).toBeVisible();
  });

  test("a change in progress locks the chat until it finishes", async ({ page }) => {
    await openScene(page, "review-chat-working");
    const chat = page.getByRole("region", { name: "Edit with chat" });
    await expect(chat.getByText("Changing the picture…")).toBeVisible({ timeout: 30_000 });
    await expect(chat.getByLabel("Describe a change")).toBeDisabled();
    await expect(chat.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  test("ideas can be swiped, saved, undone and made", async ({ page }) => {
    await openScene(page, "brief-ad");
    await page.getByRole("button", { name: "Swipe", exact: true }).first().click();
    const deck = page.getByRole("dialog", { name: "Swipe through ideas" });
    await expect(deck).toBeVisible({ timeout: 30_000 });
    const first = await deck
      .locator("[aria-roledescription='idea card']")
      .getAttribute("aria-label");
    await page.keyboard.press("ArrowRight");
    await expect(deck.getByText("Saved · 1")).toBeVisible();
    await deck.getByRole("button", { name: "Undo last swipe" }).click();
    await expect(deck.getByText("Saved · 1")).toHaveCount(0);
    await expect(deck.locator("[aria-roledescription='idea card']")).toHaveAttribute(
      "aria-label",
      first!,
    );
    await deck.getByRole("button", { name: "Skip" }).click();
    // The skipped card flies off first; then one card is on top again.
    await expect(deck.locator("[aria-roledescription='idea card']")).toHaveCount(1);
    await expect(deck.locator("[aria-roledescription='idea card']")).not.toHaveAttribute(
      "aria-label",
      first!,
    );
    await deck.getByRole("button", { name: "Make this" }).click();
    await expect(deck).toHaveCount(0);
  });
});
