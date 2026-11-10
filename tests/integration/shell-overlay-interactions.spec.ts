import { expect, test } from "@playwright/test";
import { AUDIT_WORKSPACE, openAppUi, prepareAppUi } from "../fixtures/app-ui";

test("Library stays interactive and sidebar navigation works while it is open", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareAppUi(page, "light");
  await page.route("**/api/assets/library**", (route) =>
    route.fulfill({
      json: {
        assets: [
          {
            id: "00000000-0000-4000-8000-000000000005",
            type: "image",
            name: "Test library image",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0yQAAAAASUVORK5CYII=",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            workspaceId: AUDIT_WORKSPACE,
            status: "ready",
            platform: null,
            mimeType: "image/png",
            metadata: {},
          },
        ],
      },
    }),
  );
  await openAppUi(page);

  await page.getByRole("button", { name: "Library", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Library" });
  await expect(library).toBeVisible();
  await page.waitForTimeout(3_000);

  const mediaTab = library.getByRole("tab", { name: /Media/ });
  await mediaTab.click();
  await expect(mediaTab).toHaveAttribute("aria-selected", "true");
  const tile = library.getByTestId("library-tile");
  await expect(tile).toBeVisible();
  await tile.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-modal", "false");
  await page.evaluate(() => {
    document.body.style.pointerEvents = "none";
  });
  await expect
    .poll(() => page.locator("body").evaluate((body) => (body as HTMLElement).style.pointerEvents))
    .not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(library).toHaveCount(0);
});

test("Settings sections and controls switch in the workspace shell", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareAppUi(page, "light");
  await openAppUi(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  const tabs = dialog.getByRole("navigation", { name: "Settings" });
  for (const section of [
    "Social accounts",
    "Connectors",
    "AI assistants",
    "Agents",
    "Memory",
    "Language",
    "Preferences",
  ]) {
    const button = tabs.getByRole("button", { name: section, exact: true });
    if (!(await button.count())) continue;
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(dialog.getByRole("heading", { name: section })).toBeVisible();
  }

  const preferences = tabs.getByRole("button", { name: "Preferences" });
  await preferences.click();
  await expect(dialog.getByRole("radio", { name: "Dark" })).toBeVisible();
  const sounds = dialog.getByRole("switch", { name: "Sounds" });
  const original = await sounds.getAttribute("aria-checked");
  await sounds.click();
  await expect(sounds).toHaveAttribute("aria-checked", original === "true" ? "false" : "true");

  await tabs.getByRole("button", { name: "Connectors" }).click();
  await expect(dialog.getByRole("heading", { name: "Connectors" })).toBeVisible();
});

test("closing one blocking surface preserves another active modal lock", async ({ page }) => {
  test.setTimeout(90_000);
  await prepareAppUi(page, "light");
  await openAppUi(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("open:rename"));
    window.dispatchEvent(new CustomEvent("open:details"));
  });

  const rename = page.locator('[role="dialog"][data-modal="true"]').filter({
    hasText: "Rename workspace",
  });
  const details = page.locator('[role="dialog"][data-modal="true"]').filter({
    hasText: "Workspace details",
  });
  await expect(rename).toHaveCount(1);
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(rename).toBeVisible();
  await expect
    .poll(() => page.locator("body").evaluate((body) => (body as HTMLElement).style.pointerEvents))
    .toBe("none");

  await rename.getByRole("button", { name: "Cancel" }).click();
  await expect(rename).toHaveCount(0);
  await expect
    .poll(() => page.locator("body").evaluate((body) => (body as HTMLElement).style.pointerEvents))
    .not.toBe("none");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Library" })).toBeVisible();
});

test("mocked background generation does not block navigation and completes off-screen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareAppUi(page, "light");

  const jobId = "00000000-0000-4000-8000-000000000003";
  let status: "running" | "succeeded" = "running";
  let createRequests = 0;
  const jobFor = () => {
    const now = new Date().toISOString();
    return {
      id: jobId,
      workspace_id: AUDIT_WORKSPACE,
      type: "image",
      status,
      stage: status === "running" ? "render" : "save",
      stage_at: now,
      title: "Mock background image",
      input: {
        type: "image",
        idempotencyKey: "mock-background-job",
        intent: { brief: "Test a mocked background render" },
        controls: { platforms: [], referenceMode: "preserve" },
      },
      output: {},
      error: null,
      group_id: "00000000-0000-4000-8000-000000000004",
      parent_job_id: null,
      content_item_ids: [],
      asset_ids: [],
      attempt: 1,
      idempotency_key: "mock-background-job",
      created_at: now,
      updated_at: now,
      completed_at: status === "succeeded" ? now : null,
    };
  };
  await page.route("**/api/studio/jobs**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      createRequests += 1;
      return route.fulfill({ json: { job: jobFor() } });
    }
    if (request.url().includes(jobId)) return route.fulfill({ json: { job: jobFor() } });
    return route.fulfill({
      json: { jobs: status === "running" ? [jobFor()] : [] },
    });
  });

  await openAppUi(page);
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: /^Create( New)?$/ })
    .click();
  const create = page.getByRole("dialog", { name: "Create" });
  await expect(create).toBeVisible();
  await create.getByRole("button", { name: "Social posts" }).click();
  await page.getByRole("button", { name: /^Image post/ }).click();

  const brief = page.getByRole("textbox", { name: "Describe your image" });
  await expect(brief).toBeVisible();
  await brief.fill("Test a mocked background render");
  await page.getByRole("button", { name: /Format: Image post/ }).click();
  const formatPopover = page.locator(
    '[data-radix-popper-content-wrapper] [role="dialog"][data-modal="false"]',
  );
  await expect(formatPopover).toBeVisible();
  await page.evaluate(() => {
    document.body.style.pointerEvents = "none";
  });
  await expect
    .poll(() => page.locator("body").evaluate((body) => (body as HTMLElement).style.pointerEvents))
    .not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(formatPopover).toHaveCount(0);
  const studioDialog = page.locator('[role="dialog"][data-modal="false"]').last();
  await expect(studioDialog).toHaveAttribute("data-modal", "false");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("button", { name: /Studio: creating 1 piece/ })).toBeVisible();
  expect(createRequests).toBe(1);

  // Reproduce a stale lock left by a just-closed modal. An open canvas is
  // non-modal and must not keep the recovery guard from restoring the shell.
  await page.evaluate(() => {
    document.body.style.pointerEvents = "none";
  });
  await expect
    .poll(() => page.locator("body").evaluate((body) => (body as HTMLElement).style.pointerEvents))
    .not.toBe("none");

  await page.getByRole("button", { name: "Library", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Library" });
  await expect(library).toBeVisible();
  await expect(page.getByRole("button", { name: /Studio: creating 1 piece/ })).toBeVisible();
  // Keep the background job active long enough to cover the delayed transition
  // that previously left a stale interaction layer over Library and Settings.
  await page.waitForTimeout(10_000);
  await library.getByRole("tab", { name: /Media/ }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(library).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("open:settings")));
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  const preferences = settings
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Preferences" });
  await preferences.click();
  await expect(settings.getByRole("heading", { name: "Preferences" })).toBeVisible();

  status = "succeeded";
  await expect(page.getByRole("button", { name: /Studio: 1 ready to review/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(settings.getByRole("heading", { name: "Preferences" })).toBeVisible();
});
