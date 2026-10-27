import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared database migration harness
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";
const OWNER = "a1111111-1111-4111-8111-111111111111";
const OUTSIDER = "b2222222-2222-4222-8222-222222222222";
let db: PGlite;
let account: string;
let workspace: string;
let parent: { id: string; group_id: string };
let paidCharge: string;
async function rpc<T = Record<string, unknown>>(
  name: string,
  p: Record<string, unknown>,
): Promise<T> {
  const { rows } = await db.query<{ r: unknown }>(`select public.${name}($1::jsonb) r`, [
    JSON.stringify(p),
  ]);
  return rows[0].r as T;
}
beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@test.local'),($2,'other@test.local')",
    [OWNER, OUTSIDER],
  );
  const made = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Brand','https://brand.test','creation-test')",
    [OWNER],
  );
  workspace = made.rows[0].workspace_id;
  const accounts = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from workspaces where id=$1",
    [workspace],
  );
  account = accounts.rows[0].billing_account_id;
  await rpc("meter_grant", {
    account_id: account,
    meter: "credits",
    source: "pack",
    restriction: "any",
    amount: 1234,
    idempotency_key: "paid-wallet",
  });
  await rpc("meter_grant", {
    account_id: account,
    meter: "creation",
    source: "plan",
    restriction: "ai_only",
    amount: 200,
    idempotency_key: "creation-grant",
  });
  const hold = await rpc("meter_hold", {
    account_id: account,
    workspace_id: workspace,
    user_id: OWNER,
    meter: "creation",
    action: "creation:image_post",
    amount: 2,
    idempotency_key: "paid-image",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  expect(hold.ok).toBe(true);
  const captured = await rpc("meter_capture", {
    account_id: account,
    hold_id: hold.id,
    amount: 2,
    idempotency_key: "paid-image",
    finalize: true,
  });
  paidCharge = String(captured.charge_id);
  const jobs = await db.query<{ id: string; group_id: string }>(
    "insert into studio_jobs(workspace_id,created_by,type,status,idempotency_key) values($1,$2,'image','succeeded','paid-root') returning id,group_id",
    [workspace, OWNER],
  );
  parent = jobs.rows[0];
  await db.query(
    "insert into billing_studio_jobs(job_id,account_id,workspace_id,hold_id,charge_id,charge_key,action,meter,amount,route,mode,shadow_decision,settled_at) values($1,$2,$3,$4,$5,'paid-image','creation:image_post','creation',2,'studio.captions','on','would_charge',now())",
    [parent.id, account, workspace, hold.id, paidCharge],
  );
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("creation allowance database safety", () => {
  it("keeps purchased credits intact and denies research access to creation points", async () => {
    const { rows } = await db.query<{ available: number | string }>(
      "select available from meter_balances where account_id=$1 and meter='credits'",
      [account],
    );
    expect(Number(rows[0].available)).toBe(1234);
    const denied = await rpc("meter_hold", {
      account_id: account,
      meter: "creation",
      amount: 1,
      action: "market_brain_manual",
      idempotency_key: "not-content",
    });
    expect(denied).toMatchObject({ ok: false, code: "invalid_action" });
  });
  it("preserves an already issued window's exact legacy terms", async () => {
    const start = "2026-10-01T00:00:00.000Z";
    await rpc("meter_grant", {
      account_id: account,
      meter: "credits",
      source: "plan",
      restriction: "ai_only",
      amount: 2000,
      period_start: start,
      idempotency_key: `plan:${account}:starter:credits:${start}`,
    });
    const body = {
      account_id: account,
      window_start: start,
      expires_at: "2026-11-01T00:00:00.000Z",
    };
    expect(await rpc("creation_plan_window", body)).toBe("legacy");
    expect(await rpc("creation_plan_window", body)).toBe("legacy");
    const { rows } = await db.query<{ amount: string | number }>(
      "select amount from meter_grants where idempotency_key=$1",
      [`plan:${account}:starter:credits:${start}`],
    );
    expect(Number(rows[0].amount)).toBe(2000);
  });
  it("version-locks new monthly windows without resetting existing grants", async () => {
    const p = {
      account_id: account,
      window_start: "2026-11-01T00:00:00Z",
      expires_at: "2026-12-01T00:00:00Z",
    };
    expect(await rpc("creation_plan_window", p)).toBe("creation_v3");
    expect(await rpc("creation_plan_window", p)).toBe("creation_v3");
  });
  it("shares exactly three included edit slots across callers and idempotent retries", async () => {
    const p = {
      account_id: account,
      workspace_id: workspace,
      user_id: OWNER,
      parent_job_id: parent.id,
    };
    const claims = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        rpc("reserve_studio_caption_edit", { ...p, request_key: `caption-${i}` }),
      ),
    );
    expect(claims.filter((c) => c.included)).toHaveLength(3);
    expect(claims[0].charge_id).toBe(paidCharge);
    expect(claims[3].included).toBe(false);
    expect(
      await rpc("reserve_studio_caption_edit", { ...p, request_key: "caption-1" }),
    ).toMatchObject({ included: true, replayed: true, id: claims[0].id });
    await db.query("update studio_caption_edits set state='released' where id=$1", [claims[1].id]);
    expect(
      await rpc("reserve_studio_caption_edit", { ...p, request_key: "caption-after-failure" }),
    ).toMatchObject({ included: true, replayed: false });
  });
  it("cannot earn free edits using an outsider or unpaid parent", async () => {
    expect(
      await rpc("reserve_studio_caption_edit", {
        account_id: account,
        workspace_id: workspace,
        user_id: OUTSIDER,
        parent_job_id: parent.id,
        request_key: "outsider",
      }),
    ).toEqual({ included: false });
    const { rows } = await db.query<{ id: string }>(
      "insert into studio_jobs(workspace_id,created_by,type,status,idempotency_key) values($1,$2,'image','succeeded','unpaid') returning id",
      [workspace, OWNER],
    );
    expect(
      await rpc("reserve_studio_caption_edit", {
        account_id: account,
        workspace_id: workspace,
        user_id: OWNER,
        parent_job_id: rows[0].id,
        request_key: "unpaid-edit",
      }),
    ).toEqual({ included: false });
  });
  it("reapplies the migration without changing a historical wallet or claim", async () => {
    await db.exec(
      readFileSync("supabase/migrations/20261027090000_creation_allowance.sql", "utf8"),
    );
    const { rows } = await db.query<{ available: string | number }>(
      "select available from meter_balances where account_id=$1 and meter='creation'",
      [account],
    );
    expect(Number(rows[0].available)).toBe(198);
  });
  it("denies direct browser writes and direct calls to the paid edit RPC", async () => {
    const privileges = await db.query<{ can_insert: boolean; can_update: boolean; can_read: boolean }>("select has_table_privilege('authenticated','studio_jobs','INSERT') can_insert,has_table_privilege('authenticated','studio_jobs','UPDATE') can_update,has_table_privilege('authenticated','studio_jobs','SELECT') can_read");
    expect(privileges.rows[0]).toEqual({ can_insert: false, can_update: false, can_read: true });
    await db.exec("begin; set local role authenticated;");
    try {
      await expect(
        db.query("select public.reserve_studio_caption_edit('{}'::jsonb)"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
  });
});
