import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import {
  applyMigrations,
  createSupabaseDb,
  resolveManifest,
} from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const SCHEMA = "20261002090000_billing_account_schema.sql";
const FUNCTIONS = "20261002090100_billing_meter_rpcs.sql";

async function legacyDb(): Promise<{ db: PGlite; workspace: string }> {
  const db: PGlite = await createSupabaseDb();
  await applyMigrations(
    db,
    (resolveManifest() as string[]).filter((x) => x < SCHEMA),
  );
  await db.query(`insert into auth.users(id,email) values($1,'owner@example.com')`, [OWNER]);
  const made = await db.query<{ workspace_id: string }>(
    `select workspace_id from private.create_workspace_for_user($1,'Legacy','https://legacy.test','old-key')`,
    [OWNER],
  );
  return { db, workspace: made.rows[0].workspace_id };
}

async function oldCredit(
  db: PGlite,
  workspace: string,
  kind: string,
  key: string,
  available: number,
  held: number,
) {
  const { rows } = await db.query<{ r: { ok: boolean } }>(
    `select public.apply_credit_entry($1::jsonb) as r`,
    [
      JSON.stringify({
        workspace_id: workspace,
        kind,
        idempotency_key: key,
        delta_available: available,
        delta_held: held,
      }),
    ],
  );
  expect(rows[0].r.ok).toBe(true);
}

describe("legacy backlink balance migration", () => {
  it("copies purchased value once and refuses to replay a historical top-up", async () => {
    const { db, workspace } = await legacyDb();
    try {
      await oldCredit(db, workspace, "topup", "topup:old-payment", 200, 0);
      await applyMigrations(db, [SCHEMA, FUNCTIONS]);
      const { rows } = await db.query<{ billing_account_id: string }>(
        `select billing_account_id from public.workspaces where id=$1`,
        [workspace],
      );
      const account = rows[0].billing_account_id;
      const balance = await db.query<{ available: string; available_any: string }>(
        `select available,available_any from public.meter_balances where account_id=$1 and meter='credits'`,
        [account],
      );
      expect(Number(balance.rows[0].available)).toBe(300);
      expect(Number(balance.rows[0].available_any)).toBe(200);
      const replay = await db.query<{ r: { ok: boolean; replayed: boolean } }>(
        `select public.apply_credit_entry($1::jsonb) as r`,
        [
          JSON.stringify({
            workspace_id: workspace,
            kind: "topup",
            idempotency_key: "topup:old-payment",
            delta_available: 200,
          }),
        ],
      );
      expect(replay.rows[0].r).toMatchObject({ ok: true, replayed: true });
      await applyMigrations(db, [SCHEMA, FUNCTIONS]);
      const after = await db.query<{ available: string }>(
        `select available from public.meter_balances where account_id=$1 and meter='credits'`,
        [account],
      );
      expect(Number(after.rows[0].available)).toBe(300);
    } finally {
      await db.close();
    }
  }, 120_000);

  it("stops before moving money when a legacy link order still has held credits", async () => {
    const { db, workspace } = await legacyDb();
    try {
      await oldCredit(db, workspace, "topup", "topup:live-order", 100, 0);
      await oldCredit(db, workspace, "hold", "order:live:hold", -30, 30);
      await expect(applyMigrations(db, [SCHEMA])).rejects.toThrow(/legacy backlink holds are live/);
    } finally {
      await db.close();
    }
  }, 120_000);
});
