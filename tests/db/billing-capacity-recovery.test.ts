import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "c1111111-1111-4111-8111-111111111111";
const EDITOR = "c2222222-2222-4222-8222-222222222222";
let db: PGlite;
let account: string;
let older: string;
let newer: string;

async function reconcile(brands: number, seats: number, preferred?: string) {
  const { rows } = await db.query<{ result: { frozen_brands: number; suspended_seats: number } }>(
    "select public.reconcile_billing_capacity($1,$2,$3,$4) as result",
    [account, brands, seats, preferred ?? null],
  );
  return rows[0].result;
}

async function brand(id: string) {
  const { rows } = await db.query<{ frozen_at: string | null }>(
    "select frozen_at from public.workspaces where id=$1",
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@example.com'),($2,'editor@example.com')",
    [OWNER, EDITOR],
  );
  const first = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Older','https://older.test','capacity-older')",
    [OWNER],
  );
  const second = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Newer','https://newer.test','capacity-newer')",
    [OWNER],
  );
  older = first.rows[0].workspace_id;
  newer = second.rows[0].workspace_id;
  const owned = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from public.workspaces where id=$1",
    [older],
  );
  account = owned.rows[0].billing_account_id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')",
    [older, EDITOR],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("billing capacity recovery", () => {
  it("freezes only excess brands, lets the owner choose, then restores on upgrade", async () => {
    expect(await reconcile(1, 2)).toEqual({ frozen_brands: 1, suspended_seats: 0 });
    expect((await brand(older)).frozen_at).toBeNull();
    expect((await brand(newer)).frozen_at).not.toBeNull();
    expect(await reconcile(1, 2, newer)).toEqual({ frozen_brands: 1, suspended_seats: 0 });
    expect((await brand(older)).frozen_at).not.toBeNull();
    expect((await brand(newer)).frozen_at).toBeNull();
    expect(await reconcile(2, 2)).toEqual({ frozen_brands: 0, suspended_seats: 0 });
    expect((await brand(older)).frozen_at).toBeNull();
  });

  it("suspends paid seat privileges and restores the original role", async () => {
    expect(await reconcile(2, 1)).toEqual({ frozen_brands: 0, suspended_seats: 1 });
    const suspended = await db.query<{ role: string }>(
      "select role from public.workspace_members where workspace_id=$1 and user_id=$2",
      [older, EDITOR],
    );
    expect(suspended.rows[0].role).toBe("viewer");
    expect(await reconcile(2, 2)).toEqual({ frozen_brands: 0, suspended_seats: 0 });
    const restored = await db.query<{ role: string }>(
      "select role from public.workspace_members where workspace_id=$1 and user_id=$2",
      [older, EDITOR],
    );
    expect(restored.rows[0].role).toBe("editor");
  });

  it("rejects browser writes into or out of a frozen brand", async () => {
    await reconcile(1, 2, newer);
    const inserted = await db.query<{ id: string }>(
      "insert into public.content_items(workspace_id,title,body,status,created_by) values($1,'Existing','body','draft',$2) returning id",
      [older, OWNER],
    );
    for (const statement of [
      {
        sql: "update public.content_items set workspace_id=$1 where id=$2",
        params: [newer, inserted.rows[0].id],
      },
      {
        sql: "insert into public.content_items(workspace_id,title,body,status,created_by) values($1,'New','body','draft',$2)",
        params: [older, OWNER],
      },
    ]) {
      await db.exec("BEGIN");
      try {
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: OWNER, role: "authenticated" }),
        ]);
        await expect(db.query(statement.sql, statement.params)).rejects.toThrow(
          "billing_brand_frozen",
        );
      } finally {
        await db.exec("ROLLBACK");
      }
    }
    const after = await db.query<{ workspace_id: string }>(
      "select workspace_id from public.content_items where id=$1",
      [inserted.rows[0].id],
    );
    expect(after.rows[0].workspace_id).toBe(older);
    await reconcile(2, 2);
  });
});
