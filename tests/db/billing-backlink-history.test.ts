import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "d1111111-1111-4111-8111-111111111111";
let db: PGlite;
let workspace: string;
let account: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const made = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Brand','https://brand.test','backlink-history')",
    [OWNER],
  );
  workspace = made.rows[0].workspace_id;
  const owned = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from public.workspaces where id=$1",
    [workspace],
  );
  account = owned.rows[0].billing_account_id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("backlink spend across the ledger migration", () => {
  it("combines historical workspace spend with new account captures exactly once", async () => {
    await db.query(
      "insert into public.workspace_credit_balances(workspace_id,lifetime_spent) values($1,250)",
      [workspace],
    );
    await db.query(
      "insert into public.billing_charges(account_id,workspace_id,action,meter,amount) values($1,$2,'backlink_order','credits',175),($1,$2,'coach','credits',100)",
      [account, workspace],
    );
    const { rows } = await db.query<{ spent: string }>(
      "select public.backlink_spent_credits($1) as spent",
      [workspace],
    );
    expect(Number(rows[0].spent)).toBe(425);
  });
});
