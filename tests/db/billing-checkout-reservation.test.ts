import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "e1111111-1111-4111-8111-111111111111";
let db: PGlite;
let account: string;

async function checkout(kind: "plan" | "credit_pack", key: string) {
  return db.query<{ id: string }>(
    `insert into public.checkout_intents(account_id,created_by,kind,catalog_key,interval,quantity,expires_at)
     values($1,$2,$3,$4,$5,1,now()+interval '35 minutes') returning id`,
    [account, OWNER, kind, key, kind === "plan" ? "month" : null],
  );
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const made = await db.query<{ ensure_billing_account: string }>(
    "select public.ensure_billing_account($1)",
    [OWNER],
  );
  account = made.rows[0].ensure_billing_account;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("subscription checkout reservation", () => {
  it("allows only one open plan session, then releases the reservation", async () => {
    const first = await checkout("plan", "growth");
    await expect(checkout("plan", "agency")).rejects.toThrow(/unique|duplicate/i);
    await checkout("credit_pack", "credits_25");
    await checkout("credit_pack", "credits_100");
    await db.query("update public.checkout_intents set consumed_at=now() where id=$1", [
      first.rows[0].id,
    ]);
    await expect(checkout("plan", "agency")).resolves.toBeTruthy();
  });
});
