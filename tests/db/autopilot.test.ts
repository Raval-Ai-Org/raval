// Autopilot database invariants (ADR-0028).
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read, browsers never write (programs, actions, opportunities, events);
//   - one live program per workspace; one action per dedupe key; one row per fingerprint;
//   - the worker claim is service-role only, leases once, and skips paused programs;
//   - events are append-only; rows can't cross workspaces;
//   - autopilot_overview() only ever describes the caller's own workspaces.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";

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

/** Run `fn` as the service role (the default superuser here), rolled back. */
async function service<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
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

async function program(tx: Tx, ws: string, user: string, status = "running") {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.autopilot_programs
       (workspace_id, status, mode, goal, platforms, content_types, starts_on, ends_on, acting_user_id, created_by)
     values ($1, $2, 'autopilot', 'leads', '{linkedin}', '{social}', current_date, current_date + 27, $3, $3)
     returning id`,
    [ws, status, user],
  );
  return row.id;
}

async function action(
  tx: Tx,
  ws: string,
  programId: string | null,
  key: string,
  status = "planned",
) {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.autopilot_actions (workspace_id, program_id, kind, status, dedupe_key, title)
     values ($1, $2, 'content', $3, $4, 'A post') returning id`,
    [ws, programId, status, key],
  );
  return row.id;
}

async function opportunity(tx: Tx, ws: string, fingerprint: string, kind = "competitor") {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.marketing_opportunities
       (workspace_id, kind, title, source_kind, fingerprint, score, expires_at)
     values ($1, $2, 'Acme launched something', 'competitor_update', $3, 80, now() + interval '7 days')
     returning id`,
    [ws, kind, fingerprint],
  );
  return row.id;
}

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await expect(p).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  wsA = await workspace(ALICE, "Alice Co");
  wsB = await workspace(BOB, "Bob Co");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("autopilot — browser access", () => {
  it("members read their own rows; other tenants see none", async () => {
    const programId = await program(db, wsA, ALICE);
    const actionId = await action(db, wsA, programId, "content:a:1");
    const oppId = await opportunity(db, wsA, "competitor:https://acme.com/a");
    await db.query(
      `insert into public.autopilot_events (workspace_id, program_id, kind, summary)
       values ($1, $2, 'program_started', 'Autopilot started.')`,
      [wsA, programId],
    );
    try {
      for (const [table, id] of [
        ["autopilot_programs", programId],
        ["autopilot_actions", actionId],
        ["marketing_opportunities", oppId],
      ]) {
        const mine = await as(ALICE, (tx) =>
          tx.query(`select id from public.${table} where id = $1`, [id]),
        );
        expect(mine.rows, table).toHaveLength(1);
        const theirs = await as(BOB, (tx) =>
          tx.query(`select id from public.${table} where id = $1`, [id]),
        );
        expect(theirs.rows, table).toHaveLength(0);
      }
      const events = await as(BOB, (tx) =>
        tx.query(`select id from public.autopilot_events where workspace_id = $1`, [wsA]),
      );
      expect(events.rows).toHaveLength(0);
    } finally {
      await db.query(`delete from public.autopilot_programs where id = $1`, [programId]);
      await db.query(`delete from public.marketing_opportunities where id = $1`, [oppId]);
    }
  });

  it.each([
    [
      "start a program",
      `insert into public.autopilot_programs (workspace_id, goal, starts_on, ends_on)
       values ('WS', 'leads', current_date, current_date + 7)`,
    ],
    [
      "add an action",
      `insert into public.autopilot_actions (workspace_id, kind, dedupe_key) values ('WS', 'content', 'x:1')`,
    ],
    [
      "add an opportunity",
      `insert into public.marketing_opportunities
         (workspace_id, kind, title, source_kind, fingerprint, score, expires_at)
       values ('WS', 'trend', 'A trend', 'market_brain', 'trend:x', 99, now() + interval '1 day')`,
    ],
    [
      "write history",
      `insert into public.autopilot_events (workspace_id, kind, summary) values ('WS', 'note', 'hello')`,
    ],
  ])("a member cannot %s from the browser", async (_label, sql) => {
    await as(ALICE, async (tx) => {
      await rejects(tx.query(sql.replace("WS", wsA)), /permission denied|row-level security/);
    });
  });

  it("a member cannot approve or reschedule an action from the browser", async () => {
    const programId = await program(db, wsA, ALICE);
    const actionId = await action(db, wsA, programId, "content:a:2", "needs_approval");
    try {
      await as(ALICE, async (tx) => {
        await rejects(
          tx.query(`update public.autopilot_actions set status = 'approved' where id = $1`, [
            actionId,
          ]),
          /permission denied/,
        );
      });
    } finally {
      await db.query(`delete from public.autopilot_programs where id = $1`, [programId]);
    }
  });

  it("the claim RPC is not callable by members", async () => {
    await as(ALICE, async (tx) => {
      await rejects(
        tx.query(`select * from public.claim_autopilot_actions('w')`),
        /permission denied/,
      );
    });
  });
});

describe("autopilot — no duplicates", () => {
  it("allows one live program per workspace, and a new one after it finishes", () =>
    service(async (tx) => {
      const first = await program(tx, wsA, ALICE);
      await tx.query("SAVEPOINT s");
      await rejects(program(tx, wsA, ALICE, "paused"), /autopilot_programs_one_live_idx/);
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await tx.query(`update public.autopilot_programs set status = 'stopped' where id = $1`, [
        first,
      ]);
      await expect(program(tx, wsA, ALICE)).resolves.toBeTruthy();
    }));

  it("refuses a second action with the same dedupe key in a workspace", () =>
    service(async (tx) => {
      const p = await program(tx, wsA, ALICE);
      await action(tx, wsA, p, "content:p:1:0");
      await tx.query("SAVEPOINT s");
      await rejects(action(tx, wsA, p, "content:p:1:0"), /autopilot_actions_dedupe_unique/);
      await tx.query("ROLLBACK TO SAVEPOINT s");
      // The same key in another workspace is a different piece.
      await expect(action(tx, wsB, null, "content:p:1:0")).resolves.toBeTruthy();
    }));

  it("keeps one opportunity per fingerprint", () =>
    service(async (tx) => {
      await opportunity(tx, wsA, "competitor:https://acme.com/launch");
      await tx.query("SAVEPOINT s");
      await rejects(
        opportunity(tx, wsA, "competitor:https://acme.com/launch"),
        /marketing_opportunities_fingerprint_unique/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
    }));
});

describe("autopilot — worker claim", () => {
  it("leases a due action once and skips paused programs", () =>
    service(async (tx) => {
      const running = await program(tx, wsA, ALICE);
      const paused = await program(tx, wsB, BOB, "paused");
      const due = await action(tx, wsA, running, "content:r:1");
      await action(tx, wsB, paused, "content:p:1");
      const oneOff = await action(tx, wsB, null, "opp:1:0");
      await action(tx, wsA, running, "content:r:2", "proposed");

      const first = await tx.query<{ id: string }>(
        `select id from public.claim_autopilot_actions('w1')`,
      );
      expect(first.rows.map((r) => r.id).sort()).toEqual([due, oneOff].sort());
      const second = await tx.query(`select id from public.claim_autopilot_actions('w2')`);
      expect(second.rows).toHaveLength(0);
    }));
});

describe("autopilot — history and tenancy", () => {
  it("events cannot be changed or deleted, even by the service role", () =>
    service(async (tx) => {
      const {
        rows: [event],
      } = await tx.query<{ id: string }>(
        `insert into public.autopilot_events (workspace_id, kind, summary)
         values ($1, 'note', 'First') returning id`,
        [wsA],
      );
      await tx.query("SAVEPOINT s");
      await rejects(
        tx.query(`update public.autopilot_events set summary = 'Changed' where id = $1`, [
          event.id,
        ]),
        /append-only/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await rejects(
        tx.query(`delete from public.autopilot_events where id = $1`, [event.id]),
        /append-only/,
      );
    }));

  it("deleting a workspace still removes its history", () =>
    service(async (tx) => {
      const {
        rows: [ws],
      } = await tx.query<{ id: string }>(
        `insert into public.workspaces (owner_id, name) values ($1, 'Temp') returning id`,
        [ALICE],
      );
      const p = await program(tx, ws.id, ALICE);
      await tx.query(
        `insert into public.autopilot_events (workspace_id, program_id, kind, summary)
         values ($1, $2, 'note', 'x')`,
        [ws.id, p],
      );
      await tx.query(`delete from public.autopilot_programs where id = $1`, [p]);
      const left = await tx.query(`select 1 from public.autopilot_events where workspace_id = $1`, [
        ws.id,
      ]);
      expect(left.rows).toHaveLength(0);
    }));

  it("an action cannot point at another workspace's program or opportunity", () =>
    service(async (tx) => {
      const programB = await program(tx, wsB, BOB);
      const oppB = await opportunity(tx, wsB, "competitor:https://beta.com/x");
      await tx.query("SAVEPOINT s");
      await rejects(action(tx, wsA, programB, "content:x:1"), /does not match its program/);
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await rejects(
        tx.query(
          `insert into public.autopilot_actions (workspace_id, kind, dedupe_key, opportunity_id)
           values ($1, 'content', 'opp:x:0', $2)`,
          [wsA, oppB],
        ),
        /does not match its opportunity/,
      );
    }));
});

describe("autopilot_overview()", () => {
  it("returns only the caller's workspaces, with their own counts", async () => {
    const programA = await program(db, wsA, ALICE);
    const programB = await program(db, wsB, BOB);
    await action(db, wsA, programA, "content:o:1", "needs_approval");
    await action(db, wsA, programA, "content:o:2", "failed");
    await action(db, wsB, programB, "content:o:1", "needs_approval");
    const oppA = await opportunity(db, wsA, "competitor:https://acme.com/o");
    try {
      const alice = await as(ALICE, (tx) =>
        tx.query<{
          workspace_id: string;
          status: string;
          needs_approval: string;
          failures: string;
          new_opportunities: string;
        }>(`select * from public.autopilot_overview()`),
      );
      expect(alice.rows.map((r) => r.workspace_id)).toEqual([wsA]);
      expect(alice.rows[0].status).toBe("running");
      expect(Number(alice.rows[0].needs_approval)).toBe(1);
      expect(Number(alice.rows[0].failures)).toBe(1);
      expect(Number(alice.rows[0].new_opportunities)).toBe(1);

      const bob = await as(BOB, (tx) =>
        tx.query<{ workspace_id: string; needs_approval: string }>(
          `select * from public.autopilot_overview()`,
        ),
      );
      expect(bob.rows.map((r) => r.workspace_id)).toEqual([wsB]);
      expect(Number(bob.rows[0].needs_approval)).toBe(1);
    } finally {
      await db.query(`delete from public.autopilot_programs where id in ($1, $2)`, [
        programA,
        programB,
      ]);
      await db.query(`delete from public.marketing_opportunities where id = $1`, [oppA]);
    }
  });
});
