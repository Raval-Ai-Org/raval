import { test, expect } from "@playwright/test";

/**
 * The upgrade window, rendered with sample data at /upgrade-lab (dev only, no
 * sign-in). Checks that the right plan is highlighted for the reason it
 * opened, that every plan can still be bought, and that it works on a laptop
 * screen and a phone.
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

  test("a locked feature highlights the plan that unlocks it and keeps the others buyable", async ({
    page,
  }) => {
    await openScene(page, "feature");
    await expect(page.getByRole("heading", { name: "Unlock Autopilot" })).toBeVisible();
    await expect(page.getByText("On Growth and above")).toBeVisible();
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("data-recommended", "true");
    await expect(page.getByTestId("plan-growth")).toContainText("Unlocks Autopilot");
    await expect(page.getByTestId("plan-growth")).toContainText("Everything in Starter, plus");
    await expect(page.getByTestId("plan-growth")).toContainText("6,000 credits a month");

    // The smaller plan says what it leaves out, and can still be chosen.
    await expect(page.getByTestId("missing-starter")).toContainText("Autopilot is not included");
    await expect(page.getByTestId("missing-growth")).toHaveCount(0);
    for (const name of ["Starter", "Growth", "Agency", "Scale"]) {
      const button = page.getByRole("button", { name: `Upgrade to ${name}` });
      await expect(button).toBeEnabled();
      if (name !== "Scale") await expect(button).toBeInViewport();
    }
    await page.getByRole("button", { name: "Upgrade to Starter" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "choose:plan:starter:$490 a year");
  });

  test("picking a plan and a billing period changes what is bought", async ({ page }) => {
    await openScene(page, "plans");
    await expect(page.getByRole("heading", { name: "Do more with Mellox" })).toBeVisible();
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("data-recommended", "true");
    await expect(page.getByTestId("plan-growth")).toContainText("Recommended");
    await expect(page.getByTestId("plan-agency")).toContainText("Save $898");

    await page.getByRole("radio", { name: "Monthly" }).click();
    await expect(page.getByTestId("plan-agency")).toContainText("Save $898 with yearly");
    await page.getByRole("button", { name: "Upgrade to Agency" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "choose:plan:agency:$449 a month");

    // The request step, then the thank-you.
    await expect(page.getByText("We email you to pay")).toBeVisible();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("We got your request for the Agency plan")).toBeVisible();
  });

  test("out of free credits shows plans first, with packs one tab away", async ({ page }) => {
    await openScene(page, "empty");
    await expect(
      page.getByRole("heading", { name: "You've used your free credits" }),
    ).toBeVisible();
    await expect(page.getByTestId("plan-starter")).toHaveAttribute("data-recommended", "true");
    await expect(page.getByTestId("plan-starter")).toContainText("2,000 credits a month");

    await page.getByRole("tab", { name: "Credit packs" }).click();
    await expect(page.getByTestId("pack-credits_25")).toHaveAttribute("aria-checked", "true");
  });

  test("the packs view picks the smallest pack that covers what is needed", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Upgrade to Starter" })).toHaveCount(0);
    await expect(page.getByTestId("plan-growth")).toHaveAttribute("data-recommended", "true");

    await openScene(page, "member");
    await expect(page.getByRole("button", { name: /^Upgrade to/ })).toHaveCount(0);
    await page.getByTestId("plan-growth").getByRole("button", { name: "Ask the owner" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "ask:growth");
    await expect(page.getByText("Sent to the owner").first()).toBeVisible();
  });
});

test.describe("Upgrade lab — pushes inside the app", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.setTimeout(180_000);

  test("the Free card, the chat line and the locked list say the real numbers", async ({
    page,
  }) => {
    await page.goto("/upgrade-lab?scene=pushes", { waitUntil: "domcontentloaded" });
    await expect(last(page)).toHaveAttribute("data-ready", "true", { timeout: 120_000 });

    const cards = page.getByTestId("free-sidebar-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("64 of 100 credits");
    await expect(cards.nth(0)).toContainText("Get 2,000 every month");
    await expect(cards.nth(1)).toContainText("16 free credits left");
    await expect(cards.nth(2)).toContainText("You've used your free credits");

    // The chat line only shows once credits are low or gone.
    const strips = page.getByTestId("free-credit-strip");
    await expect(strips).toHaveCount(2);
    await strips.nth(0).getByRole("button", { name: "See plans" }).click();
    await expect(last(page)).toHaveAttribute("data-last", "plans:16");

    await page
      .getByTestId("locked-features")
      .getByRole("button", { name: /Autopilot/ })
      .click();
    await expect(last(page)).toHaveAttribute("data-last", "feature:autopilot");
  });
});

test.describe("Upgrade lab — phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(180_000);

  test("stacks with the recommended plan first and no sideways scroll", async ({ page }) => {
    await openScene(page, "feature");
    await expect(page.getByRole("button", { name: "Upgrade to Growth" })).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
