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
          json: { code: "unexpected_failure", message: "private-otp-diagnostics" },
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

test("PKCE link survives scanner loads and mobile reload without verifying until confirmation", async ({
  page,
  request,
}) => {
  const calls = await mockConfirmation(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const token = `pkce_${"c".repeat(56)}`;
  await request.head("/auth/confirm");
  await request.get("/auth/confirm");
  await page.goto(`/auth/confirm#token_hash=${token}&type=email`);
  const confirm = page.getByRole("button", { name: "Confirm email", exact: true });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  expect(calls).toEqual({ verifies: 0, workspaces: 0 });
  await page.reload();
  await expect(confirm).toBeVisible();
  expect(calls.verifies).toBe(0);
  const verified = page.waitForRequest((req) => new URL(req.url()).pathname.endsWith("/verify"));
  await confirm.click();
  expect((await verified).postDataJSON()).toMatchObject({ token_hash: token, type: "email" });
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/);
  expect(calls).toEqual({ verifies: 1, workspaces: 1 });
});

test("verified session resumes setup after reload without using the token twice", async ({
  page,
}) => {
  const calls = await mockConfirmation(page, true);
  await page.goto(`/auth/confirm#token_hash=pkce_${"d".repeat(56)}&type=email`);
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  await expect(page.getByText(/Your email is confirmed, but/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/);
  expect(calls).toEqual({ verifies: 1, workspaces: 2 });
});

test("expired or used links offer a working resend without creating a session", async ({
  page,
}) => {
  const calls = await mockConfirmation(page);
  await page.route(`https://${SUPABASE_HOST}/auth/v1/verify`, (route) =>
    route.fulfill({
      status: 403,
      headers: {
        "x-supabase-api-version": "2024-01-01",
        "access-control-expose-headers": "x-supabase-api-version",
      },
      json: { code: "otp_expired", msg: "Token has expired or is invalid" },
    }),
  );
  let resends = 0;
  await page.route(`https://${SUPABASE_HOST}/auth/v1/resend**`, (route) => {
    resends++;
    expect(route.request().postDataJSON()).toMatchObject({
      type: "signup",
      email: "confirm@example.test",
    });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/auth/confirm#token_hash=pkce_${"e".repeat(56)}&type=email`);
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  await expect(page.getByText(/This link has expired or was already used/)).toBeVisible();
  await page.getByLabel("Resend signup confirmation").fill("confirm@example.test");
  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  await expect(page.getByRole("status")).toContainText("a new email has been sent");
  expect(resends).toBe(1);
  expect(calls.workspaces).toBe(0);
});

test("secure email change first confirmation does not reuse an unrelated existing session", async ({
  page,
}) => {
  const calls = await mockConfirmation(page);
  await page.route(`https://${SUPABASE_HOST}/auth/v1/verify`, (route) =>
    route.fulfill({
      json: {
        message:
          "Confirmation link accepted. Please proceed to confirm at the other email address.",
      },
    }),
  );
  await page.goto(`/auth/confirm#token_hash=pkce_${"f".repeat(56)}&type=email_change`);
  await page.getByRole("button", { name: "Confirm email change", exact: true }).click();
  await expect(page.getByText(/open the other email too/)).toBeVisible();
  expect(calls.workspaces).toBe(0);
});

test("opening a resent email in the same mobile document replaces the old token", async ({
  page,
}) => {
  const calls = await mockConfirmation(page);
  await page.goto(`/auth/confirm#token_hash=pkce_${"a".repeat(56)}&type=email`);
  await expect(page.getByRole("button", { name: "Confirm email", exact: true })).toBeVisible();
  const token = `pkce_${"b".repeat(56)}`;
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `token_hash=${token}&type=email`);
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  const verified = page.waitForRequest((req) => new URL(req.url()).pathname.endsWith("/verify"));
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  expect((await verified).postDataJSON()).toMatchObject({ token_hash: token, type: "email" });
  await expect(page).toHaveURL(/\/reset-password\?confirmed=1$/);
  expect(calls).toEqual({ verifies: 1, workspaces: 1 });
});

test("expired recovery offers another recovery email instead of signup confirmation", async ({
  page,
}) => {
  const calls = await mockConfirmation(page);
  await page.route(`https://${SUPABASE_HOST}/auth/v1/verify`, (route) =>
    route.fulfill({
      status: 403,
      json: { error_code: "otp_expired", msg: "Token has expired or is invalid" },
    }),
  );
  let recoveries = 0;
  await page.route(`https://${SUPABASE_HOST}/auth/v1/recover**`, (route) => {
    recoveries++;
    expect(route.request().postDataJSON()).toMatchObject({ email: "recover@example.test" });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/auth/confirm#token_hash=pkce_${"c".repeat(56)}&type=recovery`);
  await page.getByRole("button", { name: "Continue to password reset" }).click();
  await page.getByLabel("Send a new password reset email").fill("recover@example.test");
  await page.getByRole("button", { name: "Send password reset email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("password reset email has been sent");
  expect(recoveries).toBe(1);
  expect(calls.workspaces).toBe(0);
});

test("a verification response without a session cannot complete account setup", async ({
  page,
}) => {
  const calls = await mockConfirmation(page);
  await page.route(`https://${SUPABASE_HOST}/auth/v1/verify`, (route) =>
    route.fulfill({ json: { user: session().user } }),
  );
  await page.goto(`/auth/confirm#token_hash=pkce_${"d".repeat(56)}&type=email`);
  await page.getByRole("button", { name: "Confirm email", exact: true }).click();
  await expect(page.getByText(/This link could not be confirmed/)).toBeVisible();
  expect(calls.workspaces).toBe(0);
  await expect(page).toHaveURL(/\/auth\/confirm$/);
});
