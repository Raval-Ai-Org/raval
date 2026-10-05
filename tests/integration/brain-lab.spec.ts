import { test, expect } from "@playwright/test";

/**
 * Brain screens, rendered with sample data at /brain-lab (dev only, no
 * sign-in). Checks Home, the strategy (reading, editing, confirming a draft),
 * the Coach pill and the Look & voice editor, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Open a scene and wait until the page is interactive on it (dev builds hydrate slowly). */
async function openScene(page: import("@playwright/test").Page, scene: string) {
  await page.goto(`/brain-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("brain-lab-frame")).toHaveAttribute("data-ready", "true", {
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
  test.describe(`Brain lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(180_000);

    test("home shows the four brains, the strategy and what's new", async ({ page }) => {
      await openScene(page, "home");
      const frame = page.getByTestId("brain-lab-frame");
      for (const brain of ["Brand", "Audience", "Competitors", "Market"]) {
        await expect(frame.getByRole("button", { name: new RegExp(`^${brain}:`) })).toBeVisible({
          timeout: 30_000,
        });
      }
      await expect(frame.getByText("Mellox follows this")).toBeVisible();
      await expect(frame.getByText("Rising: cafés cutting waste")).toBeVisible();
      await frame.getByRole("button", { name: /^Competitors:/ }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:competitors");
      await noSidewaysScroll(page);
    });

    test("an empty brain says what to do first", async ({ page }) => {
      await openScene(page, "home-empty");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Add your website to build Brand DNA")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByText("On the Growth plan")).toBeVisible();
      await frame.getByRole("button", { name: "Create" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:strategy");
    });

    test("a draft strategy can be edited and confirmed", async ({ page }) => {
      await openScene(page, "strategy-draft");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Draft — not in use yet")).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText("Your brains changed since this was written.")).toBeVisible();
      await expect(frame.getByText("vs Bean Bros")).toBeVisible();
      await frame.getByRole("button", { name: "Edit" }).click();
      await frame.getByRole("button", { name: "Remove Café stories" }).click();
      await frame.getByRole("button", { name: "Save", exact: true }).click();
      // Shares are evened out to 100 and a draft stays a draft on Save.
      await expect(page.getByTestId("lab-last")).toHaveText("save:false:[44,31,25]");
      await noSidewaysScroll(page);
    });

    test("the first strategy is offered free", async ({ page }) => {
      await openScene(page, "strategy-empty");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Your marketing strategy")).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText("Free", { exact: true })).toBeVisible();
      await frame.getByRole("button", { name: "Create my strategy" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("generate:");
    });

    test("the Coach pill only lists updates", async ({ page }) => {
      await openScene(page, "pulse");
      const pop = page.getByRole("dialog", { name: "What's new" });
      await expect(pop).toBeVisible({ timeout: 30_000 });
      await expect(pop.getByRole("listitem")).toHaveCount(6);
      await expect(pop.getByRole("tab")).toHaveCount(0);
      await page.getByRole("button", { name: "Open Brain" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:home");
      await noSidewaysScroll(page);
    });

    test("a starter look changes the preview's settings", async ({ page }) => {
      await openScene(page, "look");
      const frame = page.getByTestId("brain-lab-frame");
      const bold = frame.getByRole("button", { name: "Bold", exact: true }).first();
      await expect(bold).toBeVisible({ timeout: 30_000 });
      await bold.click();
      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await expect(frame.getByRole("button", { name: "Reset to plain brand" })).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
