import { expect, test, type Page } from "@playwright/test";

type Fixture = {
  patches: Record<string, unknown>[];
  failNext: boolean;
  holdSave: boolean;
  holdRead: boolean;
  readHeld: boolean;
  saved: number;
  releaseSave?: () => void;
  releaseRead?: () => void;
};

async function openCalendar(page: Page) {
  await page.addInitScript(() => {
    const state: Fixture = {
      patches: [],
      failNext: false,
      holdSave: false,
      holdRead: false,
      readHeld: false,
      saved: 0,
    };
    (window as unknown as { calendarFixture: Fixture }).calendarFixture = state;
    let current = window.fetch;
    Object.defineProperty(window, "fetch", {
      configurable: true,
      get() {
        const underlying = current;
        return async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const path = new URL(url, window.location.origin).pathname;
          if (path.endsWith("/content/updateContentItem")) {
            const patch = JSON.parse(String(init?.body)).data.patch as Record<string, unknown>;
            state.patches.push(patch);
            if ("body" in patch && state.failNext) {
              state.failNext = false;
              return new Response(JSON.stringify({ error: "Synthetic save failure" }), {
                status: 503,
                headers: { "content-type": "application/json" },
              });
            }
            if ("body" in patch && state.holdSave) {
              state.holdSave = false;
              await new Promise<void>((resolve) => {
                state.releaseSave = resolve;
              });
            }
            const response = await underlying(input, init);
            if ("body" in patch) state.saved++;
            return response;
          }
          if (path.endsWith("/content/listContentItems") && state.holdRead) {
            state.holdRead = false;
            const response = await underlying(input, init);
            state.readHeld = true;
            await new Promise<void>((resolve) => {
              state.releaseRead = resolve;
            });
            return response;
          }
          return underlying(input, init);
        };
      },
      set(value) {
        current = value;
      },
    });
  });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Synthetic local fixture" } }),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/calendar-lab?autopilot=off", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog", { name: "Content Calendar" })).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole("button", { name: /^Three ways to keep oat milk fresh/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Edit post" })).toBeVisible();
}

test("failed autosave blocks approval, retains the edit and permits retry", async ({ page }) => {
  await openCalendar(page);
  await page.evaluate(() => {
    (window as unknown as { calendarFixture: Fixture }).calendarFixture.failNext = true;
  });
  await page
    .getByRole("textbox", { name: "Caption", exact: true })
    .fill("The latest caption must be saved first.");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.click();
  await expect(page.getByText("Couldn't approve", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { calendarFixture: Fixture }).calendarFixture.patches.some(
        (patch) => patch.status === "approved",
      ),
    ),
  ).toBe(false);
  await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toHaveValue(
    "The latest caption must be saved first.",
  );
  await approve.click();
  await expect(page.getByRole("button", { name: "Back to draft" })).toBeVisible();
  const patches = await page.evaluate(
    () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.patches,
  );
  expect(patches.at(-2)).toMatchObject({ body: "The latest caption must be saved first." });
  expect(patches.at(-1)).toEqual({ status: "approved" });
});

test("approval waits for a running save and all newer edits", async ({ page }) => {
  await openCalendar(page);
  await page.evaluate(() => {
    (window as unknown as { calendarFixture: Fixture }).calendarFixture.holdSave = true;
  });
  await page.getByRole("textbox", { name: "Caption", exact: true }).fill("First caption");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.patches.length,
      ),
    )
    .toBe(1);
  await page.getByRole("textbox", { name: "Caption", exact: true }).fill("Second caption");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.patches.length,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { calendarFixture: Fixture }).calendarFixture.releaseSave?.(),
  );
  await expect(page.getByRole("button", { name: "Back to draft" })).toBeVisible();
  const patches = await page.evaluate(
    () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.patches,
  );
  expect(patches.map((patch) => patch.body ?? patch.status)).toEqual([
    "First caption",
    "Second caption",
    "approved",
  ]);
  await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toHaveValue(
    "Second caption",
  );
});

test("an older calendar read cannot overwrite a completed edit", async ({ page }) => {
  await openCalendar(page);
  await page.evaluate(() => {
    (window as unknown as { calendarFixture: Fixture }).calendarFixture.holdRead = true;
    window.dispatchEvent(new Event("content:changed"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.readHeld,
      ),
    )
    .toBe(true);
  await page.getByRole("textbox", { name: "Caption", exact: true }).fill("Keep the saved caption");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { calendarFixture: Fixture }).calendarFixture.saved,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as unknown as { calendarFixture: Fixture }).calendarFixture.releaseRead?.(),
  );
  await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toHaveValue(
    "Keep the saved caption",
  );
});
