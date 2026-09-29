import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "c1111111-1111-4111-8111-111111111111";
let db: PGlite;
let first: string;
let second: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const a = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'First','https://first.test','slot-1')",
    [OWNER],
  );
  const b = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Second','https://second.test','slot-2')",
    [OWNER],
  );
  first = a.rows[0].workspace_id;
  second = b.rows[0].workspace_id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("Post for Me profile slots", () => {
  it("serializes brand reservations and frees capacity only after disconnect", async () => {
    await db.query("select public.reserve_billing_social_profile_slot($1,1)", [first]);
    await db.query("select public.reserve_billing_social_profile_slot($1,1)", [first]);
    await expect(
      db.query("select public.reserve_billing_social_profile_slot($1,1)", [second]),
    ).rejects.toThrow("billing_social_profile_limit");
    await db.query("select public.activate_billing_social_profile_slot($1)", [first]);
    await db.query(
      `insert into public.social_accounts(workspace_id,provider,provider_account_id,platform,status)
       values($1,'postforme','account-1','instagram','active')`,
      [first],
    );
    const live = await db.query<{ release_billing_social_profile_slot_if_empty: boolean }>(
      "select public.release_billing_social_profile_slot_if_empty($1)",
      [first],
    );
    expect(live.rows[0].release_billing_social_profile_slot_if_empty).toBe(false);
    await db.query(
      "update public.social_accounts set status='disconnected' where workspace_id=$1",
      [first],
    );
    const freed = await db.query<{ release_billing_social_profile_slot_if_empty: boolean }>(
      "select public.release_billing_social_profile_slot_if_empty($1)",
      [first],
    );
    expect(freed.rows[0].release_billing_social_profile_slot_if_empty).toBe(true);
    await db.query("select public.reserve_billing_social_profile_slot($1,1)", [second]);
  });
});
