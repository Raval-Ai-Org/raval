import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "a1111111-1111-4111-8111-111111111111";
let db: PGlite;

async function create(name: string, domain: string, key: string, limit: number) {
  const { rows } = await db.query<{ workspace_id: string; created: boolean }>(
    "select * from public.create_billed_workspace_for_user($1,$2,$3,$4,$5)",
    [OWNER, name, `https://${domain}`, key, limit],
  );
  return rows[0];
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("account brand limit", () => {
  it("allows idempotent replay and same-domain lookup even when full, but blocks a new brand", async () => {
    const first = await create("First", "first.test", "click-1", 1);
    expect(first.created).toBe(true);
    expect(await create("First", "first.test", "click-1", 1)).toEqual({
      workspace_id: first.workspace_id,
      created: false,
    });
    expect(await create("First renamed", "first.test", "click-2", 1)).toEqual({
      workspace_id: first.workspace_id,
      created: false,
    });
    await expect(create("Second", "second.test", "click-3", 1)).rejects.toThrow(
      "billing_brand_limit",
    );
    const second = await create("Second", "second.test", "click-3", 2);
    expect(second.created).toBe(true);
    expect(second.workspace_id).not.toBe(first.workspace_id);
  });

  it("does not expose the billed creation RPC to an authenticated client", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE authenticated");
      await expect(create("Third", "third.test", "click-4", 3)).rejects.toThrow();
    } finally {
      await db.exec("ROLLBACK");
    }
  });
});
