import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "b1111111-1111-4111-8111-111111111111";
const EDITOR = "b2222222-2222-4222-8222-222222222222";
let db: PGlite;
let first: string;

async function invite(workspace: string, key: string) {
  const { rows } = await db.query<{ token: string }>(
    `insert into public.workspace_invites(workspace_id,email,role,invited_by,token)
     values($1,'editor@example.com','editor',$2,$3) returning token`,
    [workspace, OWNER, key],
  );
  return rows[0].token;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  await db.query("insert into auth.users(id,email) values($1,'editor@example.com')", [EDITOR]);
  const made = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'Brand A','https://a.test','seat-a')",
    [OWNER],
  );
  first = made.rows[0].workspace_id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("account seat limit", () => {
  it("does not allow browser writes that bypass the account lock", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE authenticated");
      await expect(
        db.query("update public.workspace_members set role='admin' where workspace_id=$1", [first]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("ROLLBACK");
    }
    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE authenticated");
      await expect(
        db.query("select public.accept_workspace_invite($1)", [
          "b3333333-3333-4333-8333-333333333333",
        ]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("blocks an extra paid role, permits it after upgrade and reuses it across brands", async () => {
    const token = await invite(first, "b3333333-3333-4333-8333-333333333333");
    await expect(
      db.query("select public.accept_billed_workspace_invite($1,$2,$3,1)", [
        token,
        EDITOR,
        "editor@example.com",
      ]),
    ).rejects.toThrow("billing_seat_limit");
    const accepted = await db.query<{ accept_billed_workspace_invite: string }>(
      "select public.accept_billed_workspace_invite($1,$2,$3,2)",
      [token, EDITOR, "editor@example.com"],
    );
    expect(accepted.rows[0].accept_billed_workspace_invite).toBe(first);

    const made = await db.query<{ workspace_id: string }>(
      "select workspace_id from private.create_workspace_for_user($1,'Brand B','https://b.test','seat-b')",
      [OWNER],
    );
    const second = made.rows[0].workspace_id;
    const token2 = await invite(second, "b4444444-4444-4444-8444-444444444444");
    await expect(
      db.query("select public.accept_billed_workspace_invite($1,$2,$3,2)", [
        token2,
        EDITOR,
        "editor@example.com",
      ]),
    ).resolves.toBeTruthy();
  });
});
