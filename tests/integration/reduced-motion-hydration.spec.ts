import { expect, test } from "@playwright/test";
import { prepareAppUi } from "../fixtures/app-ui";

test.setTimeout(90_000);

for (const scene of ["links", "story", "auth"] as const) {
  test(`${scene} hydrates with reduced motion without replacing server HTML`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (scene === "auth") {
      await page.context().route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
      await page.context().route("**/api/**", (route) => route.fulfill({ json: {} }));
    } else {
      await prepareAppUi(page, "light");
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|did not match/i.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(
      scene === "links"
        ? "/links-lab"
        : scene === "auth"
          ? "/login"
          : "/studio-lab?scene=review-story&device=phone",
      { waitUntil: "domcontentloaded" },
    );
    if (scene === "links") {
      await expect(page.getByText("7", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    } else if (scene === "auth") {
      await expect(
        page.getByText("A launch post for our spring collection", { exact: true }),
      ).toBeVisible({ timeout: 60_000 });
    } else {
      await expect(page.locator('[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
