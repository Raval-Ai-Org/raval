// Canonical workspace architecture, proven against the real migrations
// (PGlite, RLS exercised the way PostgREST does it):
//   - one brand domain = one workspace per owner (normalized, race-proof)
//   - idempotent creation (retries / double clicks / multiple tabs)
//   - existing duplicates are flagged, never merged or deleted
//   - server-managed workspace columns, server-only creation
//   - Brand DNA and the workspace overview are strictly per workspace
//   - deleting Brand A removes only Brand A
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb, applyMigrations } from "../../scripts/db/pglite-supabase.mjs";
import { normalizeDomain } from "@/lib/workspace/domain";

const ALICE = "a1111111-1111-4111-8111-111111111111"; // owns Brand A (Mellox AI) and Brand B
const BOB = "b2222222-2222-4222-8222-222222222222"; // unrelated tenant
const EDDIE = "e5555555-5555-4555-8555-555555555555"; // editor in Brand A only

type Tx = { query: PGlite["query"] };
let db: PGlite;

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

async function create(user: string, name: string, url: string | null, key: string | null) {
  const { rows } = await db.query<{ workspace_id: string; created: boolean }>(
    `select * from private.create_workspace_for_user($1, $2, $3, $4)`,
    [user, name, url, key],
  );
  return rows[0];
}

let brandA: string;
let brandB: string;

beforeAll(async () => {
  db = await createMigratedDb();
  for (const [id, email] of [
    [ALICE, "alice@example.com"],
    [BOB, "bob@example.com"],
    [EDDIE, "eddie@example.com"],
  ]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  }
  brandA = (await create(ALICE, "Mellox AI", "https://mellox.ai", "k-a")).workspace_id;
  brandB = (await create(ALICE, "Northwind Coffee", "https://northwindcoffee.com", "k-b"))
    .workspace_id;
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'editor')`,
    [brandA, EDDIE],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("domain normalization", () => {
  const cases = [
    "https://www.Mellox.ai/",
    "http://mellox.ai",
    "mellox.ai",
    "MELLOX.AI/pricing?x=1#top",
    "https://user:pw@www.mellox.ai:8443/a",
    "  https://mellox.ai.  ",
    "",
    "https://shop.mellox.ai",
  ];
  it.each(cases)("SQL and TypeScript agree on %j", async (input) => {
    const { rows } = await db.query<{ d: string | null }>(
      `select private.normalize_domain($1) as d`,
      [input],
    );
    expect(rows[0].d).toBe(normalizeDomain(input));
  });

  it("strips scheme, www, case, port, path and trailing dot", () => {
    expect(normalizeDomain("https://www.Mellox.AI:443/x/")).toBe("mellox.ai");
    expect(normalizeDomain("https://shop.mellox.ai")).toBe("shop.mellox.ai");
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("duplicate prevention", () => {
  it("the same website in any spelling returns the existing workspace", async () => {
    for (const url of ["mellox.ai", "https://www.MELLOX.ai/", "http://mellox.ai/about"]) {
      const r = await create(ALICE, "Mellox again", url, null);
      expect(r).toEqual({ workspace_id: brandA, created: false });
    }
    const { rows } = await db.query(
      `select count(*)::int as n from public.workspaces where owner_id = $1 and domain = 'mellox.ai'`,
      [ALICE],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("replaying an idempotency key (retry, double click, refresh) returns the same workspace", async () => {
    const first = await create(ALICE, "No site brand", null, "retry-key");
    const again = await create(ALICE, "No site brand", null, "retry-key");
    expect(first.created).toBe(true);
    expect(again).toEqual({ workspace_id: first.workspace_id, created: false });
  });

  it("a different owner can have their own workspace for the same domain", async () => {
    const r = await create(BOB, "Bob's Mellox reseller", "mellox.ai", null);
    expect(r.created).toBe(true);
    expect(r.workspace_id).not.toBe(brandA);
  });

  it("the unique index stops a racing insert that bypassed the function", async () => {
    await expect(
      db.query(`insert into public.workspaces (owner_id, name, website_url) values ($1, 'x', $2)`, [
        ALICE,
        "https://www.mellox.ai",
      ]),
    ).rejects.toThrow(/workspaces_owner_domain_unique|duplicate key/i);
  });

  it("changing a website to a domain the owner already has is refused", async () => {
    await expect(
      db.query(`update public.workspaces set website_url = 'https://mellox.ai' where id = $1`, [
        brandB,
      ]),
    ).rejects.toThrow(/duplicate key|workspaces_owner_domain_unique/i);
  });

  it("the browser can no longer insert workspaces directly", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(`insert into public.workspaces (owner_id, name) values ($1, 'direct')`, [ALICE]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("the create function is service-role only", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(`select * from public.create_workspace_for_user($1, 'x', null, null)`, [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("existing duplicates", () => {
  it("are flagged against the most active copy and never deleted", async () => {
    const fresh: PGlite = await createMigratedDb();
    try {
      await fresh.query(`insert into auth.users (id, email) values ($1, 'c@example.com')`, [BOB]);
      // Simulate pre-migration data: drop the index/guard effects by inserting
      // before re-running the migration.
      await fresh.exec(`drop index if exists public.workspaces_owner_domain_unique`);
      const ids: string[] = [];
      for (const [name, onboarded] of [
        ["Raval 1", false],
        ["Raval 2", true],
        ["Raval 3", false],
      ] as const) {
        const { rows } = await fresh.query<{ id: string }>(
          `insert into public.workspaces (owner_id, name, website_url, onboarded_at)
           values ($1, $2, 'https://raval.it.com', $3) returning id`,
          [BOB, name, onboarded ? new Date().toISOString() : null],
        );
        ids.push(rows[0].id);
      }
      // The third copy has real activity: a chat.
      await fresh.query(`insert into public.conversations (workspace_id) values ($1)`, [ids[2]]);

      await applyMigrations(fresh, ["20260920090000_canonical_workspaces.sql"]);

      const { rows } = await fresh.query<{ id: string; duplicate_of: string | null }>(
        `select id, duplicate_of from public.workspaces where owner_id = $1 order by name`,
        [BOB],
      );
      expect(rows).toHaveLength(3);
      const canonical = rows.filter((r) => r.duplicate_of === null);
      expect(canonical.map((r) => r.id)).toEqual([ids[2]]);
      expect(rows.filter((r) => r.duplicate_of === ids[2])).toHaveLength(2);
      // New creates for that domain return the canonical copy.
      const { rows: again } = await fresh.query(
        `select * from private.create_workspace_for_user($1, 'Raval', 'raval.it.com', null)`,
        [BOB],
      );
      expect(again[0]).toEqual({ workspace_id: ids[2], created: false });
    } finally {
      await fresh.close();
    }
  }, 120_000);
});

describe("server-managed columns", () => {
  it.each([
    ["plan", `update public.workspaces set plan = 'enterprise' where id = $1`],
    ["owner_id", `update public.workspaces set owner_id = '${BOB}' where id = $1`],
    ["duplicate_of", `update public.workspaces set duplicate_of = id where id = $1`],
  ])("an owner cannot change %s from the browser", async (_col, sql) => {
    await expect(as(ALICE, (tx) => tx.query(sql, [brandA]))).rejects.toThrow(
      /server-managed|permission denied/i,
    );
  });

  it("an owner can still rename their workspace", async () => {
    await as(ALICE, async (tx) => {
      const r = await tx.query(`update public.workspaces set name = 'Mellox' where id = $1`, [
        brandA,
      ]);
      expect(r.affectedRows).toBe(1);
    });
  });
});

describe("Brand DNA isolation", () => {
  beforeAll(async () => {
    await db.query(
      `insert into public.workspace_brand_dna (workspace_id, dna) values ($1, $2), ($3, $4)`,
      [
        brandA,
        JSON.stringify({ brandName: "Mellox AI", voice: "precise" }),
        brandB,
        JSON.stringify({ brandName: "Northwind Coffee", voice: "cosy" }),
      ],
    );
  });

  it("an editor of Brand A reads only Brand A's DNA", async () => {
    const rows = await as(EDDIE, (tx) =>
      tx.query<{ workspace_id: string }>(`select workspace_id from public.workspace_brand_dna`),
    );
    expect(rows.rows.map((r) => r.workspace_id)).toEqual([brandA]);
  });

  it("another tenant reads none", async () => {
    const rows = await as(BOB, (tx) => tx.query(`select 1 from public.workspace_brand_dna`));
    expect(rows.rows).toHaveLength(0);
  });

  it("the browser cannot write Brand DNA directly (server checks the role first)", async () => {
    await expect(
      as(ALICE, (tx) =>
        tx.query(`update public.workspace_brand_dna set dna = '{}' where workspace_id = $1`, [
          brandB,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("workspace overview (Projects / Command Center)", () => {
  beforeAll(async () => {
    await db.query(
      `insert into public.content_items (workspace_id, title, status) values
         ($1, 'a-draft', 'draft'), ($1, 'a-draft-2', 'draft'), ($2, 'b-draft', 'draft')`,
      [brandA, brandB],
    );
  });

  it("returns only the caller's workspaces, each with its own counts", async () => {
    const { rows } = await as(ALICE, (tx) =>
      tx.query<{ id: string; draft_count: number; role: string; domain: string }>(
        `select id, draft_count::int, role, domain from public.workspace_overview()`,
      ),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(brandA)).toMatchObject({ draft_count: 2, role: "owner", domain: "mellox.ai" });
    expect(byId.get(brandB)).toMatchObject({
      draft_count: 1,
      role: "owner",
      domain: "northwindcoffee.com",
    });
    expect(rows.every((r) => byId.has(r.id))).toBe(true);
  });

  it("an editor of Brand A sees Brand A only — never Brand B's numbers", async () => {
    const { rows } = await as(EDDIE, (tx) =>
      tx.query<{ id: string; role: string }>(`select id, role from public.workspace_overview()`),
    );
    expect(rows).toEqual([{ id: brandA, role: "editor" }]);
  });
});

describe("deletion", () => {
  it("deleting Brand A cascades Brand A's data and leaves Brand B untouched", async () => {
    const victim = (await create(ALICE, "Temp brand", "temp-brand.example", null)).workspace_id;
    await db.query(`insert into public.content_items (workspace_id, title) values ($1, 't')`, [
      victim,
    ]);
    await db.query(`insert into public.workspace_brand_dna (workspace_id) values ($1)`, [victim]);
    const before = await db.query<{ n: number }>(
      `select count(*)::int as n from public.content_items where workspace_id = $1`,
      [brandB],
    );

    await db.query(`delete from public.workspaces where id = $1`, [victim]);

    for (const table of ["content_items", "workspace_brand_dna", "workspace_members"]) {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where workspace_id = $1`,
        [victim],
      );
      expect(rows[0].n).toBe(0);
    }
    const after = await db.query<{ n: number }>(
      `select count(*)::int as n from public.content_items where workspace_id = $1`,
      [brandB],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const user = await db.query(`select 1 from auth.users where id = $1`, [ALICE]);
    expect(user.rows).toHaveLength(1);
  });

  it("an editor cannot delete the workspace", async () => {
    await as(EDDIE, async (tx) => {
      const r = await tx.query(`delete from public.workspaces where id = $1`, [brandA]);
      expect(r.affectedRows ?? 0).toBe(0);
    });
  });
});
