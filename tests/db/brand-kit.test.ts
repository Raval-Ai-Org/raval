// Brand Kit / Styles database invariants.
//
// Replays the real migrations into PGlite and checks what the database itself
// guarantees, independent of server code:
//   - members read their own workspace's styles and kit assets, never others';
//   - browsers never write (the server writes after a role check);
//   - one default style per workspace, set atomically;
//   - kit files stay under the workspace's brand-kit storage prefix.
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

async function style(tx: Tx, ws: string, name: string, isDefault = false) {
  const {
    rows: [row],
  } = await tx.query<{ id: string }>(
    `insert into public.brand_styles (workspace_id, name, is_default) values ($1, $2, $3) returning id`,
    [ws, name, isDefault],
  );
  return row.id;
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
  await db.query(
    `insert into public.brand_styles (workspace_id, name) values ($1, 'Alice style')`,
    [wsA],
  );
  await db.query(`insert into public.brand_styles (workspace_id, name) values ($1, 'Bob style')`, [
    wsB,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("brand kit — browser access", () => {
  it("members read only their own workspace's styles", async () => {
    const names = await as(ALICE, async (tx) => {
      const { rows } = await tx.query<{ name: string }>(`select name from public.brand_styles`);
      return rows.map((r) => r.name);
    });
    expect(names).toEqual(["Alice style"]);
  });

  it("browsers cannot insert, update or delete styles", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(`insert into public.brand_styles (workspace_id, name) values ($1, 'x')`, [wsA]),
      ),
    ).rejects.toThrow();
    await expect(
      as(ALICE, (tx) => tx.query(`update public.brand_styles set name = 'hacked'`)),
    ).rejects.toThrow();
    await expect(as(ALICE, (tx) => tx.query(`delete from public.brand_styles`))).rejects.toThrow();
  });

  it("browsers cannot write kit assets", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(
          `insert into public.brand_kit_assets (workspace_id, kind, text_content) values ($1, 'writing_sample', 'hi')`,
          [wsA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("browsers cannot call set_default_brand_style", async () => {
    await expect(
      as(ALICE, (tx) => tx.query(`select public.set_default_brand_style($1, null)`, [wsA])),
    ).rejects.toThrow();
  });
});

describe("brand kit — defaults", () => {
  it("allows at most one default per workspace", async () => {
    await expect(
      service(async (tx) => {
        await style(tx, wsA, "One", true);
        await style(tx, wsA, "Two", true);
      }),
    ).rejects.toThrow();
  });

  it("set_default_brand_style swaps the default atomically", async () => {
    const defaults = await service(async (tx) => {
      const one = await style(tx, wsA, "One", true);
      const two = await style(tx, wsA, "Two");
      await tx.query(`select public.set_default_brand_style($1, $2)`, [wsA, two]);
      const { rows } = await tx.query<{ id: string }>(
        `select id from public.brand_styles where workspace_id = $1 and is_default`,
        [wsA],
      );
      return { ids: rows.map((r) => r.id), one, two };
    });
    expect(defaults.ids).toEqual([defaults.two]);
  });

  it("refuses a style from another workspace", async () => {
    await expect(
      service(async (tx) => {
        const bobs = await style(tx, wsB, "Bob two");
        await tx.query(`select public.set_default_brand_style($1, $2)`, [wsA, bobs]);
      }),
    ).rejects.toThrow(/not found/);
  });

  it("an archived style cannot be the default", async () => {
    await expect(
      service((tx) =>
        tx.query(
          `insert into public.brand_styles (workspace_id, name, is_default, archived_at) values ($1, 'Old', true, now())`,
          [wsA],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("brand kit — storage paths", () => {
  it("accepts a path under the workspace's brand-kit prefix", async () => {
    await service((tx) =>
      tx.query(
        `insert into public.brand_kit_assets (workspace_id, kind, storage_path) values ($1, 'logo', $2)`,
        [wsA, `workspace/${wsA}/assets/brand-kit/abc/original.png`],
      ),
    );
  });

  it("refuses another workspace's prefix or path traversal", async () => {
    await expect(
      service((tx) =>
        tx.query(
          `insert into public.brand_kit_assets (workspace_id, kind, storage_path) values ($1, 'logo', $2)`,
          [wsA, `workspace/${wsB}/assets/brand-kit/abc/original.png`],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      service((tx) =>
        tx.query(
          `insert into public.brand_kit_assets (workspace_id, kind, storage_path) values ($1, 'logo', $2)`,
          [wsA, `workspace/${wsA}/assets/brand-kit/../../x.png`],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an unknown kind", async () => {
    await expect(
      service((tx) =>
        tx.query(
          `insert into public.brand_kit_assets (workspace_id, kind, text_content) values ($1, 'malware', 'x')`,
          [wsA],
        ),
      ),
    ).rejects.toThrow();
  });
});
