// Audience database invariants (ADR-0031).
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read, browsers never write (any of the six tables);
//   - the worker claim is service-role only and leases a run once;
//   - one run per idempotency key; one prediction per cache key; one frozen
//     result per prediction and per post;
//   - run events are append-only; rows can't cross workspaces;
//   - a prediction never touches content_items, and outlives a deleted piece;
//   - the background-charge kinds still include every older kind.
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

async function one(tx: Tx, sql: string, params: unknown[]) {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(sql, params);
  return row.id;
}

const content = (tx: Tx, ws: string, user: string, status = "draft") =>
  one(
    tx,
    `insert into public.content_items (workspace_id, title, body, status, created_by)
     values ($1, 'A post', 'Hello there', $2, $3) returning id`,
    [ws, status, user],
  );

const run = (tx: Tx, ws: string, key: string, contentId: string | null = null) =>
  one(
    tx,
    `insert into public.audience_runs (workspace_id, kind, idempotency_key, content_item_id)
     values ($1, 'pulse', $2, $3) returning id`,
    [ws, key, contentId],
  );

const prediction = (
  tx: Tx,
  ws: string,
  hash: string,
  contentId: string | null = null,
  runId: string | null = null,
) =>
  one(
    tx,
    `insert into public.audience_predictions
       (workspace_id, content_item_id, run_id, subject, subject_hash, twins_fingerprint, depth, overall, score_version)
     values ($1, $2, $3, '{"kind":"post","body":"Hello there"}', $4, 'fp-0000000000000001', 'score', 70, 1)
     returning id`,
    [ws, contentId, runId, hash],
  );

const twin = (tx: Tx, ws: string, slug: string) =>
  one(
    tx,
    `insert into public.audience_twins (workspace_id, slug, name) values ($1, $2, 'Owners') returning id`,
    [ws, slug],
  );

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await expect(p).rejects.toThrow(pattern);
}

const HASH = "0123456789abcdef0123456789abcdef";

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

describe("audience — browser access", () => {
  it("members read their own rows; other tenants see none", async () => {
    await service(async (tx) => {
      const twinId = await twin(tx, wsA, "owners");
      const runId = await run(tx, wsA, "pulse:key-0001");
      const predictionId = await prediction(tx, wsA, HASH, null, runId);
      await tx.query(
        `insert into public.audience_run_events (workspace_id, run_id, kind, summary)
         values ($1, $2, 'group_answered', 'Owners answered.')`,
        [wsA, runId],
      );
      await tx.query(
        `insert into public.audience_outcomes (workspace_id, prediction_id, engagement, predicted)
         values ($1, $2, 0.1, 70)`,
        [wsA, predictionId],
      );
      await tx.query(
        `insert into public.audience_calibration (workspace_id, platform, content_type, n)
         values ($1, 'all', 'all', 1)`,
        [wsA],
      );
      for (const [table, id] of [
        ["audience_twins", twinId],
        ["audience_runs", runId],
        ["audience_predictions", predictionId],
      ]) {
        for (const [user, expected] of [
          [ALICE, 1],
          [BOB, 0],
        ] as const) {
          await tx.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ sub: user, role: "authenticated" }),
          ]);
          await db.exec("SET LOCAL ROLE authenticated");
          const { rows } = await tx.query(`select id from public.${table} where id = $1`, [id]);
          expect(rows, `${table} as ${user}`).toHaveLength(expected);
          await db.exec("RESET ROLE");
        }
      }
      for (const table of ["audience_run_events", "audience_outcomes", "audience_calibration"]) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: BOB, role: "authenticated" }),
        ]);
        await db.exec("SET LOCAL ROLE authenticated");
        const { rows } = await tx.query(`select 1 from public.${table} where workspace_id = $1`, [
          wsA,
        ]);
        expect(rows, table).toHaveLength(0);
        await db.exec("RESET ROLE");
      }
    });
  });

  it("a member's browser cannot write any audience table", async () => {
    await rejects(
      as(ALICE, (tx) => twin(tx, wsA, "mine")),
      /permission denied|row-level security/i,
    );
    await rejects(
      as(ALICE, (tx) => run(tx, wsA, "pulse:key-0002")),
      /permission denied|row-level security/i,
    );
    await rejects(
      as(ALICE, (tx) => prediction(tx, wsA, HASH)),
      /permission denied|row-level security/i,
    );
    await rejects(
      as(ALICE, (tx) =>
        tx.query(
          `insert into public.audience_calibration (workspace_id, platform, content_type) values ($1, 'all', 'all')`,
          [wsA],
        ),
      ),
      /permission denied|row-level security/i,
    );
  });

  it("the worker claim is not callable from a browser", async () => {
    await rejects(
      as(ALICE, (tx) => tx.query(`select * from public.claim_audience_runs('w')`)),
      /permission denied/i,
    );
  });
});

describe("audience — runs", () => {
  it("leases a due run once, and again only after the lease ends", async () => {
    await service(async (tx) => {
      const id = await run(tx, wsA, "pulse:key-lease");
      const first = await tx.query<{ id: string }>(
        `select id from public.claim_audience_runs('worker-a', 5, 150)`,
      );
      expect(first.rows.map((r) => r.id)).toContain(id);
      const second = await tx.query(
        `select id from public.claim_audience_runs('worker-b', 5, 150)`,
      );
      expect(second.rows).toHaveLength(0);
      await tx.query(
        `update public.audience_runs set lease_until = now() - interval '1 second' where id = $1`,
        [id],
      );
      const third = await tx.query(
        `select id from public.claim_audience_runs('worker-b', 5, 150, $1)`,
        [id],
      );
      expect(third.rows).toHaveLength(1);
    });
  });

  it("never claims a finished run", async () => {
    await service(async (tx) => {
      const id = await run(tx, wsA, "pulse:key-done");
      await tx.query(`update public.audience_runs set status = 'succeeded' where id = $1`, [id]);
      const claimed = await tx.query(`select id from public.claim_audience_runs('w', 5, 150, $1)`, [
        id,
      ]);
      expect(claimed.rows).toHaveLength(0);
    });
  });

  it("allows one run per key in a workspace, and the same key in another", async () => {
    await service(async (tx) => {
      await run(tx, wsA, "pulse:key-same");
      await run(tx, wsB, "pulse:key-same");
      await rejects(run(tx, wsA, "pulse:key-same"), /audience_runs_key_unique/);
    });
  });

  it("keeps run events append-only, but lets them go with their run", async () => {
    await service(async (tx) => {
      const id = await run(tx, wsA, "pulse:key-events");
      await tx.query(
        `insert into public.audience_run_events (workspace_id, run_id, kind, summary) values ($1, $2, 'run_failed', 'Stopped.')`,
        [wsA, id],
      );
      await rejects(
        tx.query(`update public.audience_run_events set summary = 'x' where run_id = $1`, [id]),
        /append-only/,
      );
    });
    await service(async (tx) => {
      const id = await run(tx, wsA, "pulse:key-events-2");
      await tx.query(
        `insert into public.audience_run_events (workspace_id, run_id, kind, summary) values ($1, $2, 'run_failed', 'Stopped.')`,
        [wsA, id],
      );
      await rejects(
        tx.query(`delete from public.audience_run_events where run_id = $1`, [id]),
        /append-only/,
      );
    });
    await service(async (tx) => {
      const id = await run(tx, wsA, "pulse:key-events-3");
      await tx.query(
        `insert into public.audience_run_events (workspace_id, run_id, kind, summary) values ($1, $2, 'run_failed', 'Stopped.')`,
        [wsA, id],
      );
      await tx.query(`delete from public.audience_runs where id = $1`, [id]);
      const left = await tx.query(`select 1 from public.audience_run_events where run_id = $1`, [
        id,
      ]);
      expect(left.rows).toHaveLength(0);
    });
  });
});

describe("audience — tenant integrity", () => {
  it("refuses a run, prediction or result that points into another workspace", async () => {
    await service(async (tx) => {
      const foreign = await content(tx, wsB, BOB);
      await rejects(run(tx, wsA, "pulse:key-foreign", foreign), /does not match its content/);
    });
    await service(async (tx) => {
      const foreign = await content(tx, wsB, BOB);
      await rejects(prediction(tx, wsA, HASH, foreign), /does not match its content/);
    });
    await service(async (tx) => {
      const theirRun = await run(tx, wsB, "pulse:key-theirs");
      await rejects(prediction(tx, wsA, HASH, null, theirRun), /does not match its run/);
    });
    await service(async (tx) => {
      const theirs = await prediction(tx, wsB, HASH);
      await rejects(
        tx.query(
          `insert into public.audience_outcomes (workspace_id, prediction_id, engagement, predicted) values ($1, $2, 0.1, 50)`,
          [wsA, theirs],
        ),
        /does not match its prediction/,
      );
    });
    await service(async (tx) => {
      const theirRun = await run(tx, wsB, "pulse:key-theirs-2");
      await rejects(
        tx.query(
          `insert into public.audience_run_events (workspace_id, run_id, kind, summary) values ($1, $2, 'x_y', 'Nope.')`,
          [wsA, theirRun],
        ),
        /does not match its run/,
      );
    });
  });
});

describe("audience — predictions and results", () => {
  it("stores one prediction per text, audience, depth and scoring version", async () => {
    await service(async (tx) => {
      await prediction(tx, wsA, HASH);
      // The same text in another workspace is that workspace's own row.
      await prediction(tx, wsB, HASH);
      await rejects(prediction(tx, wsA, HASH), /audience_predictions_cache_unique/);
    });
  });

  it("scoring a piece leaves it exactly as it was, approved included", async () => {
    await service(async (tx) => {
      const id = await content(tx, wsA, ALICE, "approved");
      const before = await tx.query(
        `select status, updated_at from public.content_items where id = $1`,
        [id],
      );
      const runId = await run(tx, wsA, "pulse:key-approved", id);
      await prediction(tx, wsA, HASH, id, runId);
      const after = await tx.query(
        `select status, updated_at from public.content_items where id = $1`,
        [id],
      );
      expect(after.rows).toEqual(before.rows);
      expect((after.rows[0] as { status: string }).status).toBe("approved");
    });
  });

  it("a prediction outlives the piece it scored", async () => {
    await service(async (tx) => {
      const id = await content(tx, wsA, ALICE);
      const predictionId = await prediction(tx, wsA, HASH, id);
      await tx.query(`delete from public.content_items where id = $1`, [id]);
      const { rows } = await tx.query<{ content_item_id: string | null }>(
        `select content_item_id from public.audience_predictions where id = $1`,
        [predictionId],
      );
      expect(rows).toEqual([{ content_item_id: null }]);
    });
  });

  it("freezes one real result per prediction and per post", async () => {
    await service(async (tx) => {
      const id = await content(tx, wsA, ALICE);
      const first = await prediction(tx, wsA, HASH, id);
      const insert = (predictionId: string) =>
        tx.query(
          `insert into public.audience_outcomes (workspace_id, prediction_id, content_item_id, engagement, predicted)
           values ($1, $2, $3, 0.12, 70)`,
          [wsA, predictionId, id],
        );
      await insert(first);
      await rejects(insert(first), /audience_outcomes_once|audience_outcomes_content_once_idx/);
    });
    await service(async (tx) => {
      const id = await content(tx, wsA, ALICE);
      const first = await prediction(tx, wsA, HASH, id);
      const second = await prediction(tx, wsA, `${HASH}ff`, id);
      const insert = (predictionId: string) =>
        tx.query(
          `insert into public.audience_outcomes (workspace_id, prediction_id, content_item_id, engagement, predicted)
           values ($1, $2, $3, 0.12, 70)`,
          [wsA, predictionId, id],
        );
      await insert(first);
      await rejects(insert(second), /audience_outcomes_content_once_idx/);
    });
  });

  it("keeps scores and group fields inside their limits", async () => {
    await service(async (tx) => {
      await rejects(
        tx.query(
          `insert into public.audience_predictions
             (workspace_id, subject, subject_hash, twins_fingerprint, depth, overall, score_version)
           values ($1, '{}', $2, 'fp', 'score', 101, 1)`,
          [wsA, HASH],
        ),
        /audience_predictions_overall_check/,
      );
    });
    await service(async (tx) => {
      await rejects(twin(tx, wsA, "Not A Slug"), /audience_twins_slug_check/);
    });
    await service(async (tx) => {
      await twin(tx, wsA, "owners");
      await rejects(twin(tx, wsA, "owners"), /audience_twins_slug_unique/);
    });
  });
});

describe("audience — billing", () => {
  it("adds its background-charge kind without dropping the older ones", async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'billing_async_links_kind_check'`,
    );
    expect(rows).toHaveLength(1);
    for (const kind of [
      "geo_agent_run",
      "fix_batch",
      "competitor_intel",
      "competitor_profile",
      "brand_voice",
      "audience_run",
    ]) {
      expect(rows[0].def).toContain(`'${kind}'`);
    }
  });
});
