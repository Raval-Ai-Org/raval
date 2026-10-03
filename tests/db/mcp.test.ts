// MCP database invariants (ADR-0029).
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read the workspace's MCP setting; browsers never write it;
//   - only admins read the record of tool calls, and only their workspace's;
//   - the record is append-only, even for the service role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const VERA = "c3333333-3333-4333-8333-333333333333";

type Tx = { query: PGlite["query"] };
let db: PGlite;
let wsA: string;
let wsB: string;

async function as<T>(user: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    return await fn(db);
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function workspace(owner: string, name: string) {
  const {
    rows: [row],
  } = await db.query<{ id: string }>(
    `insert into public.workspaces (owner_id, name) values ($1, $2) returning id`,
    [owner, name],
  );
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')
     on conflict do nothing`,
    [row.id, owner],
  );
  return row.id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
    [VERA, "vera@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  wsA = await workspace(ALICE, "Alice Co");
  wsB = await workspace(BOB, "Bob Co");
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`,
    [wsA, VERA],
  );
  await db.query(
    `insert into public.mcp_workspace_settings (workspace_id, enabled, allow_writes, updated_by)
     values ($1, true, false, $2)`,
    [wsA, ALICE],
  );
  for (const ws of [wsA, wsB]) {
    await db.query(
      `insert into public.mcp_tool_calls (workspace_id, user_id, client_id, tool, ok)
       values ($1, $2, 'app', 'list_content', true)`,
      [ws, ws === wsA ? ALICE : BOB],
    );
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("mcp_workspace_settings", () => {
  it("persists the two permissions independently for each workspace", async () => {
    await db.exec("BEGIN");
    try {
      await db.query(
        `update public.mcp_workspace_settings set allow_writes = true where workspace_id = $1`,
        [wsA],
      );
      await db.query(
        `insert into public.mcp_workspace_settings (workspace_id, enabled, allow_writes)
         values ($1, false, false)`,
        [wsB],
      );
      const { rows } = await db.query<{
        workspace_id: string;
        enabled: boolean;
        allow_writes: boolean;
      }>(
        `select workspace_id, enabled, allow_writes from public.mcp_workspace_settings
         where workspace_id in ($1, $2) order by workspace_id`,
        [wsA, wsB],
      );
      expect(rows).toEqual(
        [
          { workspace_id: wsA, enabled: true, allow_writes: true },
          { workspace_id: wsB, enabled: false, allow_writes: false },
        ].sort((a, b) => a.workspace_id.localeCompare(b.workspace_id)),
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("is off until a row says otherwise", async () => {
    const { rows } = await db.query(
      `select enabled from public.mcp_workspace_settings where workspace_id = $1`,
      [wsB],
    );
    expect(rows).toHaveLength(0);
  });

  it("lets a member read their workspace's setting and nobody else's", async () => {
    const mine = await as(VERA, (tx) =>
      tx.query(`select workspace_id from public.mcp_workspace_settings`),
    );
    expect(mine.rows).toEqual([{ workspace_id: wsA }]);
    const theirs = await as(BOB, (tx) =>
      tx.query(`select workspace_id from public.mcp_workspace_settings`),
    );
    expect(theirs.rows).toHaveLength(0);
  });

  it("refuses a browser write, even from the owner", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(
          `update public.mcp_workspace_settings set allow_writes = true where workspace_id = $1`,
          [wsA],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      as(BOB, (tx) =>
        tx.query(
          `insert into public.mcp_workspace_settings (workspace_id, enabled) values ($1, true)`,
          [wsB],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("mcp_tool_calls", () => {
  it("is read by admins of that workspace only", async () => {
    const owner = await as(ALICE, (tx) =>
      tx.query(`select workspace_id from public.mcp_tool_calls`),
    );
    expect(owner.rows).toEqual([{ workspace_id: wsA }]);
    const viewer = await as(VERA, (tx) => tx.query(`select id from public.mcp_tool_calls`));
    expect(viewer.rows).toHaveLength(0);
  });

  it("refuses a browser insert", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(
          `insert into public.mcp_tool_calls (workspace_id, user_id, tool, ok) values ($1, $2, 'x', true)`,
          [wsA, ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("is append-only, even for the service role", async () => {
    await expect(
      db.query(`update public.mcp_tool_calls set ok = false where workspace_id = $1`, [wsA]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`delete from public.mcp_tool_calls where workspace_id = $1`, [wsA]),
    ).rejects.toThrow(/append-only/);
  });
});
