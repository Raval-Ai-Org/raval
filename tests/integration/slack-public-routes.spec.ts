import { expect, test } from "@playwright/test";

test("Slack public endpoints reject unsigned requests", async ({ request }) => {
  const events = await request.post("/api/integrations/slack/events", {
    data: { type: "url_verification", challenge: "do-not-echo" },
  });
  expect([401, 503]).toContain(events.status());
  expect(await events.text()).not.toContain("do-not-echo");

  const interactive = await request.post("/api/integrations/slack/interactivity", {
    form: { payload: JSON.stringify({ type: "block_actions" }) },
  });
  expect([401, 503]).toContain(interactive.status());

  const jobs = await request.post("/api/public/hooks/slack");
  expect(jobs.status()).toBe(401);
});

test("OAuth callback never redirects to a forged host", async ({ request }) => {
  const response = await request.get("/api/integrations/slack/oauth/callback?error=access_denied", {
    headers: { host: "attacker.example" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("https://mellox.ai/projects?slack=failed");
});
