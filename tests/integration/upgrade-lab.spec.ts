import { test, expect } from "@playwright/test";

/**
 * The upgrade window, rendered with sample data at /upgrade-lab (dev only, no
 * sign-in). Checks that the right plan is picked for the reason it opened,
 * that there is one action, and that it fits a laptop screen and a phone.
 */

type Page = import("@playwright/test").Page;

async function openScene(page: Page, scene: string) {
  await page.goto(`/upgrade-lab?scene=${scene}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("upgrade-lab-frame")).toHaveAttribute("data-ready", "true", {
    timeout: 120_000,
  });
  await expect(page.getByRole("dialog")).toBeVisible();
}

const last = (page: Page) => page.getByTestId("upgrade-lab-frame");

test.describe("Upgrade lab — laptop", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.setTimeout(180_000);

  test("a locked feature picks the plan that unlocks it and fits the screen", async ({ page }) => {
    await openScene(page, "feature");
    await expect(page.getByRole("heading", { name: "Unlock Autopilot" })).toBeVisible();
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("plan-growth")).toContainText("Unlocks Autopilot");
    await expect(page.getByTestId("plan-starter")).toBeDisabled();
    await expect(page.getByTestId("plan-details")).toContainText("Everything in Starter, plus");
    await expect(page.getByRole("button", { name: /^Upgrade to/ })).toHaveCount(1);

    // Nothing to scroll on a small laptop.
    const overflow = await page
      .getByRole("dialog")
      .locator(".overflow-y-auto")
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("picking a plan and a billing period changes what is bought", async ({ page }) => {
    await openScene(page, "plans");
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("plan-agency").click();
    await expect(page.getByTestId("plan-details")).toContainText("Everything in Growth, plus");
    await expect(page.getByText("You save $898")).toBeVisible();

    await page.getByRole("radio", { name: "Monthly" }).click();
    await page.getByRole("button", { name: "Upgrade to Agency" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "choose:plan:agency:$449 a month");

    // The request step, then the thank-you.
    await expect(page.getByText("We email you to pay")).toBeVisible();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("We got your request for the Agency plan")).toBeVisible();
  });

  test("an empty balance opens on packs with the smallest one that covers it", async ({ page }) => {
    await openScene(page, "credits");
    await expect(page.getByRole("heading", { name: "You're out of credits" })).toBeVisible();
    await expect(page.getByTestId("pack-credits_25")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("pack-credits_100").click();
    await page.getByRole("button", { name: "Buy 10,500 credits · $100" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "choose:credit_pack:credits_100:$100");
  });

  test("a reached limit and a teammate who can't buy say the right thing", async ({ page }) => {
    await openScene(page, "limit");
    await expect(
      page.getByText(/You're using 3 of 3 tracked competitors on Starter/),
    ).toBeVisible();
    await expect(page.getByTestId("plan-starter")).toContainText("Your plan");
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("aria-checked", "true");

    await openScene(page, "member");
    await expect(page.getByRole("button", { name: /^Upgrade to/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Ask the owner" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "ask:growth");
    await expect(page.getByText("Sent to the owner")).toBeVisible();
  });
});

test.describe("Upgrade lab — phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(180_000);

  test("stacks without sideways scroll", async ({ page }) => {
    await openScene(page, "feature");
    await expect(page.getByRole("button", { name: "Upgrade to Growth" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
