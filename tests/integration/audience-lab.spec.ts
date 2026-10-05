import { test, expect } from "@playwright/test";

/**
 * Audience screens, rendered with sample data at /audience-lab (dev only, no
 * sign-in). Checks the groups page, the empty and read-only states, a check
 * playing through to its result and a comparison, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Audience lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("groups show where every statement came from", async ({ page }) => {
      await page.goto("/audience-lab?state=ready", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Your audience", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Independent café owners")).toBeVisible();
      await expect(page.getByText("You told us").first()).toBeVisible();
      await expect(page.getByText("Our guess").first()).toBeVisible();
      await expect(page.getByText("Measured from your posts").first()).toBeVisible();
      await expect(page.getByText(/11 posts measured/)).toBeVisible();
      // A result with too few posts to compare with is not given a number.
      await expect(page.getByText("Soon")).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("a group can be edited in place", async ({ page }) => {
      await page.goto("/audience-lab?state=ready", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Edit Independent café owners" }).click();
      await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
      await expect(page.getByPlaceholder("Busy salon owners")).toHaveValue(
        "Independent café owners",
      );
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
    });

    test("empty and read-only states offer the right things", async ({ page }) => {
      await page.goto("/audience-lab?state=empty", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("No audience groups yet")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Build from Brand DNA" })).toBeVisible();
      await expect(page.getByText(/Nothing to compare yet/)).toBeVisible();

      await page.goto("/audience-lab?state=viewer", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Independent café owners")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: /Refresh from Brand DNA/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    });

    test("a check counts real steps, then shows a labelled result", async ({ page }) => {
      await page.goto("/audience-lab?state=check", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("img", { name: "Mellox Score 74 out of 100" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/simulated people, not real customers/)).toBeVisible();
      await expect(page.getByText("What holds people back")).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("a comparison names a winner and offers it", async ({ page }) => {
      await page.goto("/audience-lab?state=compare", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Lead with the waste").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("52% picked it")).toBeVisible();
      await expect(page.getByRole("button", { name: "Use this version" })).toBeVisible();
      await expect(page.getByText(/ranked by a simulated panel/)).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
