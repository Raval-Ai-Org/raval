import { test, expect, type Page } from "@playwright/test";

/**
 * Onboarding's goal, product, channel and first-post steps at /onboarding-lab
 * (dev only, no sign-in, sample data). Checks the required-product gate, the
 * no-website path, that every button is a pill, the first-post states, and
 * that nothing scrolls sideways, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function openLab(page: Page, query: string) {
  await page.goto(`/onboarding-lab?${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboarding-lab-frame")).toHaveAttribute("data-ready", "true", {
    timeout: 120_000,
  });
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function everyButtonIsAPill(page: Page) {
  // Text buttons are pills; cards and tiles that happen to be <button>s are not.
  const square = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>("main button")]
      .filter((b) => !b.className.includes("ds-tile") && b.offsetHeight > 0)
      .filter((b) => b.offsetHeight <= 48)
      .filter((b) => parseFloat(getComputedStyle(b).borderTopLeftRadius) < b.offsetHeight / 2 - 1)
      .map((b) => b.textContent?.trim() || b.getAttribute("aria-label")),
  );
  expect(square).toEqual([]);
}

const last = (page: Page) => page.getByTestId("lab-last");

for (const vp of VIEWPORTS) {
  test.describe(`Onboarding lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(180_000);

    test("goal step shows the live scan and the target fields", async ({ page }) => {
      await openLab(page, "step=goals");
      await expect(page.locator('main [role="status"]')).toContainText("northwind.example");
      await expect(page.getByRole("radio", { name: /Grow my following/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.getByRole("button", { name: /Add a target/ }).click();
      await expect(page.getByText("Where you are today")).toBeVisible();
      await page.getByRole("button", { name: "More posts" }).click();
      await expect(page.locator("output")).toHaveText("4");
      await page.getByRole("button", { name: /Set my goal/ }).click();
      await expect(last(page)).toHaveText("goals:continue");
      await noSideScroll(page);
      await everyButtonIsAPill(page);
    });

    test("no website: three answers, then on", async ({ page }) => {
      await openLab(page, "step=manual");
      const next = page.getByRole("button", { name: /Continue/ });
      await expect(next).toBeDisabled();
      await page.getByLabel("Brand name").fill("Northwind");
      await page
        .getByLabel("What you do, in one line")
        .fill("Small-batch coffee, delivered weekly");
      await page.getByRole("radio", { name: "Services" }).click();
      await next.click();
      await expect(last(page)).toHaveText("manual:continue");
      await noSideScroll(page);
    });

    test("an empty catalogue can't be passed until something is added", async ({ page }) => {
      await openLab(page, "step=products&empty=1");
      await expect(page.getByRole("button", { name: /^Continue/ })).toBeDisabled();
      await page.getByRole("button", { name: /Add a service/ }).click();
      await page.getByLabel("Name").fill("Office coffee service");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(last(page)).toHaveText("add:service:Office coffee service");
      await noSideScroll(page);
      await everyButtonIsAPill(page);
    });

    test("what the scan found is already in the catalogue", async ({ page }) => {
      await openLab(page, "step=products");
      await expect(page.getByText(/Found 1 product on northwind\.example/)).toBeVisible();
      await expect(page.getByRole("tab", { name: /Services · 1/ })).toBeVisible();
      await page.getByRole("tab", { name: /Services · 1/ }).click();
      await expect(page.getByText("Office coffee service")).toBeVisible();
      await expect(page.getByText("Cold Brew, 1 L")).toBeHidden();
      await page.getByRole("tab", { name: /All/ }).click();
      await expect(page.getByText(/Small photo/)).toBeVisible();
      await page.getByRole("button", { name: "Remove all" }).click();
      await page.getByRole("button", { name: "Remove all 1" }).click();
      await expect(page.getByText("Cold Brew, 1 L")).toBeHidden();
      await noSideScroll(page);
      await everyButtonIsAPill(page);
    });

    test("found items show while they are being saved", async ({ page }) => {
      await openLab(page, "step=products&saving=1");
      await expect(page.getByText(/Adding what we found on northwind\.example/)).toBeVisible();
      await expect(page.getByText("1 of 3 saved, with their photos")).toBeVisible();
      await expect(page.getByText("House Espresso Beans")).toBeVisible();
      await noSideScroll(page);
    });

    test("first posts: price before the click, then progress and retry", async ({ page }) => {
      await openLab(page, "step=first");
      await expect(page.getByRole("button", { name: /Make my first 3 posts/ })).toContainText(
        "credits",
      );
      await page.getByRole("button", { name: /Make my first 3 posts/ }).click();
      await expect(last(page)).toHaveText("first:start");
      await noSideScroll(page);

      await openLab(page, "step=first-running");
      await expect(page.getByRole("heading", { name: "Writing your first posts…" })).toBeVisible();
      await expect(page.getByLabel("Ready")).toHaveCount(1);
      await expect(page.getByText("They keep writing if you go on.")).toBeVisible();

      await openLab(page, "step=first-failed");
      await page.getByRole("button", { name: /Try again/ }).click();
      await expect(last(page)).toHaveText("retry:1");
      await expect(page.locator("main").getByRole("alert")).toContainText("run out of credits");
      await noSideScroll(page);
    });
  });
}
