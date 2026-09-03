import { test, expect } from "@playwright/test";

/**
 * Integration test for runDueScheduledJobs → content_items → Studio suggestions.
 *
 * Flow verified end-to-end:
 *   1. Seed a fresh workspace + a due scheduled_jobs row (content-gen, cadence=once).
 *   2. POST the public cron hook `/api/public/hooks/run-schedules` with the
 *      publishable key — this invokes runDueScheduledJobs on the server.
 *   3. Assert the run reports work AND a matching content_items row was written
 *      (kind='blog', meta.scheduled_job_id = the seeded job).
 *   4. Open /app with that workspace selected and confirm the Studio suggestion
 *      rail reflects the new content: the "Draft your first SEO brief" card
 *      disappears once a blog/brief content_item exists.
 */

const BASE = "http://localhost:8080";
const SUPA_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUBLISHABLE =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const USER_TOKEN = process.env.SUPABASE_TEST_ACCESS_TOKEN!;
const SESSION_JSON = process.env.SUPABASE_TEST_SESSION_JSON!;
const STORAGE_KEY = process.env.SUPABASE_TEST_STORAGE_KEY!;

const haveEnv = Boolean(
  SUPA_URL && SERVICE_KEY && PUBLISHABLE && USER_TOKEN && SESSION_JSON && STORAGE_KEY,
);

const ADMIN_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "node-fetch",
};

const createdWorkspaceIds: string[] = [];
const createdJobIds: string[] = [];

async function seedWorkspace(userId: string): Promise<string> {
  const res = await fetch(`${SUPA_URL}/rest/v1/workspaces`, {
    method: "POST",
    headers: { ...ADMIN_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({
      name: `Test WS ${Date.now()}`,
      owner_id: userId,
      onboarded_at: new Date().toISOString(),
    }),
  });
  const text = await res.text();
  expect(res.ok, `create ws: ${res.status} ${text}`).toBeTruthy();
  const [row] = JSON.parse(text) as { id: string }[];
  createdWorkspaceIds.push(row.id);

  // RLS on workspaces requires a workspace_members row (auto-trigger only
  // fires for OAuth signups). Add the test user as owner explicitly.
  const memRes = await fetch(`${SUPA_URL}/rest/v1/workspace_members`, {
    method: "POST",
    headers: { ...ADMIN_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ workspace_id: row.id, user_id: userId, role: "owner" }),
  });
  expect(memRes.ok, `create member: ${memRes.status} ${await memRes.text()}`).toBeTruthy();
  return row.id;
}

async function seedDueJob(workspaceId: string, userId: string): Promise<string> {
  const res = await fetch(`${SUPA_URL}/rest/v1/scheduled_jobs`, {
    method: "POST",
    headers: { ...ADMIN_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      created_by: userId,
      title: "Weekly SEO brief",
      task_type: "content-gen",
      agent: "spark",
      cadence: "once",
      channel: "blog",
      timezone: "UTC",
      prompt: "Write a very short brief. One paragraph is fine.",
      next_run_at: new Date(Date.now() - 60_000).toISOString(),
      active: true,
    }),
  });
  const text = await res.text();
  expect(res.ok, `create job: ${res.status} ${text}`).toBeTruthy();
  const [row] = JSON.parse(text) as { id: string }[];
  createdJobIds.push(row.id);
  return row.id;
}

function getUserId(): string {
  const sess = JSON.parse(SESSION_JSON) as { user: { id: string } };
  return sess.user.id;
}

test.describe("Schedules → content_items → Studio suggestions", () => {
  test.skip(!haveEnv, "requires SUPABASE_SERVICE_ROLE_KEY + injected user session");

  test.afterAll(async () => {
    for (const wsId of createdWorkspaceIds) {
      await fetch(`${SUPA_URL}/rest/v1/content_items?workspace_id=eq.${wsId}`, {
        method: "DELETE",
        headers: ADMIN_HEADERS,
      });
      await fetch(`${SUPA_URL}/rest/v1/scheduled_jobs?workspace_id=eq.${wsId}`, {
        method: "DELETE",
        headers: ADMIN_HEADERS,
      });
      await fetch(`${SUPA_URL}/rest/v1/workspaces?id=eq.${wsId}`, {
        method: "DELETE",
        headers: ADMIN_HEADERS,
      });
    }
  });

  test("runDueScheduledJobs writes content_items and clears the SEO-brief suggestion", async ({
    page,
    request,
  }) => {
    const userId = getUserId();
    const wsId = await seedWorkspace(userId);

    // ---- Seed the app UI with this fresh workspace ----
    await page.addInitScript(
      ({ storageKey, sess, wsId }) => {
        try {
          window.localStorage.setItem(storageKey, sess);
          window.localStorage.setItem("workspace:selected", wsId);
          window.localStorage.setItem(`raval:first-prompt-fired:${wsId}`, "1");
        } catch {
          /* noop */
        }
      },
      { storageKey: STORAGE_KEY, sess: SESSION_JSON, wsId },
    );

    await page.goto("/app", { waitUntil: "domcontentloaded" });

    // Baseline suggestion set — no blog/brief content yet, so the SEO brief
    // suggestion should surface for this fresh workspace.
    await expect(
      page.getByRole("button", { name: /Run suggestion: Draft your first SEO brief/i }),
    ).toBeVisible({ timeout: 15_000 });

    // ---- Seed a due scheduled_job and invoke the cron hook ----
    const jobId = await seedDueJob(wsId, userId);
    const cron = await request.post(`${BASE}/api/public/hooks/run-schedules`, {
      headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
      data: {},
    });
    expect(cron.status(), await cron.text()).toBe(200);
    const cronBody = (await cron.json()) as { ok: boolean; ran: number };
    expect(cronBody.ok).toBe(true);
    expect(cronBody.ran).toBeGreaterThanOrEqual(1);

    // ---- Verify a content_items row was created and linked to the job ----
    const itemsRes = await fetch(
      `${SUPA_URL}/rest/v1/content_items?workspace_id=eq.${wsId}&select=id,kind,status,meta,title`,
      { headers: ADMIN_HEADERS },
    );
    expect(itemsRes.ok).toBeTruthy();
    const items = (await itemsRes.json()) as {
      id: string;
      kind: string;
      status: string;
      meta: Record<string, unknown> | null;
      title: string;
    }[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    const linked = items.find(
      (i) =>
        i.meta &&
        typeof i.meta === "object" &&
        (i.meta as { scheduled_job_id?: string }).scheduled_job_id === jobId,
    );
    expect(linked, "expected content_item linked to the scheduled job").toBeTruthy();
    expect(linked!.kind).toBe("blog");

    // ---- Verify the scheduled_job was marked ok + inactive (cadence=once) ----
    const jobRes = await fetch(
      `${SUPA_URL}/rest/v1/scheduled_jobs?id=eq.${jobId}&select=last_run_status,active,last_content_item_id`,
      { headers: ADMIN_HEADERS },
    );
    const [jobRow] = (await jobRes.json()) as {
      last_run_status: string | null;
      active: boolean;
      last_content_item_id: string | null;
    }[];
    expect(jobRow.last_run_status).toBe("ok");
    expect(jobRow.active).toBe(false);
    expect(jobRow.last_content_item_id).toBe(linked!.id);

    // ---- UI reflects the new content_item: SEO-brief suggestion is gone ----
    // The hook listens for `content:changed`, so we nudge it instead of a full reload.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("content:changed")));
    await expect(
      page.getByRole("button", { name: /Run suggestion: Draft your first SEO brief/i }),
    ).toHaveCount(0, { timeout: 10_000 });

    // Sanity: the suggestion rail is still rendering other cards, i.e. it did
    // not silently unmount.
    await expect(page.getByRole("button", { name: /^Run suggestion:/i }).first()).toBeVisible();
  });
});
