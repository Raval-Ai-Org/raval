// Multi-tenant isolation guard, against the real migration baseline in PGlite.
// Every table that holds a workspace's rows must have row-level security on,
// must be closed to the anonymous role, and must not let a signed-in user
// read or write rows with an always-true policy. A new table that forgets any
// of these fails here, before it can leak one customer's data to another.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error — plain .mjs helper shared with scripts/db-baseline.mjs
import { createMigratedDb } from "../../scripts/db/pglite-supabase.mjs";

let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDb();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

// Tables that carry a workspace_id on purpose but are public or shared by
// design. Keep this list short and give every entry a reason.
const NOT_TENANT_DATA = new Set<string>([]);

async function tenantTables(): Promise<string[]> {
  const { rows } = await db.query<{ t: string }>(
    `select c.relname as t
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
        and a.attname = 'workspace_id' and not a.attisdropped
      order by 1`,
  );
  return rows.map((r) => r.t).filter((t) => !NOT_TENANT_DATA.has(t));
}

describe("tenant isolation (every table with a workspace_id)", () => {
  it("finds the tenant tables", async () => {
    expect((await tenantTables()).length).toBeGreaterThan(50);
  });

  it("has row-level security switched on", async () => {
    const tables = await tenantTables();
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1) and not c.relrowsecurity`,
      [tables],
    );
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it("gives the anonymous role no access at all", async () => {
    const tables = await tenantTables();
    const exposed: string[] = [];
    for (const t of tables) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select (has_table_privilege('anon', format('public.%I', $1::text), 'select')
              or has_table_privilege('anon', format('public.%I', $1::text), 'insert')
              or has_table_privilege('anon', format('public.%I', $1::text), 'update')
              or has_table_privilege('anon', format('public.%I', $1::text), 'delete')) as ok`,
        [t],
      );
      if (rows[0]?.ok) exposed.push(t);
    }
    expect(exposed).toEqual([]);
  });

  it("only lets a policy for anon or PUBLIC act on the caller's own identity", async () => {
    const tables = await tenantTables();
    // Own-identity checks (auth.uid(), a membership helper) or an outright deny.
    const SAFE = String.raw`(auth\.uid\(\)|is_workspace_member|^\(?false\)?$)`;
    const { rows } = await db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and tablename = any($1)
          and roles && array['anon','public']::name[]
          and not (coalesce(qual, with_check) ~* $2 and coalesce(with_check, qual) ~* $2)`,
      [tables, SAFE],
    );
    expect(rows).toEqual([]);
  });

  it("has no always-true policy for signed-in users", async () => {
    const tables = await tenantTables();
    const { rows } = await db.query<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = any($1)
          and roles && array['authenticated']::name[]
          and (coalesce(trim(qual), '') in ('true', '(true)')
            or coalesce(trim(with_check), '') in ('true', '(true)'))`,
      [tables],
    );
    expect(rows).toEqual([]);
  });
});
