import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`small loading indicators keep rotating with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/login");

    // Use the same global classes as button, link, refresh, and page loaders.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999";
      host.innerHTML = `
        <svg id="button-spinner" data-icon="spinner" class="animate-spin" width="20" height="20" viewBox="0 0 24 24">
          <path d="M20 12a8 8 0 0 0 -8 -8" stroke="currentColor" fill="none" />
        </svg>
        <svg id="refresh-spinner" class="animate-spin" width="20" height="20" viewBox="0 0 24 24">
          <path d="M20 12a8 8 0 0 0 -8 -8" stroke="currentColor" fill="none" />
        </svg>
        <span id="border-spinner" class="inline-block size-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
        <span id="ui-spinner" class="ui-spinner"></span>
        <span class="mx-loader" style="width:56px;height:56px"><span id="page-spinner" class="mx-loader__ring"></span></span>
        <span id="brand-scan" class="ds-scan" style="display:block;width:80px;height:80px"></span>
      `;
      document.body.append(host);
    });

    const angles = () =>
      page.evaluate(() =>
        ["button-spinner", "refresh-spinner", "border-spinner", "ui-spinner", "page-spinner"].map(
          (id) => {
            const transform = getComputedStyle(document.getElementById(id)!).transform;
            const matrix = new DOMMatrixReadOnly(transform);
            return Math.atan2(matrix.b, matrix.a);
          },
        ),
      );

    const before = await angles();
    const scanBefore = await page.evaluate(
      () => getComputedStyle(document.getElementById("brand-scan")!, "::after").transform,
    );
    await page.waitForTimeout(180);
    const after = await angles();
    const scanAfter = await page.evaluate(
      () => getComputedStyle(document.getElementById("brand-scan")!, "::after").transform,
    );

    for (const [index, angle] of after.entries()) {
      const delta = Math.atan2(Math.sin(angle - before[index]), Math.cos(angle - before[index]));
      expect(Math.abs(delta), `spinner ${index} should visibly rotate`).toBeGreaterThan(0.3);
    }
    expect(scanAfter, "brand analysis sweep should keep moving").not.toBe(scanBefore);
  });
}

test("chat's reduced-motion setting keeps active progress cues moving", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    document.documentElement.dataset.chatMotion = "reduced";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:8px;left:8px;z-index:9999";
    host.innerHTML = `
      <span id="thinking" class="mx-shimmer">Thinking…</span>
      <span id="reading" class="composer-shimmer-text">Reading…</span>
      <span id="attachment" class="composer-skel-chip" style="display:inline-block;width:20px;height:20px"></span>
    `;
    document.body.append(host);
  });

  const positions = () =>
    page.evaluate(() => ({
      thinking: getComputedStyle(document.getElementById("thinking")!).backgroundPosition,
      reading: getComputedStyle(document.getElementById("reading")!).backgroundPosition,
      attachment: getComputedStyle(document.getElementById("attachment")!, "::after").transform,
    }));

  const before = await positions();
  await page.waitForTimeout(200);
  const after = await positions();

  expect(after.thinking).not.toBe(before.thinking);
  expect(after.reading).not.toBe(before.reading);
  expect(after.attachment).not.toBe(before.attachment);
});
