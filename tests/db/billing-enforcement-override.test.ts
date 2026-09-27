import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "f1111111-1111-4111-8111-111111111111";
const ADMIN = "f2222222-2222-4222-8222-222222222222";
const ACTION = "f3333333-3333-4333-8333-333333333333";
const REASON = "Pilot billing enforcement for the account";
let db: PGlite;
let account: string;

async function change(mode: string | null) {
  const { rows } = await db.query<{ result: { ok: boolean; replayed: boolean } }>(
    "select public.set_billing_enforcement_override($1,$2,$3,$4,$5) as result",
    [ACTION, account, ADMIN, mode, REASON],
  );
  return rows[0].result;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@example.com'),($2,'admin@example.com')",
    [OWNER, ADMIN],
  );
  const made = await db.query<{ ensure_billing_account: string }>(
    "select public.ensure_billing_account($1)",
    [OWNER],
  );
  account = made.rows[0].ensure_billing_account;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("audited account enforcement", () => {
  it("changes once and rejects an idempotency key with different terms", async () => {
    expect(await change("on")).toMatchObject({ ok: true, replayed: false });
    expect(await change("on")).toMatchObject({ ok: true, replayed: true });
    await expect(change("off")).rejects.toThrow("enforcement action key conflict");
    const { rows } = await db.query<{ mode: string; audits: number }>(
      `select a.enforcement_override as mode,
        (select count(*)::int from public.billing_enforcement_actions where account_id=a.id) as audits
       from public.billing_accounts a where a.id=$1`,
      [account],
    );
    expect(rows[0]).toEqual({ mode: "on", audits: 1 });
  });

  it("is unavailable to authenticated browser roles", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE authenticated");
      await expect(change("on")).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("ROLLBACK");
    }
  });
});
