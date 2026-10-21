import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_HOST } from "../fixtures/supabase-ref";

function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: "00000000-0000-0000-0000-000000000002",
    email: "confirm@example.test",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
  };
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp, aud: user.aud })}.fake-signature`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
}

async function mockConfirmation(page: Page, workspaceFails = false, verifyFails = false) {
  const authSession = session();
  const calls = { verifies: 0, workspaces: 0 };
  await page.route(`https://${SUPABASE_HOST}/auth/v1/**`, (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/verify")) {
      calls.verifies++;
      if (verifyFails && calls.verifies === 1)
        return route.fulfill({
          status: 400,
          json: { code: "otp_expired", message: "private-otp-diagnostics" },
        });
      return route.fulfill({ json: authSession });
    }
    return route.fulfill({ json: authSession.user });
  });
  await page.route("**/api/rpc/workspaces/ensureAuthWorkspace", (route) => {
    calls.workspaces++;
    return workspaceFails && calls.workspaces === 1
      ? route.fulfill({ status: 503, json: { error: "private-workspace-diagnostics" } })
      : route.fulfill({ json: { result: null } });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "mellox:auth-next",
      JSON.stringify({ next: "/reset-password?confirmed=1", at: Date.now() }),
    ),
  );
  return calls;
}

test("workspace setup retry does not resubmit a consumed email token", async ({ page }) => {
  const calls = await mockConfirmation(page, true);
  await page.goto(`/auth/confirm#token_hash=${"a".repeat(64)}&type=email`);
  const confirm = page.getByRole("button", { name: "Confirm email", exact: true });
  await confirm.click();
  await expect(page.getByText(/Your email is confirmed, but/)).toBeVisible();
  await expect(confirm).toBeEnabled();
  expect(await page.content()).not.toContain("private-workspace-diagnostics");
  await confirm.click();
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/, { timeout: 20_000 });
  expect(calls).toEqual({ verifies: 1, workspaces: 2 });
});

test("a rejected email token remains retryable without leaking provider details", async ({
  page,
}) => {
  const calls = await mockConfirmation(page, false, true);
  await page.goto(`/auth/confirm#token_hash=${"a".repeat(64)}&type=email`);
  const confirm = page.getByRole("button", { name: "Confirm email", exact: true });
  await confirm.click();
  await expect(page.getByText(/This link could not be confirmed/)).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls.workspaces).toBe(0);
  expect(await page.content()).not.toContain("private-otp-diagnostics");
  await confirm.click();
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/, { timeout: 20_000 });
  expect(calls).toEqual({ verifies: 2, workspaces: 1 });
});

test("duplicate confirmation clicks verify once", async ({ page }) => {
  const calls = await mockConfirmation(page);
  await page.goto(`/auth/confirm#token_hash=${"a".repeat(64)}&type=email`);
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/, { timeout: 20_000 });
  expect(calls).toEqual({ verifies: 1, workspaces: 1 });
});

test("recovery confirmation opens the password form without workspace setup", async ({ page }) => {
  const calls = await mockConfirmation(page);
  await page.goto(`/auth/confirm#token_hash=${"a".repeat(64)}&type=recovery`);
  await page.getByRole("button", { name: "Continue to password reset" }).click();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(calls).toEqual({ verifies: 1, workspaces: 0 });
});
