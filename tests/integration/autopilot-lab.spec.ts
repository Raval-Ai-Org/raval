import { test, expect } from "@playwright/test";

/**
 * Autopilot screens, rendered with sample data at /autopilot-lab (dev only, no
 * sign-in). Checks the step-by-step setup, the home screen (the flow, what
 * needs you, what comes next, the places it works with, every job it runs),
 * approving a post, acting on an idea, and Home's Autopilot card, which never
 * covers the message box, at desktop and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function noSideScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Autopilot lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("setup is five steps, each answer already proposed", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=setup", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      const steps = frame.getByRole("list", { name: "Steps" });
      await expect(steps).toBeVisible({ timeout: 30_000 });
      for (const step of ["Goal", "Channels", "Rhythm", "Approval", "Ready"]) {
        await expect(steps.getByText(step, { exact: true })).toBeVisible();
      }

      // 1. Goal: big cards, the proposed one already chosen.
      await expect(frame.getByRole("radiogroup", { name: "Goal" })).toBeVisible();
      await frame.getByRole("radio", { name: "Sell more" }).click();
      await expect(frame.getByRole("radio", { name: "Sell more" })).toBeChecked();
      const next = frame.getByRole("button", { name: "Next" });
      await next.click();

      // 2. Channels: app icons, Stories as one switch.
      await expect(frame.getByRole("switch", { name: "Daily Stories too" })).toBeVisible();
      await next.click();

      // 3. Rhythm: how often and what Mox makes.
      await frame.getByRole("radio", { name: "Every day" }).click();
      await expect(frame.getByRole("group", { name: "What Mox makes" })).toBeVisible();
      await next.click();

      // 4. Approval.
      await expect(frame.getByRole("radiogroup", { name: "Who approves" })).toBeVisible();
      await next.click();

      // 5. Ready: the recap, the strategy, what it works with, one button.
      await expect(frame.getByText("Brewing know-how")).toBeVisible();
      await expect(frame.getByRole("list", { name: "Works with" })).toBeVisible();
      // Fine-tune opens the same rows as Settings.
      await frame.getByRole("button", { name: "Fine-tune" }).click();
      await frame.getByRole("button", { name: /^Also/ }).click();
      for (const job of ["AI visibility check", "Reuse what worked", "Weekly summary email"]) {
        await expect(frame.getByRole("switch", { name: job })).toBeChecked();
      }
      await frame.getByRole("button", { name: "Turn on Autopilot" }).click();
      await expect(page.getByTestId("lab-last")).toContainText('"postsPerWeek":7');
      await expect(page.getByTestId("lab-last")).toContainText('"goal":"sales"');
      await noSideScroll(page);
    });

    test("a step can be revisited from the recap", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=setup", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      const next = frame.getByRole("button", { name: "Next" });
      await expect(next).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < 4; i++) await next.click();
      await frame.getByRole("button", { name: "Change goal" }).click();
      await expect(frame.getByRole("radiogroup", { name: "Goal" })).toBeVisible();
      // The first step has nothing to go back to.
      await expect(frame.getByRole("button", { name: "Back" })).toHaveCount(0);
    });

    test("home says what is happening and leads to the approval", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=home", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Autopilot is on")).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText(/Plans around Winter blend launch/)).toBeVisible();
      await expect(frame.getByText(/1 post needs your OK/)).toBeVisible();
      // What is missing is asked for, with the button that fixes it.
      await expect(frame.getByText("Connect your social accounts")).toBeVisible();
      await frame.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["accounts"]');
      // The flow, the next pieces, the week and what was learned are on the page.
      await expect(frame.getByRole("list", { name: "Where your posts are" })).toBeVisible();
      await expect(frame.getByRole("list", { name: "Coming up" })).toBeVisible();
      const week = frame.getByRole("list", { name: "Next 7 days" });
      await expect(week.getByText("Three questions to ask your roaster")).toBeVisible();
      await expect(frame.getByText(/reaches about 2.4× more people/)).toBeVisible();
      // It works with Calendar, Campaigns, Inspo and Library.
      const places = frame.getByRole("list", { name: "Works with" });
      await places.getByRole("button", { name: /^Library/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["library"]');
      await places.getByRole("button", { name: /^Campaigns/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["campaign-list"]');
      // Every job Autopilot runs, with where it stands and where it leads.
      const jobs = frame.getByRole("list", { name: "What Autopilot runs" });
      await expect(jobs.getByText("AI visibility", { exact: true })).toBeVisible();
      await expect(jobs.getByText("sent to beanhaus.example")).toBeVisible();
      await jobs.getByRole("button", { name: /AI visibility/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["visibility"]');
      await noSideScroll(page);
      await frame.getByRole("button", { name: "Review" }).click();
      // The score Mellox already gave this exact text is on the card.
      await expect(frame.getByText("Mellox Score")).toBeVisible();
      await frame.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText("decide");
      await expect(page.getByTestId("lab-last")).toContainText('"approve"');
    });

    test("an idea shows its source and becomes a post in one tap", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=ideas", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Beanhaus: launched a winter subscription box")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByRole("link", { name: /Beanhaus blog/ })).toHaveAttribute(
        "href",
        "https://example.com/beanhaus",
      );
      await frame.getByRole("button", { name: "Create post" }).first().click();
      await expect(page.getByTestId("lab-last")).toContainText('"decision":"create"');
    });

    test("Home's Autopilot card: an invite when off, the work at a glance when on", async ({
      page,
    }) => {
      await page.goto("/autopilot-lab?scene=card", { waitUntil: "domcontentloaded" });

      // Off: four pictured steps and one button into the setup.
      const off = page.getByTestId("card-off");
      await expect(off.getByText("Put your posts on")).toBeVisible({ timeout: 30_000 });
      await expect(off.getByRole("list", { name: "Setup steps" })).toBeVisible();
      await off.getByRole("button", { name: "Set it up", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText("open");

      // On: the flow, the next pieces, what it works with and what waits.
      const live = page.getByTestId("card-live");
      await expect(live.getByText("Autopilot is on")).toBeVisible();
      await expect(live.getByText(/Plans around Winter blend launch/)).toBeVisible();
      await expect(live.getByRole("list", { name: "Where your posts are" })).toBeVisible();
      await expect(live.getByRole("list", { name: "Coming up" })).toBeVisible();
      await live.getByRole("button", { name: /to approve$/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["approvals"]');
      await live.getByRole("button", { name: /^Calendar/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('place ["calendar"]');

      // Pausing is one press, and the card says so.
      await live.getByRole("button", { name: "Pause Autopilot" }).click();
      await expect(live.getByText("Autopilot is paused")).toBeVisible();
      await live.getByRole("button", { name: "Resume Autopilot" }).click();
      await expect(live.getByText("Autopilot is on")).toBeVisible();

      // The whole card opens Autopilot.
      await live.getByRole("button", { name: "Open Autopilot" }).click();
      await expect(page.getByTestId("lab-last")).toContainText("open");

      // While the first plan is written, it says so.
      await expect(
        page.getByTestId("card-planning").getByText(/writing this week's plan/),
      ).toBeVisible();

      // The message box stays a message box: no cover, no Autopilot switch.
      const box = page.getByTestId("box");
      await expect(box.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();
      await expect(box.getByRole("switch")).toHaveCount(0);
      await noSideScroll(page);
    });
  });
}
