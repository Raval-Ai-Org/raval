import { expect, test, type Page } from "@playwright/test";
import { AUDIT_WORKSPACE, openAppUi, prepareAppUi } from "../fixtures/app-ui";

// Canvas screens (Create, Studio, Library…) are part of the page on a desktop:
// drawn inside the workspace column, never laid over it. So they follow the
// sidebar when it collapses, and a piece being made never holds the canvas:
// Home and Chat always show Home and Chat, and the work stays in the list.

const jobId = "00000000-0000-4000-8000-000000000033";

async function mockRunningJob(page: Page) {
  const job = () => {
    const now = new Date().toISOString();
    return {
      id: jobId,
      workspace_id: AUDIT_WORKSPACE,
      type: "image",
      status: "running",
      stage: "render",
      stage_at: now,
      title: "Mock canvas image",
      input: {
        type: "image",
        idempotencyKey: "mock-canvas-job",
        intent: { brief: "A picture that takes a while" },
        controls: { platforms: [], referenceMode: "preserve" },
      },
      output: {},
      error: null,
      group_id: "00000000-0000-4000-8000-000000000034",
      parent_job_id: null,
      content_item_ids: [],
      asset_ids: [],
      attempt: 1,
      idempotency_key: "mock-canvas-job",
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
  };
  await page.route("**/api/studio/jobs**", (route) => {
    const request = route.request();
    if (request.method() === "POST" || request.url().includes(jobId))
      return route.fulfill({ json: { job: job() } });
    return route.fulfill({ json: { jobs: [job()] } });
  });
}

const screens = (page: Page) => page.locator("[data-canvas-host] > [role='dialog']");
// A row's name includes its corner badge ("Create New").
const sidebar = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: new RegExp(`^${name}( New| Beta)?$`) })
    .first();

test("a canvas screen is part of the page and follows the sidebar", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareAppUi(page, "light");
  await openAppUi(page);

  await sidebar(page, "Create").click();
  const screen = screens(page);
  await expect(screen).toBeVisible({ timeout: 30_000 });
  // Drawn in the column, not fixed over the window, and never modal.
  expect(await screen.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  await expect(screen).toHaveAttribute("data-modal", "false");
  expect(
    await page.locator("body").evaluate((b) => (b as HTMLElement).style.pointerEvents),
  ).not.toBe("none");

  const column = page.locator("[data-workspace-column]");
  const same = async () => {
    const [a, b] = await Promise.all([screen.boundingBox(), column.boundingBox()]);
    return a && b ? Math.abs(a.x - b.x) + Math.abs(a.width - b.width) : 999;
  };
  expect(await same()).toBeLessThan(1);

  // Collapsing the sidebar resizes the screen with the canvas: no gap.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await column.boundingBox())?.x).toBe(60);
  expect(await same()).toBeLessThan(1);
  await expect(screen).toBeVisible();

  await page.getByRole("button", { name: "Open sidebar" }).first().click();
  await expect.poll(async () => (await column.boundingBox())?.x).toBeGreaterThan(150);
  expect(await same()).toBeLessThan(1);
});

test("a piece being made never holds the canvas", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareAppUi(page, "light");
  await mockRunningJob(page);
  await openAppUi(page);

  await sidebar(page, "Create").click();
  // The screen's title follows the step (Create → Social posts).
  const create = screens(page);
  await expect(create).toBeVisible({ timeout: 30_000 });
  await create.getByRole("button", { name: "Social posts" }).click();
  await create.getByRole("button", { name: /^Image post/ }).click();
  const brief = page.getByRole("textbox", { name: "Describe your image" });
  await expect(brief).toBeVisible({ timeout: 30_000 });
  await brief.fill("A picture that takes a while");

  // Generate gets out of the way at once: no loading page over the canvas.
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(screens(page)).toHaveCount(0);
  const list = page.getByRole("region", { name: "Generating" });
  await expect(list).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();

  // A press on the row opens the progress screen, inside the canvas.
  const row = list.getByRole("button", { name: /Mock canvas image|A picture that takes/ });
  for (const place of ["Home", "Chat"]) {
    await row.first().click();
    await expect(screens(page)).toHaveCount(1);
    await expect(screens(page).getByText(/Creating your image/)).toBeVisible({ timeout: 30_000 });
    // While it is open the list folds into the corner pill.
    await expect(page.getByRole("button", { name: /Making 1 piece/ })).toBeVisible();
    // Give the progress screen time to tick, as it does for a real piece.
    await page.waitForTimeout(2_500);

    await sidebar(page, place).click();
    await expect(screens(page)).toHaveCount(0);
    await expect(list).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible();
    expect(
      await page.locator("body").evaluate((b) => (b as HTMLElement).style.pointerEvents),
    ).not.toBe("none");
  }
});
