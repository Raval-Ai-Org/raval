import { test, expect, type Page } from "@playwright/test";

/**
 * Onboarding's product, no-website, language and finish screens at /onboarding-lab
 * (dev only, no sign-in, sample data). Checks the required-product gate, the
 * no-website path, that every button is a pill, the finish, and
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
    [...document.querySelectorAll<HTMLButtonElement>("[data-ob-stage] main button")]
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

    test("the old goal page now opens the one-tap goal question", async ({ page }) => {
      await openLab(page, "step=goals");
      await expect(page).toHaveURL(/step=ask&id=focus|id=focus/);
      await expect(page.locator("[data-ob-stage]")).toBeVisible();
      await expect(page.getByRole("radio", { name: /Grow my following/ })).toBeVisible();
      await noSideScroll(page);
    });

    test("no website: the basics, then every other part can be skipped", async ({ page }) => {
      await openLab(page, "step=manual");
      const next = page.getByRole("button", { name: /Continue/ });
      await expect(next).toBeDisabled();
      await page.getByLabel("Brand name").fill("Northwind");
      await page
        .getByLabel("What you do, in one line")
        .fill("Small-batch coffee, delivered weekly");
      await page.getByRole("radio", { name: /Services/ }).click();
      await expect(page.getByRole("complementary")).toContainText("Northwind");
      await next.click();
      await expect(last(page)).toHaveText("part:category");
      await page.getByRole("radio", { name: /Food & drink/ }).click();
      await expect(page.getByRole("complementary")).toContainText("Food & drink");
      await next.click();
      await expect(last(page)).toHaveText("part:look");
      await page.getByRole("button", { name: /Ocean/ }).click();
      await expect(page.getByRole("button", { name: /Primary #0B3D91/ })).toBeVisible();
      await page.getByRole("button", { name: "Bold" }).click();
      await next.click();
      await page.locator("form").getByRole("button", { name: "Skip for now" }).click();
      await expect(last(page)).toHaveText("part:competitors");
      await page.getByLabel("Competitor name").fill("Bean Bros");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Mellox will look up their site")).toBeVisible();
      await page.getByRole("button", { name: /Looks good/ }).click();
      await expect(last(page)).toHaveText("manual:continue");
      await noSideScroll(page);
      await everyButtonIsAPill(page);
    });

    test("no website: a filled kit shows in the live card", async ({ page }) => {
      await openLab(page, "step=manual&part=inspiration");
      await expect(page.getByRole("complementary")).toContainText("Northwind Coffee");
      await expect(page.getByLabel("Uploading")).toBeVisible();
      await expect(page.getByRole("button", { name: /Uploading/ })).toBeDisabled();
      await noSideScroll(page);
      await everyButtonIsAPill(page);
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
      // The list row and the detail panel both name the chosen service.
      await expect(page.getByRole("heading", { name: "Office coffee service" })).toBeVisible();
      await expect(page.getByText("Cold Brew, 1 L")).toHaveCount(0);
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

    test("language: search and pick what Mox writes in", async ({ page }) => {
      await openLab(page, "step=language");
      const grid = page.getByRole("radiogroup", { name: "Content language" });
      await page.getByRole("textbox", { name: "Search languages" }).fill("urdu");
      await grid.getByRole("radio", { name: /Urdu/ }).first().click();
      await expect(grid.getByRole("radio", { name: /Urdu/ }).first()).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
      await noSideScroll(page);
    });

    test("finish: no posts are made, press and hold to enter", async ({ page }) => {
      await openLab(page, "step=finish");
      await expect(page).toHaveURL(/step=done/);
      await expect(page.getByText(/first 3 posts/i)).toHaveCount(0);
      await expect(page.getByText("Hold to go in")).toBeVisible();
      await noSideScroll(page);
    });
  });
}
