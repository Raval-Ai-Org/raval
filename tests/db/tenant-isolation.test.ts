// Tenant isolation suite (proposal E: "automated proof that one customer cannot
// read another's data").
//
// Replays the real migration baseline into PGlite (in-process Postgres), seeds
// two tenants plus a viewer, and exercises row-level security exactly the way
// PostgREST does: `SET LOCAL ROLE authenticated|anon` with the JWT claims in
// `request.jwt.claims`. Supabase grants every public table to anon and
// authenticated by default, so these assertions test RLS itself — not GRANTs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const VERA = "c3333333-3333-4333-8333-333333333333"; // viewer in Alice's workspace

type Tx = { query: PGlite["query"] };
let db: PGlite;
let wsA: string;
let wsB: string;

/** Run `fn` as a PostgREST caller, then roll everything back. */
async function as<T>(user: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    const claims = user ? { sub: user, role: "authenticated" } : { role: "anon" };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`SET LOCAL ROLE ${user ? "authenticated" : "anon"}`);
    return await fn(db);
  } finally {
    await db.exec("ROLLBACK");
  }
}

/** Rows visible to `user` in `table` for workspace `ws`, or "denied" on a permission error. */
async function visible(user: string | null, table: string, ws: string): Promise<number | "denied"> {
  return as(user, async (tx) => {
    try {
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where workspace_id = $1`,
        [ws],
      );
      return rows[0].n;
    } catch (e) {
      if (/permission denied/i.test(String(e))) return "denied";
      throw e;
    }
  });
}

async function seedWorkspace(ws: string, owner: string, tag: string) {
  const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const {
    rows: [item],
  } = await q<{ id: string }>(
    `insert into public.content_items (workspace_id, title, body, status, created_by)
     values ($1, $2, 'body', 'draft', $3) returning id`,
    [ws, `secret-${tag}`, owner],
  );
  await q(
    `insert into public.approvals (workspace_id, action, content_item_id) values ($1, 'publish', $2)`,
    [ws, item.id],
  );
  const {
    rows: [share],
  } = await q<{ id: string }>(
    `insert into public.client_shares (workspace_id, owner_id, slug, token_hash)
     values ($1, $2, $3, 'hash') returning id`,
    [ws, owner, `slug-${tag}`],
  );
  await q(`insert into public.client_share_items (share_id, kind) values ($1, 'content')`, [
    share.id,
  ]);
  await q(
    `insert into public.workspace_sdr (workspace_id, sdr_workspace_id, encrypted_api_key, sdr_base_url)
     values ($1, $2, 'v1:secret', 'https://sdr.example.com')`,
    [ws, `sdr-${tag}`],
  );
  await q(
    `insert into public.content_publications
       (workspace_id, content_item_id, sdr_post_id, sdr_target_id, platform, account_id)
     values ($1, $2, $3, $4, 'linkedin', $5)`,
    [ws, item.id, `post-${tag}`, `target-${tag}`, `acct-${tag}`],
  );
  await q(
    `insert into public.assets (workspace_id, generation_id, idempotency_key, filename)
     values ($1, $2, $3, 'a.png')`,
    [ws, `gen-${tag}`, `idem-${tag}`],
  );
  await q(`insert into public.conversations (workspace_id) values ($1)`, [ws]);
  await q(
    `insert into public.chat_messages (workspace_id, role, content) values ($1, 'user', 'hi')`,
    [ws],
  );
  await q(`insert into public.memory_insights (workspace_id, body) values ($1, 'insight')`, [ws]);
  await q(
    `insert into public.scheduled_jobs (workspace_id, title, next_run_at) values ($1, 'job', now())`,
    [ws],
  );
  await q(`select public.record_ai_usage($1::jsonb)`, [
    JSON.stringify({
      workspace_id: ws,
      user_id: owner,
      route: "chat",
      provider: "openrouter",
      model: "m",
      est_cost_usd: 0.01,
    }),
  ]);
  await q(`insert into public.guardrail_events (workspace_id, kind) values ($1, 'pii_redacted')`, [
    ws,
  ]);
  const {
    rows: [run],
  } = await q<{ id: string }>(
    `insert into public.agent_runs (workspace_id, agent, prompt, worker, status)
     values ($1, 'reliability', 'objective', 'distribution-reliability', 'succeeded') returning id`,
    [ws],
  );
  await q(
    `insert into public.agent_run_steps (run_id, workspace_id, seq, kind, tool)
     values ($1, $2, 1, 'tool', 'publications.list_stale')`,
    [run.id, ws],
  );
  await q(
    `insert into public.agent_findings (workspace_id, run_id, worker, fingerprint, severity, title)
     values ($1, $2, 'distribution-reliability', 'fp', 'high', 'Stale deliveries')`,
    [ws, run.id],
  );
  await q(
    `insert into public.agent_action_requests (workspace_id, tool, title, idempotency_key)
     values ($1, 'content.apply_revision', 'Apply revision', $2)`,
    [ws, `idem-action-${tag}`],
  );
  await q(`insert into public.workspace_agent_settings (workspace_id) values ($1)`, [ws]);
  await q(`insert into public.sdr_webhook_events (workspace_id, outcome) values ($1, 'verified')`, [
    ws,
  ]);
}

// Tables a workspace member may read (their own rows only).
const MEMBER_READABLE = [
  "content_items",
  "approvals",
  "assets",
  "conversations",
  "chat_messages",
  "memory_insights",
  "scheduled_jobs",
  "content_publications",
  "ai_usage_events",
  "ai_usage_daily",
  "guardrail_events",
  "agent_runs",
  "agent_run_steps",
  "agent_findings",
  "agent_action_requests",
  "workspace_agent_settings",
  "sdr_webhook_events",
];
// Every workspace-scoped table, including service-role-only ones.
const ALL_SCOPED = [...MEMBER_READABLE, "client_shares", "workspace_sdr"];

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
    [VERA, "vera@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  // Workspaces are created by the create_workspace RPC in the app; seed the
  // same rows directly (owner + owner membership).
  const ws = async (owner: string, name: string) => {
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
  };
  wsA = await ws(ALICE, "Alice Co");
  wsB = await ws(BOB, "Bob Co");
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')`,
    [wsA, VERA],
  );
  await seedWorkspace(wsA, ALICE, "A");
  await seedWorkspace(wsB, BOB, "B");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("tenant isolation — reads", () => {
  it.each(ALL_SCOPED)("%s: another tenant sees none of Alice's rows", async (table) => {
    const n = await visible(BOB, table, wsA);
    expect(n === 0 || n === "denied").toBe(true);
  });

  it.each(ALL_SCOPED)("%s: an anonymous caller sees nothing", async (table) => {
    const n = await visible(null, table, wsA);
    expect(n === 0 || n === "denied").toBe(true);
  });

  it.each(MEMBER_READABLE)("%s: the owner can read their own workspace's rows", async (table) => {
    expect(await visible(ALICE, table, wsA)).toBeGreaterThan(0);
  });

  it("workspace_sdr (encrypted SDR keys) is unreadable even by the owning workspace", async () => {
    expect(await visible(ALICE, "workspace_sdr", wsA)).toSatisfy((n) => n === 0 || n === "denied");
  });

  it("a member cannot read another workspace's share token hashes", async () => {
    const rows = await as(BOB, (tx) =>
      tx.query(`select token_hash from public.client_shares where workspace_id = $1`, [wsA]),
    );
    expect(rows.rows).toHaveLength(0);
  });
});

describe("tenant isolation — writes", () => {
  it("another tenant cannot update or delete Alice's content", async () => {
    await as(BOB, async (tx) => {
      const upd = await tx.query(
        `update public.content_items set title = 'pwned' where workspace_id = $1`,
        [wsA],
      );
      expect(upd.affectedRows ?? 0).toBe(0);
      const del = await tx.query(`delete from public.content_items where workspace_id = $1`, [wsA]);
      expect(del.affectedRows ?? 0).toBe(0);
    });
    const { rows } = await db.query<{ title: string }>(
      `select title from public.content_items where workspace_id = $1`,
      [wsA],
    );
    expect(rows[0].title).toBe("secret-A");
  });

  it("another tenant cannot insert content into Alice's workspace", async () => {
    await expect(
      as(BOB, (tx) =>
        tx.query(`insert into public.content_items (workspace_id, title) values ($1, 'x')`, [wsA]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("a viewer cannot change content or decide approvals", async () => {
    await as(VERA, async (tx) => {
      const content = await tx.query(
        `update public.content_items set title = 'v' where workspace_id = $1`,
        [wsA],
      );
      expect(content.affectedRows ?? 0).toBe(0);
      const approvals = await tx.query(
        `update public.approvals set status = 'approved' where workspace_id = $1`,
        [wsA],
      );
      expect(approvals.affectedRows ?? 0).toBe(0);
    });
  });

  it.each([
    [
      "ai_usage_events",
      "insert into public.ai_usage_events (workspace_id, route, provider, model) values ($1, 'r', 'p', 'm')",
    ],
    [
      "guardrail_events",
      "insert into public.guardrail_events (workspace_id, kind) values ($1, 'pii_redacted')",
    ],
    [
      "agent_findings",
      "insert into public.agent_findings (workspace_id, worker, fingerprint, severity, title) values ($1, 'w', 'f2', 'low', 't')",
    ],
    [
      "agent_action_requests",
      "insert into public.agent_action_requests (workspace_id, tool, title, idempotency_key) values ($1, 't', 't', 'k2')",
    ],
    [
      "workspace_agent_settings",
      "update public.workspace_agent_settings set agents_paused = true where workspace_id = $1",
    ],
    [
      "sdr_webhook_events",
      "insert into public.sdr_webhook_events (workspace_id, outcome) values ($1, 'verified')",
    ],
  ])("%s: even the owner cannot write it directly (server-only)", async (_table, sql) => {
    await expect(as(ALICE, (tx) => tx.query(sql, [wsA]))).rejects.toThrow(/permission denied/i);
  });
});

describe("tenant isolation — functions", () => {
  it.each([
    ["record_ai_usage", "select public.record_ai_usage('{}'::jsonb)"],
    ["ai_usage_summary", "select * from public.ai_usage_summary('ws:x')"],
    [
      "claim_due_scheduled_jobs",
      "select * from public.claim_due_scheduled_jobs(1, 60, false, null)",
    ],
    ["prune_operational_logs", "select public.prune_operational_logs()"],
  ])("%s is not callable by an authenticated user", async (_fn, sql) => {
    await expect(as(ALICE, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/i);
  });

  it("anon can no longer probe workspace membership via private.is_workspace_member", async () => {
    await expect(
      as(null, (tx) => tx.query(`select private.is_workspace_member($1, $2)`, [wsA, ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("claim_due_scheduled_jobs leases a job once until the lease expires", async () => {
    const first = await db.query(
      `select id from public.claim_due_scheduled_jobs(10, 300, false, null)`,
    );
    expect(first.rows.length).toBe(2);
    const second = await db.query(
      `select id from public.claim_due_scheduled_jobs(10, 300, false, null)`,
    );
    expect(second.rows.length).toBe(0);
    await db.query(`update public.scheduled_jobs set locked_at = null`);
  });

  it("record_ai_usage folds events into per-workspace and per-user daily rollups", async () => {
    const { rows } = await db.query<{ scope_key: string; calls: number }>(
      `select scope_key, calls from public.ai_usage_daily where scope_key in ($1, $2) order by 1`,
      [`ws:${wsA}`, `user:${ALICE}`],
    );
    expect(rows.map((r) => r.calls)).toEqual([1, 1]);
  });
});
