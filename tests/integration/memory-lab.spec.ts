import { test, expect } from "@playwright/test";

/**
 * Memory, rendered with sample data at /memory-lab (dev only, no sign-in).
 * Checks the list, the empty, read-only and switched-off screens, and what a
 * chat reply carries (the "Memory updated" note and prepared changes), at
 * desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function openScene(page: import("@playwright/test").Page, scene: string) {
  await page.goto(`/memory-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("memory-lab-frame")).toHaveAttribute("data-ready", "true", {
    timeout: 120_000,
  });
}

async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Memory lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(180_000);

    test("lists lasting and temporary memories apart", async ({ page }) => {
      await openScene(page, "ready");
      await expect(page.getByText("Use memory")).toBeVisible();
      await expect(page.getByText("For now", { exact: true })).toBeVisible();
      await expect(page.getByText("Always", { exact: true })).toBeVisible();
      await expect(page.getByText("Never use red in our images")).toBeVisible();
      await expect(page.getByText("5 hours left")).toBeVisible();
      await expect(page.getByText("8 of 200")).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("a memory can be added, edited, kept and removed", async ({ page }) => {
      await openScene(page, "ready");
      await page.getByLabel("Add a memory").fill("Always end posts with a question");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toHaveText(
        "add:Always end posts with a question:always",
      );

      await page.getByRole("button", { name: "Keep for good" }).first().click();
      await expect(page.getByTestId("lab-last")).toHaveText("keep:00000001");

      const row = page.getByTestId("memory-row").filter({ hasText: "Write in British English" });
      await row.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Edit memory").fill("Write in American English");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText(
        "edit:00000004:Write in American English",
      );

      await row.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("remove:00000004");
    });

    test("search narrows the list and clearing asks first", async ({ page }) => {
      await openScene(page, "ready");
      await page.getByLabel("Search memory").fill("british");
      await expect(page.getByTestId("memory-row")).toHaveCount(1);
      await page.getByLabel("Search memory").fill("");

      await page.getByRole("button", { name: "Clear all" }).click();
      await expect(page.getByText("Clear all memory?")).toBeVisible();
      await page.getByRole("button", { name: "Keep it" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("");
    });

    test("empty, read-only and switched-off states say the right thing", async ({ page }) => {
      await openScene(page, "empty");
      await expect(page.getByText("Nothing remembered yet")).toBeVisible();

      await openScene(page, "viewer");
      await expect(page.getByText("Never use red in our images")).toBeVisible();
      await expect(page.getByLabel("Add a memory")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
      await expect(page.getByText("Only an admin can change this.")).toBeVisible();

      await openScene(page, "off");
      await expect(page.getByText(/Memory is off/)).toBeVisible();
      await expect(page.getByLabel("Add a memory")).toHaveCount(0);
    });

    test("a reply shows what it remembered, with undo, and changes as buttons", async ({
      page,
    }) => {
      await openScene(page, "chat");
      await expect(page.getByTestId("tool-activity")).toHaveText("Looking at your posts");

      const chip = page.getByTestId("memory-chip");
      await chip.getByRole("button", { name: /Memory updated/ }).click();
      await expect(chip.getByText("Never use red in our images")).toBeVisible();
      await expect(chip.getByText(/for now/)).toBeVisible();
      await chip.getByRole("button", { name: "Undo" }).first().click();
      await expect(page.getByTestId("lab-last")).toHaveText("undo:00000003");
      await expect(chip.getByText("Undone")).toBeVisible();
      await chip.getByRole("button", { name: "Manage" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("manage");

      // A plain change runs on one click.
      const schedule = page.getByTestId("chat-action").filter({ hasText: "2 items" });
      await schedule.getByRole("button", { name: "Schedule approved posts" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("run:00000021");
      await expect(schedule).toHaveAttribute("data-state", "done");

      // Removing something asks once more, in place.
      const remove = page.getByTestId("chat-action").filter({ hasText: "Delete a post" });
      await remove.getByRole("button", { name: "Delete a post" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("run:00000021");
      await remove.getByRole("button", { name: "Yes, do it" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("run:00000022");

      await expect(page.getByText("This post isn't approved yet.")).toBeVisible();
      await page.getByRole("button", { name: "Open Backlinks" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:backlinks");
      await noSidewaysScroll(page);
    });
  });
}
