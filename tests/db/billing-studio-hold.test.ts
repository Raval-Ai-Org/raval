import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "a1111111-1111-4111-8111-111111111111";
let db: PGlite;
let workspace: string;
let account: string;

async function meter(name: string, body: Record<string, unknown>) {
  const { rows } = await db.query<{ result: { ok: boolean; id?: string } }>(
    `select public.${name}($1::jsonb) as result`,
    [JSON.stringify(body)],
  );
  return rows[0].result;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const made = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Brand','https://brand.test','brand-1')",
    [OWNER],
  );
  workspace = made.rows[0].workspace_id;
  const rows = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from public.workspaces where id=$1",
    [workspace],
  );
  account = rows.rows[0].billing_account_id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("Studio async hold lifecycle", () => {
  it("preserves an expired hold for a live job and releases it after failure", async () => {
    expect(
      (
        await meter("meter_grant", {
          account_id: account,
          meter: "credits",
          amount: 30,
          source: "adjustment",
          restriction: "ai_only",
          idempotency_key: "studio-test-grant",
        })
      ).ok,
    ).toBe(true);
    const hold = await meter("meter_hold", {
      account_id: account,
      workspace_id: workspace,
      user_id: OWNER,
      meter: "credits",
      action: "image_post",
      amount: 30,
      expires_at: new Date(Date.now() - 1000).toISOString(),
      idempotency_key: "studio-test-hold",
    });
    expect(hold.ok).toBe(true);
    const job = await db.query<{ id: string }>(
      "insert into public.studio_jobs(workspace_id,created_by,type,status,idempotency_key) values($1,$2,'image','running','studio-test') returning id",
      [workspace, OWNER],
    );
    const jobId = job.rows[0].id;
    await db.query(
      `insert into public.billing_studio_jobs
       (job_id,account_id,workspace_id,hold_id,charge_key,action,meter,amount,route,mode,shadow_decision)
       values($1,$2,$3,$4,'studio-test-hold','image_post','credits',30,'studio.captions','on','would_charge')`,
      [jobId, account, workspace, hold.id],
    );
    const liveSweep = await db.query<{ released: number }>(
      "select public.meter_release_expired_holds() as released",
    );
    expect(liveSweep.rows[0].released).toBe(0);
    await db.query("update public.studio_jobs set status='failed' where id=$1", [jobId]);
    const failedSweep = await db.query<{ released: number }>(
      "select public.meter_release_expired_holds() as released",
    );
    expect(failedSweep.rows[0].released).toBe(1);
    const state = await db.query<{ state: string }>(
      "select state from public.meter_holds where id=$1",
      [hold.id],
    );
    expect(state.rows[0].state).toBe("expired");
  });
});
