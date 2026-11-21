import { expect, test, type Locator, type Page } from "@playwright/test";
import { openAppUi, prepareAppUi } from "../fixtures/app-ui";

// The shell never traps a person: a window open on Home steps aside when Home
// or Chat is pressed. (Back after routed windows is covered by
// src/lib/shell/history.test.ts: this lab can't change routes, since a real
// route change meets the server's sign-in check.)

/** Lazy windows start listening once their code loads: send until one opens. */
async function openBy(page: Page, event: string, window: Locator) {
  await expect(async () => {
    await page.evaluate((name) => window.dispatchEvent(new CustomEvent(name)), event);
    await expect(window.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

test("Home and Chat close a window that is open on Home", async ({ page }) => {
  test.setTimeout(180_000);
  await prepareAppUi(page, "light");
  await openAppUi(page);
  const sidebar = (name: string) => page.getByRole("button", { name, exact: true }).first();

  const ugc = page.getByRole("dialog", { name: "AI creator video" });
  const animate = page.getByRole("dialog").filter({ hasText: /post to video ad/i });

  // Creator video ads opens over Home and claims no sidebar row of its own.
  await openBy(page, "open:ugc-studio", ugc);
  await sidebar("Home").click();
  await expect(ugc).toHaveCount(0);

  // Animate is Home's own window (it highlights Home).
  await openBy(page, "open:animate", animate);
  await sidebar("Home").click();
  await expect(animate).toHaveCount(0);
  // Home pressed on Home stays put (no reload of the page).
  await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();

  // Nothing left unclickable.
  await expect
    .poll(() => page.locator("body").evaluate((b) => (b as HTMLElement).style.pointerEvents))
    .not.toBe("none");

  // Chat closes it too. (Last: in this lab a route change meets sign-in.)
  await openBy(page, "open:ugc-studio", ugc);
  await sidebar("Chat").click();
  await expect(ugc).toHaveCount(0);
});

test("Create launcher steps aside for Home", async ({ page }) => {
  test.setTimeout(150_000);
  await prepareAppUi(page, "light");
  await openAppUi(page);
  await page
    .getByRole("button", { name: /^Create/ })
    .first()
    .click();
  const launcher = page.getByRole("dialog").first();
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
