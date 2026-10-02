import { test, expect } from "@playwright/test";

/**
 * Autopilot screens, rendered with sample data at /autopilot-lab (dev only, no
 * sign-in). Checks the one-screen setup, the home screen, approving a post and
 * acting on an idea, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Autopilot lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("setup is one screen: strategy, six rows, one button", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=setup", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Let Mellox run your marketing")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByText("Brewing know-how")).toBeVisible();
      for (const row of [
        "Goal",
        "Where",
        "How often",
        "What",
        "Who approves",
        "Also",
        "Weekly limit",
      ]) {
        await expect(frame.getByText(row, { exact: true })).toBeVisible();
      }
      await frame.getByRole("button", { name: /How often/ }).click();
      await frame.getByRole("button", { name: "Every day" }).click();
      await frame.getByRole("button", { name: "Turn on Autopilot" }).click();
      await expect(page.getByTestId("lab-last")).toContainText('"postsPerWeek":7');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test("home says what is happening and leads to the approval", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=home", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Autopilot is on")).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText(/1 post needs your OK/)).toBeVisible();
      // What is missing is asked for, with the button that fixes it.
      await expect(frame.getByText("Connect your social accounts")).toBeVisible();
      await frame.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["accounts"]');
      // The pipeline, the weekly AI visibility check and what was learned are on the page.
      await expect(frame.getByRole("list", { name: "Where your posts are" })).toBeVisible();
      await expect(frame.getByText("AI visibility", { exact: true })).toBeVisible();
      await expect(frame.getByText(/reaches about 2.4× more people/)).toBeVisible();
      await frame.getByRole("button", { name: "Review" }).click();
      await frame.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText("decide");
      await expect(page.getByTestId("lab-last")).toContainText('"approve"');
    });

    test("an idea shows its source and becomes a post in one tap", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=ideas", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Beanhaus: launched a winter subscription box")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByRole("link", { name: /Beanhaus blog/ })).toHaveAttribute(
        "href",
        "https://example.com/beanhaus",
      );
      await frame.getByRole("button", { name: "Create post" }).first().click();
      await expect(page.getByTestId("lab-last")).toContainText('"decision":"create"');
    });
  });
}
