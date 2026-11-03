import { test, expect, type Page } from "@playwright/test";

/**
 * Campaigns (ADR-0039), rendered with sample data at /campaigns-lab (dev only,
 * no sign-in): home with running campaigns and the timeline, the designer from
 * a kind to the free preview, and a running campaign, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function open(page: Page, scene: string) {
  await page.goto(`/campaigns-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  const frame = page.getByTestId("campaigns-lab-frame");
  await expect(frame.getByTestId("campaigns-screen")).toBeVisible({ timeout: 30_000 });
  return frame;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Campaigns lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("home shows running campaigns, the calendar button and the kinds", async ({ page }) => {
      const frame = await open(page, "home");
      await expect(frame.getByRole("heading", { name: "Campaigns" })).toBeVisible();
      await expect(frame.getByTestId("campaign-card")).toHaveCount(2);
      await frame.getByTestId("open-calendar").click();
      await expect(page.getByTestId("lab-last")).toHaveText("calendar");
      await expect(frame.getByTestId("kind-product-launch")).toBeVisible();
      await frame.getByRole("tab", { name: /Drafts/ }).click();
      await expect(frame.getByTestId("campaign-card")).toHaveCount(2);
      await noSidewaysScroll(page);
    });

    test("an empty workspace is invited to start one", async ({ page }) => {
      const frame = await open(page, "home-empty");
      await expect(frame.getByTestId("campaign-card")).toHaveCount(0);
      await expect(frame.getByTestId("new-campaign")).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("the designer goes from a kind to a free, priced plan", async ({ page }) => {
      const frame = await open(page, "designer");
      await frame.getByTestId("kind-event").click();
      await frame.getByTestId("campaign-name").fill("Open evening");
      await frame.getByTestId("campaign-link").fill("https://example.com/book");
      await frame.getByTestId("next-step").click();
      await frame.getByTestId("write-for-me").click();
      await expect(page.getByTestId("lab-last")).toHaveText("write:event");
      await frame.getByTestId("next-step").click();
      await frame.getByRole("button", { name: "Facebook", exact: true }).click();
      await frame.getByTestId("next-step").click();
      await expect(frame.getByRole("heading", { name: "Your campaign" })).toBeVisible();
      await expect(frame.getByTestId("write-plan")).toContainText("55 credits");
      await noSidewaysScroll(page);
      await frame.getByTestId("write-plan").click();
      await expect(page.getByTestId("lab-last")).toContainText("plan:");
    });

    test("a running campaign shows its pieces, your count and pause", async ({ page }) => {
      const frame = await open(page, "running");
      await expect(frame.getByRole("heading", { name: "The Ember range" })).toBeVisible();
      expect(await frame.getByTestId("piece-card").count()).toBeGreaterThan(4);
      await frame.getByTestId("edit-count").click();
      await frame.getByLabel("Your count").fill("150");
      await frame.getByRole("button", { name: "Save" }).first().click();
      await expect(page.getByTestId("lab-last")).toHaveText("count:150");
      await frame.getByTestId("pause-campaign").click();
      await expect(page.getByTestId("lab-last")).toContainText("pause:");
      await noSidewaysScroll(page);
    });
  });
}
