import { test, expect } from "@playwright/test";

/**
 * The app tour, rendered on a stand-in app shell at /tour-lab (dev only, no
 * sign-in). Checks the welcome, that every stop lights its control and keeps
 * the card on screen, the last card's first steps, and the ways out, at
 * desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type Page = import("@playwright/test").Page;

async function openLab(page: Page, query = "") {
  await page.goto(`/tour-lab${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tour-lab-frame")).toHaveAttribute("data-ready", "true", {
    timeout: 120_000,
  });
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function cardOnScreen(page: Page) {
  // Let the card finish moving to its place.
  await page.waitForTimeout(450);
  const box = await page.getByRole("dialog").boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
  return box!;
}

for (const vp of VIEWPORTS) {
  test.describe(`Tour lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.setTimeout(180_000);

    test("welcomes by name and walks every stop to the last card", async ({ page }) => {
      await openLab(page);
      const tour = page.getByTestId("app-tour");
      await expect(page.getByRole("heading", { name: "Welcome to Mellox, Sam" })).toBeVisible();
      await expect(tour).toHaveAttribute("data-lit", "false");
      await page.getByRole("button", { name: "Start the tour" }).click();

      const stops = [
        "chat",
        "autopilot",
        "studio",
        "library",
        "brain",
        "analytics",
        "calendar",
        "visibility",
        "account",
        "share",
      ];
      for (const [i, id] of stops.entries()) {
        await expect(tour).toHaveAttribute("data-step", id);
        await expect(page.getByTestId("tour-count")).toHaveText(`${i + 1} of ${stops.length}`);
        await expect(tour).toHaveAttribute("data-lit", "true");
        const card = await cardOnScreen(page);

        // The card never sits on the control it is pointing at.
        const light = await page.getByTestId("tour-light").boundingBox();
        const apart =
          card.x + card.width <= light!.x + 1 ||
          light!.x + light!.width <= card.x + 1 ||
          card.y + card.height <= light!.y + 1 ||
          light!.y + light!.height <= card.y + 1;
        expect(apart, `card overlaps the lit control at "${id}"`).toBe(true);

        await page
          .getByRole("button", { name: i === stops.length - 1 ? "Finish" : "Next", exact: true })
          .click();
      }

      await expect(page.getByRole("heading", { name: "You're ready" })).toBeVisible();
      await cardOnScreen(page);
      await page.getByRole("button", { name: "Write my first post" }).click();
      await expect(tour).toHaveCount(0);
      await expect(page.getByTestId("lab-last")).toHaveText("closed:post");
    });

    test("the page behind cannot be clicked while the tour shows", async ({ page }) => {
      await openLab(page, "?step=3");
      await expect(page.getByTestId("app-tour")).toHaveAttribute("data-lit", "true");
      const light = await page.getByTestId("tour-light").boundingBox();
      await page.mouse.click(light!.x + light!.width / 2, light!.y + light!.height / 2);
      await expect(page.getByTestId("lab-last")).toHaveText("");
      await expect(page.getByTestId("app-tour")).toBeVisible();
    });

    test("skip, the close button and Escape all end it", async ({ page }) => {
      await openLab(page);
      await page.getByRole("button", { name: "Skip" }).click();
      await expect(page.getByTestId("lab-last")).toHaveText("closed");

      await page.getByRole("button", { name: "Replay" }).click();
      await page.getByRole("button", { name: "Start the tour" }).click();
      await page.getByRole("button", { name: "Close the tour" }).click();
      await expect(page.getByTestId("app-tour")).toHaveCount(0);

      await page.getByRole("button", { name: "Replay" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("app-tour")).toHaveCount(0);
    });

    test("arrow keys move between stops and Back returns", async ({ page }) => {
      await openLab(page, "?step=0");
      const tour = page.getByTestId("app-tour");
      await expect(tour).toHaveAttribute("data-step", "chat");
      await page.keyboard.press("ArrowRight");
      await expect(tour).toHaveAttribute("data-step", "autopilot");
      await page.keyboard.press("ArrowLeft");
      await expect(tour).toHaveAttribute("data-step", "chat");
      await page.getByRole("button", { name: "Back" }).click();
      await expect(tour).toHaveAttribute("data-step", "welcome");
    });

    test("a part that is switched off is left out", async ({ page }) => {
      await openLab(page, "?step=0&autopilot=off");
      await expect(page.getByTestId("tour-count")).toHaveText("1 of 9");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByTestId("app-tour")).toHaveAttribute("data-step", "studio");
    });
  });
}
