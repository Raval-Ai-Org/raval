import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_HOST } from "../fixtures/supabase-ref";

// Run against an isolated server built with NEXT_PUBLIC_TURNSTILE_SITE_KEY set.
// No real authentication, CAPTCHA verification, emails or provider calls occur.
test.skip(
  process.env.PLAYWRIGHT_CAPTCHA_ENABLED !== "1",
  "Requires the configured CAPTCHA verification server",
);

async function stubAuth(page: Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/auth/google/config", (route) =>
    route.fulfill({ json: { clientId: "123-test.apps.googleusercontent.com" } }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google = {accounts:{id:{initialize(options){window.__googleAuth=options},renderButton(host){const button=document.createElement('button');button.textContent='Continue with Google';button.onclick=()=>window.__googleAuth.callback({credential:'synthetic-google-token'});host.appendChild(button)}}}};`,
    }),
  );
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.__captchaCount=0;window.turnstile={render(host,options){window.__captchaOptions=options;const b=document.createElement('button');b.type='button';b.textContent='Complete security check';b.onclick=()=>options.callback('synthetic-captcha-'+(++window.__captchaCount));host.appendChild(b);return 'fixture-widget'},remove(){document.querySelector('[data-auth-captcha] > div').replaceChildren()}};`,
      }),
  );
  await page.route(`https://${SUPABASE_HOST}/auth/v1/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      calls.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith("/signup"))
        return route.fulfill({
          json: {
            id: "00000000-0000-0000-0000-000000000002",
            email: "captcha@example.test",
            identities: [],
          },
        });
      if (path.endsWith("/recover") || path.endsWith("/resend")) return route.fulfill({ json: {} });
      return route.fulfill({
        status: 400,
        json: { code: "invalid_credentials", message: "Invalid login credentials" },
      });
    }
    return route.fulfill({ json: null });
  });
  return calls;
}

async function verify(page: Page) {
  await page.getByRole("button", { name: "Complete security check" }).click();
}
function responseToken(body: Record<string, unknown>) {
  return (body.gotrue_meta_security as { captcha_token?: string } | undefined)?.captcha_token;
}

test("email login and reset use distinct challenge responses and remain retryable", async ({
  page,
}) => {
  const calls = await stubAuth(page);
  await page.goto("/login");
  const login = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(login).toBeDisabled();
  await page.getByPlaceholder("Email", { exact: true }).fill("captcha@example.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("synthetic-password");
  await verify(page);
  await login.click();
  await expect(page.getByText("Sign in failed", { exact: true })).toBeVisible();
  expect(responseToken(calls[0].body)).toBe("synthetic-captcha-1");
  await expect(login).toBeDisabled();
  await verify(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("Reset link sent", { exact: true })).toBeVisible();
  expect(calls[1].path).toMatch(/\/recover$/);
  expect(responseToken(calls[1].body)).toBe("synthetic-captcha-2");
});

test("signup and confirmation resend both send a fresh challenge", async ({ page }) => {
  const calls = await stubAuth(page);
  await page.goto("/signup");
  // The SDK-created control also proves the controlled form has hydrated.
  await expect(page.getByRole("button", { name: "Complete security check" })).toBeVisible();
  await page.getByPlaceholder("Name", { exact: true }).fill("CAPTCHA Tester");
  await page.getByPlaceholder("Email", { exact: true }).fill("captcha@example.test");
  await page.getByPlaceholder("Password (8+ characters)").fill("synthetic-password");
  await verify(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Check your email to finish signing up.")).toBeVisible();
  expect(responseToken(calls[0].body)).toBe("synthetic-captcha-1");
  const resend = page.getByRole("button", { name: "Resend confirmation email" });
  await expect(resend).toBeDisabled();
  await verify(page);
  await resend.click();
  await expect(page.getByText("Confirmation email sent again", { exact: true })).toBeVisible();
  expect(calls[1].path).toMatch(/\/resend$/);
  expect(responseToken(calls[1].body)).toBe("synthetic-captcha-2");
});

test("Google's ID-token exchange passes the challenge and refreshes it after rejection", async ({
  page,
}) => {
  const calls = await stubAuth(page);
  await page.goto("/login");
  await verify(page);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Google sign-in failed", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].body.provider).toBe("google");
  expect(responseToken(calls[0].body)).toBe("synthetic-captcha-1");
  await verify(page);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(responseToken(calls[1].body)).toBe("synthetic-captcha-2");
});

test("expired responses disable submission and a failed widget can retry without sending credentials", async ({
  page,
}) => {
  const calls = await stubAuth(page);
  await page.goto("/login");
  await verify(page);
  await page.evaluate(() =>
    (window as unknown as { __captchaOptions: { "expired-callback"(): void } }).__captchaOptions[
      "expired-callback"
    ](),
  );
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { __captchaOptions: { "error-callback"(): void } }).__captchaOptions[
      "error-callback"
    ](),
  );
  await expect(
    page.getByText("The security check could not finish.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await verify(page);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  expect(calls).toHaveLength(0);
});
