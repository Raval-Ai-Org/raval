import { test, expect, type Page } from "@playwright/test";

/**
 * Inspo (ADR-0037), rendered with sample data at /inspo-lab (dev only, no
 * sign-in): the board, picking a learned style, the post look, the voice and
 * the media shelf, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function open(page: Page, scene: string) {
  await page.goto(`/inspo-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  const frame = page.getByTestId("inspo-lab-frame");
  await expect(frame.getByTestId("inspo-screen")).toBeVisible({ timeout: 30_000 });
  return frame;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Inspo lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the board shows liked and avoided posts, with a priced learn button", async ({
      page,
    }) => {
      const frame = await open(page, "board");
      await expect(frame.getByRole("heading", { name: "Your board" })).toBeVisible();
      await expect(frame.getByTestId("inspo-board").getByTestId("inspo-card")).toHaveCount(5);
      await expect(frame.getByTestId("inspo-learn")).toContainText("125 credits");
      await expect(frame.locator("[data-testid=inspo-strength]:visible").first()).toBeVisible();
      await frame.getByRole("tab", { name: /Avoid/ }).click();
      await expect(frame.getByTestId("inspo-board").getByTestId("inspo-card")).toHaveCount(1);
      await noSidewaysScroll(page);
    });

    test("a card changes chip, is removed and comes back with Undo", async ({ page }) => {
      const frame = await open(page, "board");
      const card = frame.getByTestId("inspo-card").first();
      await card.hover();
      await card.getByRole("button", { name: "Mark as Avoid" }).click();
      await expect(page.getByTestId("lab-last")).toContainText(":avoid");
      await card.hover();
      await card.getByRole("button", { name: "Remove" }).click();
      await expect(frame.getByTestId("inspo-undo")).toBeVisible();
      await frame.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("undo");
    });

    test("a learned style is picked by a person", async ({ page }) => {
      const frame = await open(page, "directions");
      const picker = frame.getByTestId("inspo-directions");
      await expect(picker.getByText("Product first")).toBeVisible();
      await picker.getByRole("button", { name: /Bold detail/ }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("pick:2");
      await picker.getByRole("button", { name: "Use this" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("use-direction");
      await noSidewaysScroll(page);
    });

    test("a vibe changes the post look", async ({ page }) => {
      const frame = await open(page, "post");
      const bold = frame.getByRole("button", { name: "Bold", exact: true }).first();
      await bold.click();
      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("lab-last")).toHaveText("look");
      await noSidewaysScroll(page);
    });

    test("the voice sample follows the settings and keeps example posts", async ({ page }) => {
      const frame = await open(page, "voice");
      const sample = frame.getByTestId("inspo-voice-sample");
      await expect(sample).toBeVisible();
      await frame.getByRole("radio", { name: "I", exact: true }).click();
      await expect(sample).toHaveText(/^I /);
      await frame.getByLabel("Example post").fill("Fresh beans every Friday.");
      await frame.getByRole("button", { name: "Add", exact: true }).click();
      await expect(frame.getByText("Fresh beans every Friday.")).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("media holds product and people photos", async ({ page }) => {
      const frame = await open(page, "media");
      await expect(frame.getByTestId("inspo-media").getByTestId("inspo-card")).toHaveCount(2);
      await frame.getByRole("button", { name: /Products/ }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("brand:products");
      await noSidewaysScroll(page);
    });
  });
}
