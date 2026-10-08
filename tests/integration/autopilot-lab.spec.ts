import { test, expect } from "@playwright/test";

/**
 * Autopilot screens, rendered with sample data at /autopilot-lab (dev only, no
 * sign-in). Checks the one-screen setup, the home screen (what needs you, the
 * week, every job it runs), approving a post and acting on an idea, at desktop
 * and phone width.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Autopilot lab — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("setup is one screen: strategy, six rows, one button", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=setup", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Let Mellox run your marketing")).toBeVisible({
        timeout: 30_000,
      });
      await expect(frame.getByText("Brewing know-how")).toBeVisible();
      for (const row of [
        "Goal",
        "Where",
        "How often",
        "What",
        "Who approves",
        "Also",
        "Weekly limit",
      ]) {
        await expect(frame.getByText(row, { exact: true })).toBeVisible();
      }
      await frame.getByRole("button", { name: /How often/ }).click();
      await frame.getByRole("button", { name: "Every day", exact: true }).click();
      // Everything beyond posts is one row of switches.
      await frame.getByRole("button", { name: /^Also/ }).click();
      for (const job of ["AI visibility check", "Reuse what worked", "Weekly summary email"]) {
        await expect(frame.getByRole("switch", { name: job })).toBeChecked();
      }
      const toSite = frame.getByRole("switch", { name: "Articles to your website" });
      await expect(toSite).not.toBeChecked();
      await toSite.click();
      await expect(toSite).toBeChecked();
      await frame.getByRole("button", { name: "Turn on Autopilot" }).click();
      await expect(page.getByTestId("lab-last")).toContainText('"postsPerWeek":7');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test("home says what is happening and leads to the approval", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=home", { waitUntil: "domcontentloaded" });
      const frame = page.getByTestId("autopilot-lab-frame");
      await expect(frame.getByText("Autopilot is on")).toBeVisible({ timeout: 30_000 });
      await expect(frame.getByText(/1 post needs your OK/)).toBeVisible();
      // What is missing is asked for, with the button that fixes it.
      await expect(frame.getByText("Connect your social accounts")).toBeVisible();
      await frame.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["accounts"]');
      // The pipeline, the week day by day and what was learned are on the page.
      await expect(frame.getByRole("list", { name: "Where your posts are" })).toBeVisible();
      const week = frame.getByRole("list", { name: "Next 7 days" });
      await expect(week.getByText("Three questions to ask your roaster")).toBeVisible();
      await expect(frame.getByText(/reaches about 2.4× more people/)).toBeVisible();
      // Every job Autopilot runs, with where it stands and where it leads.
      const jobs = frame.getByRole("list", { name: "What Autopilot runs" });
      await expect(jobs.getByText("AI visibility", { exact: true })).toBeVisible();
      await expect(jobs.getByText("sent to beanhaus.example")).toBeVisible();
      await expect(jobs.getByText(/Best post reused/)).toBeVisible();
      await expect(jobs.getByText(/^Sent .* ago$/)).toBeVisible();
      await jobs.getByRole("button", { name: /AI visibility/ }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["visibility"]');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
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

    test("the message box: a switch when off, the whole box when on", async ({ page }) => {
      await page.goto("/autopilot-lab?scene=box", { waitUntil: "domcontentloaded" });
      const box = page.getByTestId("box");
      // Off: the box is for typing, with one switch in its toolbar.
      const toggle = box.getByRole("switch", { name: "Turn on Autopilot" });
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(box.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();

      // Flipping it shows what Mellox proposes, in the box, with one button.
      await toggle.click();
      await expect(box.getByText("5 a week")).toBeVisible();
      await expect(box.getByRole("textbox")).toHaveCount(0);
      await box.getByRole("button", { name: "Turn on", exact: true }).click();
      await expect(page.getByTestId("lab-last")).toContainText('start [{"mode":"full"');

      // On: the box is covered, the top bar says so too.
      await expect(box.getByText("Autopilot is on")).toBeVisible();
      await expect(box.getByRole("list", { name: "Where your posts are" })).toBeVisible();
      await expect(box.getByRole("list", { name: "Next 7 days" })).toBeVisible();
      await expect(box.getByTestId("deck-also")).toContainText("AI visibility 72");
      await expect(
        page.getByTestId("box-topbar").getByRole("button", { name: /Autopilot is on/ }),
      ).toBeVisible();
      await box.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByTestId("lab-last")).toContainText('open ["approvals"]');

      // The switch pauses it; the box stays covered and says so.
      await box.getByRole("switch", { name: "Pause Autopilot" }).click();
      await expect(box.getByText("Autopilot is paused")).toBeVisible();
      await box.getByRole("switch", { name: "Turn Autopilot back on" }).click();
      await expect(box.getByText("Autopilot is on")).toBeVisible();

      // Writing is always one tap away, and the box stays lit while it runs.
      await box.getByRole("button", { name: "Write" }).click();
      const input = box.getByRole("textbox", { name: "Message Mellox" });
      await expect(input).toBeFocused();
      await expect(box.locator(".mx-composer")).toHaveAttribute("data-autopilot", "on");
      await box.getByRole("switch", { name: "Autopilot is on. Show it." }).click();
      await expect(box.getByText("Autopilot is on")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
