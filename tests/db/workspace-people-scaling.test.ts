import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — shared migration harness is JavaScript.
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const OWNER = "c1111111-1111-4111-8111-111111111111";
const MEMBERS = Array.from(
  { length: 12 },
  (_, i) => `c${String(i + 2).padStart(7, "0")}-2222-4222-8222-222222222222`,
);
let db: PGlite;
let workspaceId: string;
let accountId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.com')", [OWNER]);
  const workspace = await db.query<{ workspace_id: string }>(
    "select workspace_id from private.create_workspace_for_user($1,'People','https://people.test','people-page')",
    [OWNER],
  );
  workspaceId = workspace.rows[0].workspace_id;
  const account = await db.query<{ billing_account_id: string }>(
    "select billing_account_id from public.workspaces where id=$1",
    [workspaceId],
  );
  accountId = account.rows[0].billing_account_id;
  for (const [i, userId] of MEMBERS.entries()) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      userId,
      `member-${i}@example.com`,
    ]);
    await db.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
      [workspaceId, userId],
    );
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("workspace people queries", () => {
  it("returns stable bounded pages with emails and an exact total", async () => {
    type Page = { total: number; members: Array<{ user_id: string; email: string }> };
    const first = await db.query<{ workspace_members_page: Page }>(
      "select public.workspace_members_page($1,0,10)",
      [workspaceId],
    );
    const second = await db.query<{ workspace_members_page: Page }>(
      "select public.workspace_members_page($1,10,10)",
      [workspaceId],
    );
    expect(first.rows[0].workspace_members_page.total).toBe(13);
    expect(first.rows[0].workspace_members_page.members).toHaveLength(10);
    expect(second.rows[0].workspace_members_page.members).toHaveLength(3);
    const combined = [
      ...first.rows[0].workspace_members_page.members,
      ...second.rows[0].workspace_members_page.members,
    ];
    expect(new Set(combined.map((member) => member.user_id)).size).toBe(13);
    expect(combined.find((member) => member.user_id === MEMBERS[0])?.email).toBe(
      "member-0@example.com",
    );
  });

  it("looks up one email and checks whether that user already has a seat", async () => {
    const found = await db.query<{ auth_user_id_for_email: string }>(
      "select public.auth_user_id_for_email('MEMBER-0@EXAMPLE.COM')",
    );
    expect(found.rows[0].auth_user_id_for_email).toBe(MEMBERS[0]);
    const unseated = await db.query<{ account_has_billable_member: boolean }>(
      "select public.account_has_billable_member($1,$2)",
      [accountId, MEMBERS[0]],
    );
    expect(unseated.rows[0].account_has_billable_member).toBe(false);
    await db.query(
      "update public.workspace_members set role='editor' where workspace_id=$1 and user_id=$2",
      [workspaceId, MEMBERS[0]],
    );
    const seated = await db.query<{ account_has_billable_member: boolean }>(
      "select public.account_has_billable_member($1,$2)",
      [accountId, MEMBERS[0]],
    );
    expect(seated.rows[0].account_has_billable_member).toBe(true);
    const seats = await db.query<{ account_billable_seat_count: number }>(
      "select public.account_billable_seat_count($1)",
      [accountId],
    );
    expect(seats.rows[0].account_billable_seat_count).toBe(2);
  });

  it("does not expose service-only lookups to authenticated callers", async () => {
    for (const query of [
      () => db.query("select public.auth_user_id_for_email('owner@example.com')"),
      () => db.query("select public.workspace_members_page($1,0,10)", [workspaceId]),
      () => db.query("select public.account_has_billable_member($1,$2)", [accountId, OWNER]),
      () => db.query("select public.account_billable_seat_count($1)", [accountId]),
    ]) {
      await db.exec("BEGIN");
      try {
        await db.exec("SET LOCAL ROLE authenticated");
        await expect(query()).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("ROLLBACK");
      }
    }
  });
});
