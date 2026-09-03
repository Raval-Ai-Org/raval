import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * End-to-end test for the client-share pipeline.
 *
 * Uses the sandbox-injected user session + real Supabase project to:
 *   1. Create a share through the authenticated /api/shares endpoint.
 *   2. Read it through the anonymous public GET /api/public/share/$slug.
 *   3. Post an approval event through the anonymous public POST.
 *   4. Verify permission gates: missing token, wrong token, revoked share,
 *      expired share, and approvals disabled.
 *
 * Cleanup uses the service-role key to hard-delete any rows the test
 * created so re-runs are deterministic.
 */

const BASE = "http://localhost:8080";
const SUPA_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_TOKEN = process.env.SUPABASE_TEST_ACCESS_TOKEN!;
const PUBLISHABLE =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

const haveEnv = Boolean(SUPA_URL && SERVICE_KEY && USER_TOKEN && PUBLISHABLE);

const createdShareIds: string[] = [];

async function pickWorkspaceId(): Promise<string> {
  const ctx = await pwRequest.newContext({
    extraHTTPHeaders: {
      apikey: PUBLISHABLE,
      Authorization: `Bearer ${USER_TOKEN}`,
    },
  });
  const res = await ctx.get(`${SUPA_URL}/rest/v1/workspaces?select=id&limit=1`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = (await res.json()) as { id: string }[];
  expect(rows.length, "test user needs at least one workspace").toBeGreaterThan(0);
  await ctx.dispose();
  return rows[0].id;
}

async function createShare(overrides: Record<string, unknown> = {}): Promise<{
  id: string;
  slug: string;
  token: string;
}> {
  const ctx = await pwRequest.newContext();
  const workspaceId = await pickWorkspaceId();
  const res = await ctx.post(`${BASE}/api/shares`, {
    headers: { Authorization: `Bearer ${USER_TOKEN}`, "Content-Type": "application/json" },
    data: {
      workspaceId,
      title: `E2E share ${Date.now()}`,
      allowComments: true,
      allowApprovals: true,
      allowDownload: false,
      items: [{ kind: "note", title: "Item 1", description: "hello" }],
      ...overrides,
    },
  });
  expect(res.ok(), `create share failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; slug: string; token: string };
  createdShareIds.push(body.id);
  await ctx.dispose();
  return body;
}

async function revokeShare(shareId: string) {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${BASE}/api/shares?action=revoke`, {
    headers: { Authorization: `Bearer ${USER_TOKEN}`, "Content-Type": "application/json" },
    data: { shareId },
  });
  expect(res.ok(), `revoke failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await ctx.dispose();
}

async function setExpiresPast(shareId: string) {
  // Use Node fetch (not Playwright's request context) so Supabase doesn't
  // reject the service key with "Forbidden use of secret API key in browser".
  const res = await fetch(`${SUPA_URL}/rest/v1/client_shares?id=eq.${shareId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      "User-Agent": "node-fetch",
    },
    body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
  });
  expect(res.ok, `expire patch failed: ${res.status} ${await res.text()}`).toBeTruthy();
}

test.describe("Client share end-to-end", () => {
  test.skip(!haveEnv, "requires SUPABASE_SERVICE_ROLE_KEY + injected user session");

  test.afterAll(async () => {
    if (!createdShareIds.length) return;
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "User-Agent": "node-fetch",
    };
    for (const id of createdShareIds) {
      await fetch(`${SUPA_URL}/rest/v1/client_share_items?share_id=eq.${id}`, {
        method: "DELETE",
        headers,
      });
      await fetch(`${SUPA_URL}/rest/v1/client_events?share_id=eq.${id}`, {
        method: "DELETE",
        headers,
      });
      await fetch(`${SUPA_URL}/rest/v1/client_shares?id=eq.${id}`, { method: "DELETE", headers });
    }
  });

  test("create → public GET/POST happy path enforces permission gates", async ({ request }) => {
    const { slug, token } = await createShare();

    // --- GET: missing token → 401 ---
    const missing = await request.get(`${BASE}/api/public/share/${slug}`);
    expect(missing.status()).toBe(401);

    // --- GET: bad token → 401 ---
    const bad = await request.get(`${BASE}/api/public/share/${slug}?t=not-the-token`);
    expect(bad.status()).toBe(401);

    // --- GET: valid token → 200 + expected shape ---
    const ok = await request.get(`${BASE}/api/public/share/${slug}?t=${token}`);
    expect(ok.status(), await ok.text()).toBe(200);
    const okBody = (await ok.json()) as {
      share: { allowApprovals: boolean; allowComments: boolean };
      items: unknown[];
    };
    expect(okBody.share.allowApprovals).toBe(true);
    expect(okBody.items.length).toBeGreaterThan(0);

    // --- POST approve: wrong token → 401 ---
    const badPost = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token: "wrong-token", kind: "approved" },
    });
    expect(badPost.status()).toBe(401);

    // --- POST approve: valid token → 200 ---
    const goodPost = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "approved", actorName: "Client" },
    });
    expect(goodPost.status(), await goodPost.text()).toBe(200);
  });

  test("revoked share returns 410 on both GET and POST", async ({ request }) => {
    const { id, slug, token } = await createShare();
    await revokeShare(id);

    const g = await request.get(`${BASE}/api/public/share/${slug}?t=${token}`);
    expect(g.status()).toBe(410);

    const p = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "viewed" },
    });
    expect(p.status()).toBe(410);
  });

  test("expired share returns 410 on both GET and POST", async ({ request }) => {
    const { id, slug, token } = await createShare();
    await setExpiresPast(id);

    const g = await request.get(`${BASE}/api/public/share/${slug}?t=${token}`);
    expect(g.status()).toBe(410);

    const p = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "approved" },
    });
    expect(p.status()).toBe(410);
  });

  test("approvals disabled → POST approve returns 403; comments disabled → 403", async ({
    request,
  }) => {
    const { slug, token } = await createShare({ allowApprovals: false, allowComments: false });

    // A read is still fine so the client can view the share.
    const g = await request.get(`${BASE}/api/public/share/${slug}?t=${token}`);
    expect(g.status()).toBe(200);

    const approve = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "approved" },
    });
    expect(approve.status()).toBe(403);

    const reject = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "rejected" },
    });
    expect(reject.status()).toBe(403);

    const comment = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "commented", body: "nope" },
    });
    expect(comment.status()).toBe(403);

    // A neutral "viewed" event is always allowed on an active share.
    const view = await request.post(`${BASE}/api/public/share/${slug}`, {
      data: { token, kind: "viewed" },
    });
    expect(view.status(), await view.text()).toBe(200);
  });

  test("unknown slug returns 404", async ({ request }) => {
    const r = await request.get(`${BASE}/api/public/share/does-not-exist-slug?t=whatever`);
    expect(r.status()).toBe(404);
  });
});
