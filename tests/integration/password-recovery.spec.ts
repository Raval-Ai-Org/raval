import { expect, test, type Page } from "@playwright/test";
import { STORAGE_KEY, SUPABASE_HOST } from "../fixtures/supabase-ref";

function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: "00000000-0000-0000-0000-000000000002",
    email: "recovery@example.test",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
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

async function mockRecovery(page: Page, rejectExchange = false) {
  const authSession = session();
  const calls = {
    exchanges: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    urlsAtExchange: [] as string[],
  };
  await page.route(`https://${SUPABASE_HOST}/auth/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/token")) {
      calls.exchanges.push(request.postDataJSON());
      calls.urlsAtExchange.push(page.url());
      if (rejectExchange)
        return route.fulfill({
          status: 400,
          json: { message: "private-provider-diagnostics", code: "invalid_grant" },
        });
      return route.fulfill({ json: authSession });
    }
    if (path.endsWith("/user") && request.method() === "PUT") {
      calls.updates.push(request.postDataJSON());
      return route.fulfill({
        status: 400,
        json: { message: "private-update-diagnostics", code: "weak_password" },
      });
    }
    return route.fulfill({ json: authSession.user });
  });
  return { authSession, calls };
}

test("PKCE reset exchanges the raw code once, scrubs the URL and restores the form", async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await mockRecovery(page);
  await context.addCookies([
    {
      name: `${STORAGE_KEY}-code-verifier`,
      value: `base64-${Buffer.from(JSON.stringify("synthetic-verifier/recovery")).toString("base64url")}`,
      url: baseURL!,
    },
  ]);
  await page.goto("/reset-password?code=synthetic-code");
  await expect.poll(() => calls.exchanges.length).toBe(1);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(calls.exchanges).toHaveLength(1);
  expect(calls.exchanges[0]).toMatchObject({
    auth_code: "synthetic-code",
    code_verifier: "synthetic-verifier",
  });
  expect(calls.urlsAtExchange[0]).toMatch(/\/reset-password$/);
});

test("concurrent recovery flows use their own verifier and preserve the other flow", async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await mockRecovery(page);
  const cookie = (name: string, verifier: string) => ({
    name,
    value: `base64-${Buffer.from(JSON.stringify(verifier)).toString("base64url")}`,
    url: baseURL!,
  });
  await context.addCookies([
    cookie(`${STORAGE_KEY}-flow-recovery-flow-code-verifier`, "recovery-verifier/recovery"),
    cookie(`${STORAGE_KEY}-flow-other-flow-code-verifier`, "other-verifier/recovery"),
    cookie(`${STORAGE_KEY}-code-verifier`, "other-verifier/recovery"),
  ]);
  await page.goto("/reset-password?code=recovery-code&sb_flow_id=recovery-flow");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(calls.exchanges).toEqual([
    { auth_code: "recovery-code", code_verifier: "recovery-verifier" },
  ]);
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.name === `${STORAGE_KEY}-flow-other-flow-code-verifier`,
    ),
  ).toBe(true);
});

test("token-based reset restores the session and removes tokens from the address bar", async ({
  page,
}) => {
  const { authSession, calls } = await mockRecovery(page);
  await page.goto(
    `/reset-password#access_token=${authSession.access_token}&refresh_token=${authSession.refresh_token}&type=recovery`,
  );
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(calls.exchanges).toHaveLength(0);
});

test("rejected reset codes show a retry path without exposing provider diagnostics", async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await mockRecovery(page, true);
  await context.addCookies([
    {
      name: `${STORAGE_KEY}-code-verifier`,
      value: `base64-${Buffer.from(JSON.stringify("synthetic-verifier/recovery")).toString("base64url")}`,
      url: baseURL!,
    },
  ]);
  await page.goto("/reset-password?code=expired-code");
  await expect(page.getByText("Reset link failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to login" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain("private-provider-diagnostics");
  expect(calls.exchanges).toHaveLength(1);
});

test("sign-in callback exchanges its flow once, ensures the workspace and keeps the stored destination", async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await mockRecovery(page);
  let workspaceCalls = 0;
  await page.route("**/api/rpc/workspaces/ensureAuthWorkspace", (route) => {
    workspaceCalls++;
    return route.fulfill({ json: { result: null } });
  });
  await context.addCookies([
    {
      name: `${STORAGE_KEY}-flow-callback-flow-code-verifier`,
      value: `base64-${Buffer.from(JSON.stringify("callback-verifier")).toString("base64url")}`,
      url: baseURL!,
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mellox:auth-next",
      JSON.stringify({ next: "/reset-password?callback=success", at: Date.now() }),
    );
  });
  await page.goto("/auth/callback?code=callback-code&sb_flow_id=callback-flow");
  await expect(page).toHaveURL(/\/reset-password\?callback=success$/, { timeout: 20_000 });
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(calls.exchanges).toEqual([
    { auth_code: "callback-code", code_verifier: "callback-verifier" },
  ]);
  expect(calls.urlsAtExchange[0]).toMatch(/\/auth\/callback$/);
  expect(workspaceCalls).toBe(1);
});

test("failed sign-in callbacks exit loading and offer a retry without exposing diagnostics", async ({
  page,
  context,
  baseURL,
}) => {
  const { calls } = await mockRecovery(page, true);
  await context.addCookies([
    {
      name: `${STORAGE_KEY}-code-verifier`,
      value: `base64-${Buffer.from(JSON.stringify("callback-verifier")).toString("base64url")}`,
      url: baseURL!,
    },
  ]);
  await page.goto("/auth/callback?code=expired-code");
  await expect(page.getByRole("link", { name: "Back to login" })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/callback$/);
  expect(calls.exchanges).toHaveLength(1);
  expect(await page.content()).not.toContain("private-provider-diagnostics");
});

test("provider error links cannot reuse an unrelated signed-in session", async ({
  page,
  context,
  baseURL,
}) => {
  const { authSession, calls } = await mockRecovery(page);
  await context.addCookies([
    {
      name: STORAGE_KEY,
      value: `base64-${Buffer.from(JSON.stringify(authSession)).toString("base64url")}`,
      url: baseURL!,
    },
  ]);
  await page.goto(
    "/reset-password#error=access_denied&error_description=private-provider-diagnostics",
  );
  await expect(page.getByRole("link", { name: "Back to login" })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(calls.exchanges).toHaveLength(0);
  expect(await page.content()).not.toContain("private-provider-diagnostics");
});

test("failed password updates remain retryable and duplicate submissions send one request", async ({
  page,
}) => {
  const { authSession, calls } = await mockRecovery(page);
  await page.goto(
    `/reset-password#access_token=${authSession.access_token}&refresh_token=${authSession.refresh_token}&type=recovery`,
  );
  await page.getByLabel("New password", { exact: true }).fill("synthetic-password");
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByText("Could not update password", { exact: true })).toBeVisible();
  const update = page.getByRole("button", { name: "Update password" });
  await expect(update).toBeEnabled();
  expect(calls.updates).toHaveLength(1);
  await update.click();
  await expect.poll(() => calls.updates.length).toBe(2);
  await expect(update).toBeEnabled();
  expect(await page.content()).not.toContain("private-update-diagnostics");
});
