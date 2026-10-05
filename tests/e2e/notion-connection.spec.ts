import { expect, test, type Route } from "@playwright/test";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
test.skip(
  !EMAIL || !PASSWORD,
  "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for the Mellox test workspace",
);

const destinationId = "33333333-3333-4333-8333-333333333333";
const pageId = "44444444-4444-4444-8444-444444444444";
const json = (route: Route, result: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result }) });

test("Settings connects, selects a calendar, imports, syncs, and disconnects", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  const workspaceId = await page.evaluate(() => localStorage.getItem("workspace:selected"));
  expect(workspaceId, "Test account needs a selected editor workspace").toBeTruthy();
  let connected = false;
  let selected = false;
  const calls: string[] = [];
  await context.route("**/api/rpc/notion/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/rpc/", "");
    calls.push(path);
    if (path === "notion/getNotionConnection")
      return json(route, {
        configured: true,
        status: connected ? "active" : "disconnected",
        workspaceName: connected ? "Editorial Workspace" : null,
        destinationName: selected ? "Mellox Content Calendar" : null,
        destinationUrl: selected ? "https://www.notion.so/33333333333343338333333333333333" : null,
        dataSourceId: selected ? destinationId : null,
        lastSyncAt: null,
      });
    if (path === "notion/startNotionConnect") {
      connected = true;
      return json(route, { url: `/w/${workspaceId}/app?settings=accounts&notion=connected` });
    }
    if (path === "notion/listNotionDestinations")
      return json(route, [
        {
          id: destinationId,
          databaseId: destinationId,
          name: "Mellox Content Calendar",
          url: null,
          kind: "data_source",
        },
      ]);
    if (path === "notion/selectNotionDestination") {
      selected = true;
      return json(route, {});
    }
    if (path === "notion/previewNotionImport")
      return json(route, {
        total: 1,
        valid: 1,
        invalid: 0,
        duplicates: 0,
        rows: [{ pageId, title: "Notion plan", valid: true, duplicate: false, error: null }],
      });
    if (path === "notion/importFromNotion")
      return json(route, {
        imported: 1,
        updated: 0,
        skipped: 0,
        invalid: 0,
        conflicts: 0,
        failed: 0,
      });
    if (path === "notion/exportToNotion")
      return json(route, { exported: 1, updated: 0, skipped: 0, conflicts: 0, failed: 0 });
    if (path === "notion/syncNotionNow")
      return json(route, {
        imported: 0,
        exported: 0,
        updated: 1,
        skipped: 0,
        conflicts: 0,
        failed: 0,
      });
    if (path === "notion/disconnectNotion") {
      connected = false;
      selected = false;
      return json(route, { disconnected: true });
    }
    return json(route, null);
  });

  await page.goto(`/w/${workspaceId}/app?settings=accounts`);
  const card = page.getByRole("region", { name: "Notion connection" });
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card.getByRole("button", { name: "Connect Notion" })).toBeEnabled();
  await card.getByRole("button", { name: "Connect Notion" }).click();
  await expect(page.getByRole("dialog", { name: "Choose a Notion calendar" })).toBeVisible();
  await page.getByRole("button", { name: "Mellox Content Calendar" }).click();
  await expect(card.getByText("Editorial Workspace")).toBeVisible();
  await card.getByRole("button", { name: "Export to Notion" }).click();
  await expect(page.getByRole("dialog", { name: "Notion sync result" })).toContainText(
    "1 exported",
  );
  await page.getByRole("dialog", { name: "Notion sync result" }).press("Escape");
  await card.getByRole("button", { name: "Import from Notion" }).click();
  await expect(page.getByRole("dialog", { name: "Import from Notion" })).toContainText("1 valid");
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("dialog", { name: "Notion sync result" })).toContainText(
    "1 imported",
  );
  await page.getByRole("dialog", { name: "Notion sync result" }).press("Escape");
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("dialog", { name: "Notion sync result" })).toContainText("1 updated");
  await page.getByRole("dialog", { name: "Notion sync result" }).press("Escape");
  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Existing content in Mellox and Notion will not be deleted",
  );
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByRole("button", { name: "Connect Notion" })).toBeVisible();
  expect(calls).toContain("notion/exportToNotion");
  expect(calls).toContain("notion/importFromNotion");
  expect(calls).toContain("notion/syncNotionNow");
});
