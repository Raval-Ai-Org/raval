import { test, expect, type Page } from "@playwright/test";

/**
 * The one-question onboarding (ADR-0049) at /onboarding-lab: nothing ever
 * scrolls the page, the primary action is always on screen, a tap answers
 * and moves on, keys work, and the swipe deck answers with ←/→.
 */

const VIEWPORTS = [
  { name: "small phone", width: 360, height: 640 },
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const SCREENS = [
  "step=ask&id=hello",
  "step=ask&id=role",
  "step=ask&id=focus",
  "step=ask&id=rhythm",
  "step=ask&id=channels",
  "step=ask&id=approval",
  "step=ask&id=tone",
  "step=ask&id=look",
  "step=ask&id=source",
  "step=review&scan=ok",
  "step=audience&scan=ok",
  "step=language&scan=ok",
  "step=done",
];

async function openLab(page: Page, query: string) {
  await page.goto(`/onboarding-lab?${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboarding-lab-frame")).toHaveAttribute("data-ready", "true", {
    timeout: 120_000,
  });
  await expect(page.locator("[data-ob-stage]")).toBeVisible();
  await page.waitForTimeout(700);
}

async function noPageScroll(page: Page) {
  const { x, y } = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(x).toBeLessThanOrEqual(0);
  expect(y).toBeLessThanOrEqual(0);
}

/** Every visible control in the stage sits inside the viewport. */
async function controlsInView(page: Page) {
  const outside = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-ob-stage] footer button, [data-ob-stage] main [role=radio]",
      ),
    ]
      .filter((el) => el.offsetHeight > 0)
      // A long list (languages) scrolls inside its own box; the page doesn't.
      .filter((el) => {
        for (let p = el.parentElement; p && !p.matches("main"); p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return false;
        }
        return true;
      })
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > window.innerHeight + 1 || r.top < -1;
      })
      .map((el) => el.textContent?.trim().slice(0, 30) || el.getAttribute("aria-label")),
  );
  expect(outside).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`One-question onboarding — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(240_000);

    test("no screen scrolls and every control is on screen", async ({ page }) => {
      for (const q of SCREENS) {
        await openLab(page, q);
        await noPageScroll(page);
        await controlsInView(page);
      }
    });
  });
}

test.describe("One-question onboarding — behaviour", () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(180_000);

  test("a tap answers and moves on; keys pick and go back", async ({ page }) => {
    await openLab(page, "step=ask&id=role");
    await page.getByRole("radio", { name: /Creator/ }).click();
    await expect(page.getByTestId("lab-last")).toHaveText("pick:role:creator");
    await expect(page.getByRole("heading", { name: /team/ })).toBeVisible();
    await page.keyboard.press("2");
    await expect(page.getByTestId("lab-last")).toHaveText("pick:teamSize:small");
  });

  test("the swipe deck answers with arrow keys", async ({ page }) => {
    await openLab(page, "step=ask&id=look");
    await page.locator("body").press("ArrowRight");
    await expect(page.getByTestId("lab-last")).toContainText(":like");
    await page.locator("body").press("ArrowLeft");
    await expect(page.getByTestId("lab-last")).toContainText(":skip");
  });

  test("the scan dock shows the four brains and opens", async ({ page }) => {
    await openLab(page, "step=ask&id=role&scan=loading");
    const dock = page.locator("footer [role=status] > button");
    await expect(dock).toContainText("Researching your market");
    await dock.click();
    for (const brain of ["Brand", "Audience", "Competitors", "Market"]) {
      await expect(page.getByText(brain, { exact: true }).first()).toBeVisible();
    }
  });
});
