import { expect, test, type Page } from "@playwright/test";
import { openAppUi, prepareAppUi } from "../fixtures/app-ui";

// Every window that opens in place, cycled in the real workspace shell (the
// signed-in fixture): it opens, renders without a page error or a crashed
// window, closes with Escape, leaves nothing locked, and the sidebar still
// answers afterwards. Windows that are pages of their own (Brain, Inspo,
// Autopilot, Campaigns…) need a real route change, which the lab can't make.

const WINDOWS: { event: string; detail?: unknown }[] = [
  { event: "open:library" },
  { event: "open:create-launcher" },
  { event: "open:animate" },
  { event: "open:ugc-studio" },
  { event: "open:analytics" },
  { event: "open:content-calendar" },
  { event: "open:ai-visibility" },
  { event: "open:publish" },
  { event: "open:share" },
  { event: "open:client-portal" },
  { event: "open:schedule" },
  { event: "open:settings" },
  { event: "open:usage" },
  { event: "open:rename" },
  { event: "open:details" },
  { event: "open:command-bar" },
  { event: "open:upgrade" },
];

async function visibleDialogs(page: Page) {
  return page.locator('[role="dialog"]:visible').count();
}

test("every in-place window opens, renders and closes cleanly", async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  let current = "start";
  page.on("pageerror", (e) => errors.push(`${current}: ${e.message}`));
  await prepareAppUi(page, "light");
  await openAppUi(page);

  for (const w of WINDOWS) {
    current = w.event;
    // Lazy windows listen once their code loads: send until one shows.
    let opened = true;
    try {
      await expect(async () => {
        await page.evaluate(
          ({ event, detail }) => window.dispatchEvent(new CustomEvent(event, { detail })),
          w,
        );
        expect(await visibleDialogs(page)).toBeGreaterThan(0);
      }).toPass({ timeout: 45_000 });
    } catch {
      opened = false;
    }
    expect.soft(opened, `${w.event} should open a window`).toBe(true);
    if (!opened) continue;
    await page.waitForTimeout(1_500);
    await expect
      .soft(page.getByText("This window ran into a problem"), `${w.event} crashed`)
      .toHaveCount(0);

    // Close it (Escape; some windows need two: an inner pick, then the window).
    for (let i = 0; i < 3 && (await visibleDialogs(page)) > 0; i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    expect.soft(await visibleDialogs(page), `${w.event} should close on Escape`).toBe(0);
    const locked = await page.evaluate(
      () =>
        document.body.style.pointerEvents === "none" ||
        document.body.hasAttribute("data-scroll-locked"),
    );
    expect.soft(locked, `${w.event} left the page locked`).toBe(false);
  }

  // The shell still answers.
  current = "sidebar";
  await page.getByRole("button", { name: "Library", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Library" })).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Library" })).toHaveCount(0);

  expect(errors, "uncaught page errors").toEqual([]);
});
