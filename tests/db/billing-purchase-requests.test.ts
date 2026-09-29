import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "d1111111-1111-4111-8111-111111111111";
const ADMIN = "d2222222-2222-4222-8222-222222222222";
let db: PGlite;
let account: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const created = await db.query<{ ensure_billing_account: string }>(
    "select public.ensure_billing_account($1)",
    [OWNER],
  );
  account = created.rows[0].ensure_billing_account;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("Upgrade now requests and manual activations", () => {
  it("keeps one open request per item and allows a new one after it closes", async () => {
    const insert = () =>
      db.query(
        `insert into public.billing_purchase_requests(account_id,requested_by,kind,catalog_key,billing_interval)
         values($1,$2,'plan','growth','year') returning id`,
        [account, OWNER],
      );
    const first = await insert();
    await expect(insert()).rejects.toThrow();
    await db.query("update public.billing_purchase_requests set status='approved' where id=$1", [
      (first.rows[0] as { id: string }).id,
    ]);
    await expect(insert()).resolves.toBeTruthy();
  });

  it("records each activation once and never lets it change", async () => {
    const id = "d3333333-3333-4333-8333-333333333333";
    const activate = () =>
      db.query(
        `insert into public.billing_manual_activations(id,account_id,actor_user_id,kind,catalog_key,billing_interval,months,reason)
         values($1,$2,$3,'plan','growth','month',1,'Paid by bank transfer')`,
        [id, account, ADMIN],
      );
    await activate();
    await expect(activate()).rejects.toThrow();
    await expect(
      db.query("update public.billing_manual_activations set months=12 where id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      db.query("delete from public.billing_manual_activations where id=$1", [id]),
    ).rejects.toThrow();
  });

  it("hides both tables from signed-in browsers", async () => {
    const grants = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee='authenticated' and table_name in ('billing_purchase_requests','billing_manual_activations')`,
    );
    expect(grants.rows).toHaveLength(0);
  });
});
