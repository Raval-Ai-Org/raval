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
      await expect(frame.getByText("In use")).toBeVisible();
      await expect(frame.getByText("Rising: cafés cutting waste")).toBeVisible();
      await frame.getByRole("button", { name: /^Competitors:/ }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:competitors");
      await noSidewaysScroll(page);
    });

    test("an empty brain says what to do first", async ({ page }) => {
      await openScene(page, "home-empty");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Add your website")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByText("Growth plan")).toBeVisible();
      await frame.getByRole("button", { name: "Create" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("open:strategy");
    });

    test("a draft strategy can be edited and confirmed", async ({ page }) => {
      await openScene(page, "strategy-draft");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Draft", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText("Your brains changed.")).toBeVisible();
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
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`Brain lab communities — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(180_000);

    test("community threads show their links, counts and a priced reply", async ({ page }) => {
      await openScene(page, "community");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByRole("heading", { name: "Communities" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByTestId("community-thread")).toHaveCount(5);
      // Every title is the thread's own link, opened in a new tab.
      const first = frame.getByRole("link", { name: /Their minimums are killing us/ });
      await expect(first).toHaveAttribute("href", "https://www.reddit.com/r/cafe/comments/abc123/");
      await expect(first).toHaveAttribute("target", "_blank");
      // Counts of rows that exist.
      await expect(frame.getByTestId("community-signals").getByText("2 threads")).toBeVisible();
      // A draft is a click with its price on the button.
      const draft = frame.getByRole("button", { name: /Draft a reply/ }).first();
      await expect(draft).toContainText("credits");
      await draft.click();
      await expect(page.getByTestId("lab-last")).toHaveText("community:draft:c001");
      // A written reply says who wrote it and is copied, never posted.
      const reply = frame.getByTestId("community-reply");
      await expect(reply).toContainText("Full disclosure: I work at Northside Roasters.");
      await frame.getByRole("button", { name: "Copy" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText(/^community:copy:\d+$/);
      // Filters narrow the list.
      await frame.getByRole("tab", { name: /^Saved/ }).click();
      await expect(frame.getByTestId("community-thread")).toHaveCount(1);
      await noSidewaysScroll(page);
    });

    test("a new workspace is asked before anything is looked up", async ({ page }) => {
      await openScene(page, "community-empty");
      const frame = page.getByTestId("brain-lab-frame");
      await expect(frame.getByText("Find people asking about what you do")).toBeVisible({
        timeout: 30_000,
      });
      await frame.getByRole("button", { name: /Start looking/ }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("community:refresh");
      await noSidewaysScroll(page);
    });
  });
}
