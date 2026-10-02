import { test, expect, type Page, type Route } from "@playwright/test";
import { STORAGE_KEY, SUPABASE_HOST } from "../fixtures/supabase-ref";

/**
 * Autopilot — the workspace surface and the Agency HQ view.
 *
 * Verifies at desktop and phone width:
 *   1. /agency?view=autopilot lists each client's state and counts, and Pause
 *      sends a request for exactly that client's workspace.
 *   2. The review queue marks pieces made by Autopilot.
 *   3. /w/<id>/app/autopilot shows the running program, the approval queue and
 *      ideas, and Approve sends the decision for that piece.
 *
 * These pages sit behind the server-side sign-in check, so the run needs a dev
 * server where that check lets the stubbed session through. The screens
 * themselves are covered without sign-in by autopilot-lab.spec.ts.
 *
 * All Supabase / RPC I/O is stubbed at the network layer so the run is
 * deterministic and offline-safe.
 */

const USER_ID = "00000000-0000-0000-0000-000000000002";
const WS_A = "00000000-0000-4000-8000-0000000000a1";
const WS_B = "00000000-0000-4000-8000-0000000000b2";
const ACTION = "33333333-3333-4333-8333-333333333333";
const JSON_HEADERS = { "content-type": "application/json" };

function fakeSession() {
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: USER_ID,
      email: "operator@example.com",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
    },
  };
}

function summary(id: string, name: string, domain: string) {
  return {
    id,
    name,
    websiteUrl: `https://${domain}`,
    domain,
    industry: null,
    clientStatus: "active",
    plan: "agency",
    role: "owner",
    isOwner: true,
    duplicateOf: null,
    onboarded: true,
    createdAt: "2024-01-01T00:00:00Z",
    logoUrl: null,
    pendingApprovals: 0,
    draftCount: 1,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
    connectedSocialAccounts: 1,
    geoScore: null,
    geoScannedAt: null,
    lastActivityAt: "2024-06-01T00:00:00Z",
    health: "healthy",
  };
}

const workspaces = [
  summary(WS_A, "Acme Coffee", "acme.test"),
  summary(WS_B, "Northwind Yoga", "northwind.test"),
];

const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
const recent = new Date(Date.now() - 3600_000).toISOString();

const agencyRows = [
  {
    workspaceId: WS_A,
    programId: "p-a",
    status: "running",
    pauseReason: null,
    mode: "autopilot",
    endsOn: "2026-12-01",
    needsApproval: 2,
    planWaiting: 0,
    newOpportunities: 3,
    failures: 0,
    missed: 0,
    performanceWarnings: 0,
    nextActionAt: soon,
    nextActionTitle: "Why cold brew sells in winter",
  },
  {
    workspaceId: WS_B,
    programId: "p-b",
    status: "paused",
    pauseReason: "member_left",
    mode: "assist",
    endsOn: "2026-12-01",
    needsApproval: 0,
    planWaiting: 0,
    newOpportunities: 0,
    failures: 1,
    missed: 0,
    performanceWarnings: 0,
    nextActionAt: null,
    nextActionTitle: null,
  },
];

const contentItems = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: WS_A,
    agent: "echo",
    kind: "post",
    channel: "linkedin",
    title: "Why cold brew sells in winter",
    body: "Most cafés stop pushing cold brew in November.",
    hashtags: [],
    media_url: null,
    status: "pending",
    scheduled_at: null,
    created_at: recent,
    meta: { autopilot_action_id: ACTION },
  },
];

const action = (over: Record<string, unknown>) => ({
  id: ACTION,
  kind: "content",
  status: "needs_approval",
  plannedFor: soon,
  platform: "linkedin",
  contentType: "social",
  title: "Why cold brew sells in winter",
  brief: "Explain why cold brew is not just a summer drink.",
  reason: "A competitor is pushing winter specials this week.",
  opportunityId: null,
  contentItemIds: ["11111111-1111-4111-8111-111111111111"],
  creditsCharged: 12,
  approvedVia: null,
  error: null,
  metrics: null,
  updatedAt: recent,
  ...over,
});

const view = {
  enabled: true,
  fullAvailable: false,
  canEdit: true,
  canManage: true,
  program: {
    id: "p-a",
    status: "running",
    pauseReason: null,
    mode: "autopilot",
    goal: "leads",
    goalNote: "",
    platforms: ["linkedin"],
    contentTypes: ["social"],
    postsPerWeek: 3,
    weekdays: [1, 3, 5],
    timezone: "UTC",
    startsOn: "2026-10-01",
    endsOn: "2026-12-01",
    styleId: null,
    creditCapPerWeek: 150,
    videoCapPerWeek: 0,
    actOnOpportunities: false,
    strategy: null,
    week: 2,
    totalWeeks: 8,
  },
  budget: { creditsUsed: 36, creditCap: 150, videosUsed: 0, videoCap: 0 },
  proposed: [],
  approvals: [
    action({
      preview: {
        contentItemId: "11111111-1111-4111-8111-111111111111",
        status: "pending",
        title: "Why cold brew sells in winter",
        body: "Most cafés stop pushing cold brew in November. That is a mistake.",
        mediaUrl: null,
        channel: "linkedin",
      },
    }),
  ],
  upcoming: [
    action({
      id: "44444444-4444-4444-8444-444444444444",
      status: "planned",
      title: "Three questions to ask your roaster",
    }),
  ],
  finished: [],
  failed: [],
  opportunities: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "competitor",
      title: "Beanhaus: launched a winter subscription",
      summary: "Beanhaus announced a monthly winter box.",
      why: "Your own subscription is cheaper and ships faster, which you never say.",
      suggestedAction: "Create a LinkedIn post showing how your subscription differs?",
      suggestedType: "social",
      suggestedPlatforms: ["linkedin"],
      evidence: [{ title: "Beanhaus blog", url: "https://beanhaus.test/winter", date: null }],
      score: 84,
      status: "new",
      createdAt: recent,
      expiresAt: soon,
    },
  ],
  events: [
    {
      id: "e1",
      kind: "piece_ready",
      summary: "Made a LinkedIn post: Why cold brew sells in winter",
      actor: "system",
      actionId: ACTION,
      createdAt: recent,
    },
  ],
  connectedPlatforms: ["linkedin"],
};

type Sent = { fn: string; body: unknown };

async function stubBackend(page: Page, sent: Sent[]) {
  await page
    .context()
    .route(
      new RegExp(`https?://${SUPABASE_HOST}/(auth|rest|realtime)/v1/.*`),
      async (route: Route) => {
        const req = route.request();
        const url = req.url();
        const wantsSingle = (req.headers()["accept"] || "").includes("pgrst.object");
        if (url.includes("/auth/v1/user")) {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(fakeSession().user),
          });
        }
        if (url.includes("/auth/v1/token")) {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(fakeSession()),
          });
        }
        if (url.includes("/rest/v1/content_items") && req.method() === "GET") {
          return route.fulfill({
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(contentItems),
          });
        }
        return route.fulfill({
          status: 200,
          headers: JSON_HEADERS,
          body: wantsSingle ? "null" : "[]",
        });
      },
    );

  await page
    .context()
    .route("**/api/**", (route) =>
      route.fulfill({ status: 200, headers: JSON_HEADERS, body: "{}" }),
    );
  await page.context().route("**/api/rpc/**", (route) => {
    const req = route.request();
    const fn = new URL(req.url()).pathname.replace("/api/rpc/", "");
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* GET */
    }
    sent.push({ fn, body });
    const results: Record<string, unknown> = {
      "workspaces/listWorkspaces": workspaces,
      "workspaces/getWorkspaceDetails": {
        id: WS_A,
        name: "Acme Coffee",
        plan: "agency",
        websiteUrl: "https://acme.test",
        domain: "acme.test",
        industry: null,
        createdAt: "2024-01-01T00:00:00Z",
        onboarded: true,
        role: "owner",
        isOwner: true,
        memberCount: 1,
      },
      "autopilot/getAgencyAutopilot": agencyRows,
      "autopilot/getAutopilotStatus": { enabled: true },
      "autopilot/getAutopilot": view,
      "autopilot/setAutopilotPaused": { ok: true },
      "autopilot/decideAutopilotAction": { ok: true },
      "experiments/getProofEngineStatus": { enabled: false },
    };
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ result: fn in results ? results[fn] : null }),
    });
  });
}

async function seedSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, sess }) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(sess));
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, sess: fakeSession() },
  );
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Autopilot — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    let sent: Sent[];

    test.beforeEach(async ({ page }) => {
      sent = [];
      await stubBackend(page, sent);
      await seedSession(page);
    });

    test("Agency HQ shows every client and pauses only the one chosen", async ({ page }) => {
      await page.goto("/agency?view=autopilot", { waitUntil: "domcontentloaded" });
      const list = page.getByRole("list", { name: "Autopilot by client" });
      await expect(list).toBeVisible({ timeout: 30_000 });
      await expect(list.getByText("Acme Coffee")).toBeVisible();
      await expect(list.getByText("Northwind Yoga")).toBeVisible();
      await expect(list.getByText(/Running · Autopilot/)).toBeVisible();
      await expect(list.getByText(/Paused · Assist/)).toBeVisible();
      await expect(page.getByText(/Autopilot paused for Northwind Yoga/)).toBeVisible();
      await expect(list.getByText(/Why cold brew sells in winter/)).toBeVisible();

      // No sideways scroll on any width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await page.getByRole("button", { name: "Pause Autopilot for Acme Coffee" }).click();
      await expect
        .poll(() => sent.find((s) => s.fn === "autopilot/setAutopilotPaused")?.body)
        .toEqual({ data: { workspaceId: WS_A, paused: true } });
      await page.screenshot({ path: `test-results/autopilot-agency-${vp.name}.png` });
    });

    test("the review queue marks Autopilot's pieces", async ({ page }) => {
      await page.goto("/agency?view=review", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Why cold brew sells in winter").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Autopilot", { exact: true }).first()).toBeVisible();
    });

    test("the workspace surface shows the plan, approvals and ideas", async ({ page }) => {
      await page.goto(`/w/${WS_A}/app/autopilot`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog").filter({ hasText: "Autopilot is on" });
      await expect(dialog).toBeVisible({ timeout: 45_000 });
      await expect(dialog.getByText("Three questions to ask your roaster")).toBeVisible();
      await expect(dialog.getByText("36")).toBeVisible();

      await dialog
        .getByRole("button", { name: /To approve/ })
        .first()
        .click();
      await expect(dialog.getByText(/That is a mistake/)).toBeVisible();
      await dialog.getByRole("button", { name: "Approve", exact: true }).click();
      await expect
        .poll(() => sent.find((s) => s.fn === "autopilot/decideAutopilotAction")?.body)
        .toEqual({ data: { workspaceId: WS_A, actionId: ACTION, decision: "approve" } });

      await dialog.getByRole("button", { name: /Ideas/ }).first().click();
      await expect(dialog.getByText("Beanhaus: launched a winter subscription")).toBeVisible();
      await expect(dialog.getByRole("link", { name: /Beanhaus blog/ })).toHaveAttribute(
        "href",
        "https://beanhaus.test/winter",
      );
      await expect(dialog.getByRole("button", { name: "Create post" })).toBeVisible();
    });
  });
}
