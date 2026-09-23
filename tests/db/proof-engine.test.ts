// Proof Engine database invariants (ADR-0024).
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read, browsers never write (status, assignments, metrics, events);
//   - the design (primary metric, split) is locked once an experiment leaves draft;
//   - a page is in at most one active experiment;
//   - events are append-only; approval hash, live date and verdict are final;
//   - rows can't cross workspaces; deleting a workspace or repository still works.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);

type Tx = { query: PGlite["query"] };
let db: PGlite;
let wsA: string;
let wsB: string;
let sourceA: string;
let sourceB: string;

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

async function repository(ws: string, tag: string) {
  const {
    rows: [conn],
  } = await db.query<{ id: string }>(
    `insert into public.workspace_connections
       (workspace_id, provider, external_account_id, account_login, verification)
     values ($1, 'github', $2, 'acme', 'oauth') returning id`,
    [ws, `inst-${tag}`],
  );
  const {
    rows: [src],
  } = await db.query<{ id: string }>(
    `insert into public.workspace_sources
       (workspace_id, connection_id, provider, external_id, name, full_name, site_host)
     values ($1, $2, 'github', $3, 'site', $4, 'example.com') returning id`,
    [ws, conn.id, `repo-${tag}`, `acme/site-${tag}`],
  );
  return src.id;
}

async function experiment(tx: Tx, ws: string, source: string, status = "draft") {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.experiments
       (workspace_id, source_id, site_host, name, change_type, primary_metric, status)
     values ($1, $2, 'example.com', 'Titles', 'title', 'clicks', 'draft') returning id`,
    [ws, source],
  );
  await tx.query(
    `insert into public.experiment_assignments
       (experiment_id, workspace_id, site_host, page_url, path, arm, stratum)
     values ($1, $2, 'example.com', 'https://example.com/p/a', '/p/a', 'treatment', 0),
            ($1, $2, 'example.com', 'https://example.com/p/b', '/p/b', 'control', 0)`,
    [row.id, ws],
  );
  await tx.query(
    `insert into public.experiment_changes (experiment_id, workspace_id, path, field, before, after)
     values ($1, $2, '/p/a', 'title', 'Old', 'New')`,
    [row.id, ws],
  );
  if (status !== "draft") {
    await tx.query(`update public.experiments set status = $2 where id = $1`, [row.id, status]);
  }
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
  sourceA = await repository(wsA, "A");
  sourceB = await repository(wsB, "B");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("proof engine — browser access", () => {
  it("members read their experiments; other tenants see none", async () => {
    const id = await experiment(db, wsA, sourceA);
    try {
      const mine = await as(ALICE, (tx) =>
        tx.query(`select id from public.experiments where id = $1`, [id]),
      );
      expect(mine.rows).toHaveLength(1);
      const theirs = await as(BOB, (tx) =>
        tx.query(`select id from public.experiment_assignments where experiment_id = $1`, [id]),
      );
      expect(theirs.rows).toHaveLength(0);
    } finally {
      await db.query(`delete from public.experiments where id = $1`, [id]);
    }
  });

  it.each([
    [
      `insert into public.experiments (workspace_id, source_id, site_host, name, change_type, primary_metric)
      values ('${"$WS"}', '${"$SRC"}', 'example.com', 'x', 'title', 'clicks')`,
    ],
    [`update public.experiments set status = 'concluded', verdict = 'win'`],
    [`update public.experiment_assignments set arm = 'control'`],
    [
      `insert into public.experiment_metrics_daily (experiment_id, workspace_id, date, path, arm, clicks)
      select id, workspace_id, current_date, '/p/a', 'treatment', 999 from public.experiments`,
    ],
    [
      `insert into public.experiment_events (experiment_id, workspace_id, kind, summary)
      select id, workspace_id, 'verdict', 'fake' from public.experiments`,
    ],
    [
      `insert into public.workspace_report_branding (workspace_id, display_name) values ('${"$WS"}', 'X')`,
    ],
  ])("a member cannot write: %s", async (sql) => {
    const id = await experiment(db, wsA, sourceA);
    try {
      await as(ALICE, async (tx) => {
        await rejects(
          tx.query(sql.replaceAll("$WS", wsA).replaceAll("$SRC", sourceA)),
          /permission denied|row-level security/i,
        );
      });
    } finally {
      await db.query(`delete from public.experiments where id = $1`, [id]);
    }
  });

  it("the claim RPC is not callable by members", async () => {
    await as(ALICE, async (tx) => {
      await rejects(
        tx.query(`select * from public.claim_experiment_jobs('w')`),
        /permission denied/,
      );
    });
  });
});

describe("proof engine — design lock", () => {
  it("allows edits in draft", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA);
      await tx.query(`update public.experiments set primary_metric = 'impressions' where id = $1`, [
        id,
      ]);
      await tx.query(
        `update public.experiment_assignments set arm = 'control' where experiment_id = $1 and path = '/p/a'`,
        [id],
      );
    }));

  it.each([
    ["primary_metric = 'impressions'"],
    ["secondary_metrics = '{sessions}'"],
    ["change_type = 'h1'"],
    ["assignment_seed = 42"],
    ["pre_period_start = current_date"],
    ["planned_min_days = 14"],
  ])("refuses %s after draft", (set) =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "awaiting_approval");
      await rejects(tx.query(`update public.experiments set ${set} where id = $1`, [id]), /locked/);
    }),
  );

  it("freezes assignments and changes after draft, except exclusion", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "running");
      await tx.query(
        `update public.experiment_assignments set excluded_at = now(), excluded_reason = '404'
          where experiment_id = $1 and path = '/p/a'`,
        [id],
      );
      await tx.query("SAVEPOINT s");
      await rejects(
        tx.query(
          `update public.experiment_assignments set arm = 'control' where experiment_id = $1`,
          [id],
        ),
        /locked/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await rejects(
        tx.query(`update public.experiment_changes set after = 'Other' where experiment_id = $1`, [
          id,
        ]),
        /locked/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await rejects(
        tx.query(`delete from public.experiment_assignments where experiment_id = $1`, [id]),
        /locked/,
      );
    }));

  it("approval hash, live date and verdict are final", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "awaiting_approval");
      await tx.query(`update public.experiments set approved_patch_hash = $2 where id = $1`, [
        id,
        HASH,
      ]);
      await tx.query("SAVEPOINT s");
      await rejects(
        tx.query(`update public.experiments set approved_patch_hash = $2 where id = $1`, [
          id,
          "b".repeat(64),
        ]),
        /final/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await tx.query(
        `update public.experiments set live_confirmed_at = now(), status = 'running' where id = $1`,
        [id],
      );
      await tx.query("SAVEPOINT t");
      await rejects(
        tx.query(
          `update public.experiments set live_confirmed_at = now() - interval '1 day' where id = $1`,
          [id],
        ),
        /final/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT t");
      await tx.query(
        `update public.experiments set status = 'concluded', verdict = 'win' where id = $1`,
        [id],
      );
      await rejects(
        tx.query(`update public.experiments set verdict = 'loss' where id = $1`, [id]),
        /final/,
      );
    }));

  it("a verdict needs a concluded state", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "running");
      await rejects(
        tx.query(`update public.experiments set verdict = 'win' where id = $1`, [id]),
        /experiments_verdict_status_check/,
      );
    }));

  it("refuses unknown statuses", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA);
      await rejects(
        tx.query(`update public.experiments set status = 'won' where id = $1`, [id]),
        /experiments_status_check/,
      );
    }));
});

describe("proof engine — one active experiment per page", () => {
  it("refuses a page already in an active experiment", () =>
    service(async (tx) => {
      await experiment(tx, wsA, sourceA, "running");
      await rejects(experiment(tx, wsA, sourceA), /one_active_per_page/);
    }));

  it("frees the page once the experiment is closed or cancelled", () =>
    service(async (tx) => {
      const first = await experiment(tx, wsA, sourceA, "running");
      await tx.query(`update public.experiments set status = 'cancelled' where id = $1`, [first]);
      const second = await experiment(tx, wsA, sourceA);
      expect(second).toBeTruthy();
    }));

  it("keeps an invalidated experiment's pages (its change may still be live)", () =>
    service(async (tx) => {
      const first = await experiment(tx, wsA, sourceA, "running");
      await tx.query(`update public.experiments set status = 'invalidated' where id = $1`, [first]);
      await rejects(experiment(tx, wsA, sourceA), /one_active_per_page/);
    }));
});

describe("proof engine — events", () => {
  it("are append-only", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA);
      await tx.query(
        `insert into public.experiment_events (experiment_id, workspace_id, kind, summary)
         values ($1, $2, 'created', 'Experiment created')`,
        [id, wsA],
      );
      await tx.query("SAVEPOINT s");
      await rejects(tx.query(`update public.experiment_events set summary = 'x'`), /append-only/);
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await rejects(tx.query(`delete from public.experiment_events`), /append-only/);
    }));
});

describe("proof engine — tenancy and deletion", () => {
  it("refuses an experiment on another workspace's repository", () =>
    service(async (tx) => {
      await rejects(experiment(tx, wsA, sourceB), /does not match its source/);
    }));

  it("refuses a child row pointing at another workspace's experiment", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA);
      await rejects(
        tx.query(
          `insert into public.experiment_metrics_daily (experiment_id, workspace_id, date, path, arm)
           values ($1, $2, current_date, '/p/a', 'treatment')`,
          [id, wsB],
        ),
        /does not match its experiment/,
      );
    }));

  it("disconnecting a repository keeps the experiment history", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "running");
      await tx.query(
        `insert into public.experiment_events (experiment_id, workspace_id, kind, summary)
         values ($1, $2, 'created', 'Experiment created')`,
        [id, wsA],
      );
      await tx.query(`delete from public.workspace_sources where id = $1`, [sourceA]);
      const { rows } = await tx.query<{ source_id: string | null }>(
        `select source_id from public.experiments where id = $1`,
        [id],
      );
      expect(rows[0].source_id).toBeNull();
    }));

  it("deleting a workspace removes a running experiment with its events", () =>
    service(async (tx) => {
      const id = await experiment(tx, wsA, sourceA, "running");
      await tx.query(
        `insert into public.experiment_events (experiment_id, workspace_id, kind, summary)
         values ($1, $2, 'created', 'Experiment created')`,
        [id, wsA],
      );
      await tx.query(`delete from public.workspaces where id = $1`, [wsA]);
      const { rows } = await tx.query(
        `select 1 from public.experiment_events where experiment_id = $1`,
        [id],
      );
      expect(rows).toHaveLength(0);
    }));

  it("report branding logos must live under the workspace's own assets", () =>
    service(async (tx) => {
      await tx.query("SAVEPOINT s");
      await rejects(
        tx.query(
          `insert into public.workspace_report_branding (workspace_id, logo_path) values ($1, $2)`,
          [wsA, `workspace/${wsB}/assets/branding/logo.png`],
        ),
        /logo_path_check/,
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await tx.query(
        `insert into public.workspace_report_branding (workspace_id, logo_path) values ($1, $2)`,
        [wsA, `workspace/${wsA}/assets/branding/logo.png`],
      );
    }));
});

describe("proof engine — experiment_overview()", () => {
  it("sums won value still in place and counts running, per caller workspace", async () => {
    await db.exec("BEGIN");
    try {
      const won = await experiment(db, wsA, sourceA, "running");
      await db.query(
        `update public.experiments set status = 'concluded', verdict = 'win',
           estimated_monthly_value = 3200, value_currency = 'USD' where id = $1`,
        [won],
      );
      await db.query(
        `update public.experiments set status = 'closed', closed_via = 'rollout' where id = $1`,
        [won],
      );
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: ALICE, role: "authenticated" }),
      ]);
      await db.exec("SET LOCAL ROLE authenticated");
      const { rows } = await db.query<{
        workspace_id: string;
        proven_monthly_value: string | null;
        won_experiments: string;
      }>(`select * from public.experiment_overview()`);
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_id).toBe(wsA);
      expect(Number(rows[0].proven_monthly_value)).toBe(3200);
      expect(Number(rows[0].won_experiments)).toBe(1);
    } finally {
      await db.exec("ROLLBACK");
    }
  });
});
