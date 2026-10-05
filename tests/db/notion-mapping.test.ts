import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
let db: PGlite;
let workspaceA: string;
let workspaceB: string;
let itemId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    "insert into auth.users(id,email) values($1,'alice@example.com'),($2,'bob@example.com')",
    [ALICE, BOB],
  );
  workspaceA = (
    await db.query<{ workspace_id: string }>(
      "select workspace_id from private.create_workspace_for_user($1,'A','https://a.test','notion-a')",
      [ALICE],
    )
  ).rows[0].workspace_id;
  workspaceB = (
    await db.query<{ workspace_id: string }>(
      "select workspace_id from private.create_workspace_for_user($1,'B','https://b.test','notion-b')",
      [BOB],
    )
  ).rows[0].workspace_id;
  itemId = (
    await db.query<{ id: string }>(
      "insert into public.content_items(workspace_id,title,status,created_by) values($1,'A post','draft',$2) returning id",
      [workspaceA, ALICE],
    )
  ).rows[0].id;
}, 120_000);
afterAll(async () => {
  await db?.close();
});
async function asAlice<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ALICE, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    return await fn();
  } finally {
    await db.exec("ROLLBACK");
  }
}

describe("Notion credential and mapping boundaries", () => {
  it("allows one mapping per item and destination", async () => {
    await db.query(
      "insert into public.notion_content_mappings(workspace_id,content_item_id,notion_page_id,notion_data_source_id) values($1,$2,'page-one','source-one')",
      [workspaceA, itemId],
    );
    await expect(
      db.query(
        "insert into public.notion_content_mappings(workspace_id,content_item_id,notion_page_id,notion_data_source_id) values($1,$2,'page-two','source-one')",
        [workspaceA, itemId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "insert into public.notion_content_mappings(workspace_id,content_item_id,notion_page_id,notion_data_source_id) values($1,$2,'page-one','source-two')",
        [workspaceA, itemId],
      ),
    ).rejects.toThrow();
  });
  it("keeps credentials and mappings inaccessible to authenticated clients", async () => {
    await db.query(
      "insert into public.workspace_connections(workspace_id,provider,status,external_account_id,account_login,verification) values($1,'notion','active','notion-workspace','Notion','oauth')",
      [workspaceA],
    );
    const conn = (
      await db.query<{ id: string }>(
        "select id from public.workspace_connections where workspace_id=$1 and provider='notion'",
        [workspaceA],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.notion_oauth_credentials(connection_id,workspace_id,access_token_enc) values($1,$2,'v1:encrypted')",
      [conn, workspaceA],
    );
    await asAlice(async () => {
      await expect(
        db.query(
          "select access_token_enc from public.notion_oauth_credentials where workspace_id=$1",
          [workspaceA],
        ),
      ).rejects.toThrow(/permission denied/i);
    });
    await asAlice(async () => {
      await expect(
        db.query("select * from public.notion_content_mappings where workspace_id=$1", [
          workspaceA,
        ]),
      ).rejects.toThrow(/permission denied/i);
    });
    await asAlice(async () => {
      const visible = await db.query<{ n: number }>(
        "select count(*)::int as n from public.workspace_connections where workspace_id=$1",
        [workspaceA],
      );
      const foreign = await db.query<{ n: number }>(
        "select count(*)::int as n from public.workspace_connections where workspace_id=$1",
        [workspaceB],
      );
      expect(visible.rows[0].n).toBe(1);
      expect(foreign.rows[0].n).toBe(0);
    });
  });
  it("allows one active connection and one sync lease per workspace", async () => {
    await expect(
      db.query(
        "insert into public.workspace_connections(workspace_id,provider,status,external_account_id,account_login,verification) values($1,'notion','active','another-notion-workspace','Other','oauth')",
        [workspaceA],
      ),
    ).rejects.toThrow();
    const owner = "33333333-3333-4333-8333-333333333333";
    const first = await db.query(
      "update public.notion_oauth_credentials set sync_lock_owner=$2,sync_lock_until=now()+interval '45 minutes' where workspace_id=$1 and sync_lock_until is null returning connection_id",
      [workspaceA, owner],
    );
    const second = await db.query(
      "update public.notion_oauth_credentials set sync_lock_owner=$2,sync_lock_until=now()+interval '45 minutes' where workspace_id=$1 and (sync_lock_until is null or sync_lock_until < now()) returning connection_id",
      [workspaceA, "44444444-4444-4444-8444-444444444444"],
    );
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });
});
