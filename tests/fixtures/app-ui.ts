import { expect, type Page } from "@playwright/test";
import { FEATURES, PLANS } from "../../src/lib/billing/catalog";
import { STORAGE_KEY, SUPABASE_HOST } from "./supabase-ref";

export const AUDIT_WORKSPACE = "00000000-0000-4000-8000-000000000001";
const user = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "qa@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Alex Morgan" },
};
const session = {
  access_token: "local-qa-token",
  refresh_token: "local-qa-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};
const workspace = {
  id: AUDIT_WORKSPACE,
  name: "Acme Coffee",
  websiteUrl: "https://acme.example",
  domain: "acme.example",
  plan: "agency",
  role: "owner",
  isOwner: true,
  onboarded: true,
  memberCount: 3,
};

export async function prepareAppUi(page: Page, theme: "light" | "dark") {
  // The browser client now uses @supabase/ssr cookie storage. Seed a complete
  // fixture session there rather than racing the old localStorage migration.
  await page.context().addCookies([
    {
      name: STORAGE_KEY,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      url: "http://localhost:8080",
      sameSite: "Lax",
    },
  ]);
  // Keep analytics and provider scripts outside this deterministic UI run.
  // More-specific Supabase fixtures below override this external-network rule.
  await page.context().route(/^https?:\/\/(?!localhost:8080)/, (route) => route.abort());
  await page.context().route(new RegExp(`https?://${SUPABASE_HOST}/(auth|rest)/v1/.*`), (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.includes("/auth/v1/token")) return route.fulfill({ json: session });
    if (url.includes("/rest/v1/workspaces"))
      return route.fulfill({
        json: {
          id: AUDIT_WORKSPACE,
          name: workspace.name,
          website_url: workspace.websiteUrl,
          onboarded_at: "2026-01-01",
          first_prompt: null,
        },
      });
    if (url.includes("/rest/v1/profiles"))
      return route.fulfill({
        json: { id: user.id, persona: "founder", persona_set_at: "2026-01-01" },
      });
    const single = (route.request().headers().accept || "").includes("pgrst.object");
    return route.fulfill({ json: single ? null : [] });
  });
  await page.context().route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/billing/entitlements"))
      return route.fulfill({
        json: {
          accountId: user.id,
          ownerUserId: user.id,
          isOwner: true,
          role: "owner",
          plan: "agency",
          entitledPlan: "agency",
          status: "active",
          enforcement: "on",
          interval: "month",
          trial: { active: false, endsAt: null, used: true },
          manual: null,
          period: { start: null, end: null, nextGrantAt: null },
          frozen: false,
          addons: [],
          features: Object.fromEntries(
            Object.entries(FEATURES).map(([key, f]) => [
              key,
              { allowed: true, requiredPlan: f.minPlan },
            ]),
          ),
          limits: { ...PLANS.agency.limits, brands: 10, seats: 5 },
          usage: {
            brands: 1,
            activeBrands: 1,
            seats: 3,
            postsThisMonth: 0,
            trackedPrompts: 0,
            scansUsed: 0,
            competitors: 0,
            openExperiments: 0,
            rendersRunning: 0,
          },
          meters: Object.fromEntries(
            ["credits", "video", "pro_messages", "flash_messages"].map((key) => [
              key,
              { available: 500, held: 0, debt: 0, nextExpiry: null },
            ]),
          ),
        },
      });
    if (url.includes("/api/rpc/")) {
      const fn = url.split("/api/rpc/")[1];
      let result: unknown = null;
      if (fn === "workspaces/getWorkspaceDetails") result = workspace;
      else if (fn === "workspaces/listWorkspaces") result = [workspace];
      else if (fn.endsWith("getAutopilotStatus")) result = { status: "not_started", pending: 0 };
      else if (
        /list|get.*(Items|Accounts|Projects|Scans|Prompts|History|Conversations|Approvals|Competitors)/i.test(
          fn,
        )
      )
        result = [];
      return route.fulfill({ json: { result } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(
    ({ storageKey, sess, ws, theme }) => {
      localStorage.setItem(storageKey, JSON.stringify(sess));
      localStorage.setItem("mellox:theme", theme);
      localStorage.setItem(`mellox:first-prompt-fired:${ws}`, "1");
      localStorage.setItem(`mellox:tour-seen:${ws}`, "1");
      localStorage.setItem("profile:persona", "founder");
    },
    { storageKey: STORAGE_KEY, sess: session, ws: AUDIT_WORKSPACE, theme },
  );
}

export async function openAppUi(page: Page) {
  // Use the production shell behind the development-only lab route. Fake
  // browser sessions cannot pass the proxy's server-side signature check.
  await page.goto("/workspace-lab", { waitUntil: "domcontentloaded" });
  // Next's development indicator overlaps the bottom-left account control.
  // It is absent in production and must not intercept app interaction tests.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.getByRole("textbox", { name: "Message Mellox" })).toBeVisible({
    timeout: 60_000,
  });
}
