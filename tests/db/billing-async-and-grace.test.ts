import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "e1111111-1111-4111-8111-111111111111";
const SOLO = "e2222222-2222-4222-8222-222222222222";
let db: PGlite;
let account: string;
let firstBrand: string;

async function rpc(name: string, body: Record<string, unknown>) {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.${name}($1::jsonb) as r`,
    [JSON.stringify(body)],
  );
  return rows[0].r;
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [OWNER, "agency@example.com"],
    [SOLO, "solo@example.com"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
  }
  const brands = ["one", "two"].map((name, i) =>
    db.query<{ workspace_id: string }>(
      "select workspace_id from private.create_workspace_for_user($1,$2,$3,$4)",
      [OWNER, name, `https://${name}.test`, `grace-${i}`],
    ),
  );
  firstBrand = (await brands[0]).rows[0].workspace_id;
  await brands[1];
  await db.query(
    "select workspace_id from private.create_workspace_for_user($1,'Solo','https://solo.test','grace-solo')",
    [SOLO],
  );
  const acct = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from public.workspaces where id=$1",
    [firstBrand],
  );
  account = acct.rows[0].billing_account_id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("background job holds", () => {
  it("are never released by the clock while their job is owed a settlement", async () => {
    await rpc("meter_grant", {
      account_id: account,
      meter: "credits",
      amount: 1000,
      source: "adjustment",
      restriction: "ai_only",
      idempotency_key: "test:async:grant",
    });
    const hold = await rpc("meter_hold", {
      account_id: account,
      workspace_id: firstBrand,
      meter: "credits",
      action: "competitor_intel",
      amount: 30,
      idempotency_key: "test:async:hold",
      expires_at: "2020-01-01T00:00:00Z",
    });
    expect(hold.ok).toBe(true);
    await db.query(
      `insert into public.billing_async_links(kind,ref_id,account_id,workspace_id,hold_id,charge_key,action,amount,mode)
       values('competitor_intel','run-1',$1,$2,$3,'k1','competitor_intel',30,'on')`,
      [account, firstBrand, hold.id],
    );
    const kept = await db.query<{ n: number }>("select private.meter_release_expired_holds() as n");
    expect(kept.rows[0].n).toBe(0);
    await db.query("update public.billing_async_links set settled_at=now() where ref_id='run-1'");
    const released = await db.query<{ n: number }>(
      "select private.meter_release_expired_holds() as n",
    );
    expect(released.rows[0].n).toBe(1);
  });
});

describe("launch grace month", () => {
  it("gives over-limit accounts the smallest plan that fits, once", async () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261002092400_billing_launch_grace.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const rows = await db.query<{ owner_user_id: string; comped_plan_id: string | null }>(
      "select owner_user_id, comped_plan_id from public.billing_accounts",
    );
    const byOwner = new Map(rows.rows.map((row) => [row.owner_user_id, row.comped_plan_id]));
    expect(byOwner.get(OWNER)).toBe("growth");
    expect(byOwner.get(SOLO)).toBeNull();
    const activations = await db.query<{ n: string }>(
      "select count(*)::text as n from public.billing_manual_activations where reason='Launch grace month'",
    );
    expect(activations.rows[0].n).toBe("1");
  });
});

describe("tracked prompts", () => {
  it("are claimed once per lease and hidden from other brands", async () => {
    await db.query(
      "insert into public.geo_tracked_prompts(workspace_id,text) values($1,'best crm for agencies')",
      [firstBrand],
    );
    const first = await db.query("select * from public.claim_tracked_prompts(5, 300)");
    const second = await db.query("select * from public.claim_tracked_prompts(5, 300)");
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
    await expect(
      db.query(
        "insert into public.geo_tracked_prompts(workspace_id,text) values($1,'BEST CRM for agencies')",
        [firstBrand],
      ),
    ).rejects.toThrow();
  });
});
