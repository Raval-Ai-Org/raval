// pglite-supabase.mjs — replay Supabase migrations inside PGlite (in-process
// WASM Postgres). Used by scripts/db-baseline.mjs (baseline build/verify) and by
// the vitest tenant-isolation and schema suites under tests/db.
//
// The live project was bootstrapped from a curated "final-state" set rather
// than the full history (the early Lovable-era files re-CREATE the same tables
// with no DROP in between and cannot replay). supabase/baseline/manifest.txt is
// that curated set; every migration newer than its last entry is included
// automatically, exactly like apply_migrations_cli.py does.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const MANIFEST_PATH = path.join(REPO_ROOT, "supabase", "baseline", "manifest.txt");

/** Extensions PGlite cannot load; the stubs provide their schema surface. */
const UNAVAILABLE_EXTENSIONS = /CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?"?(pg_cron|pg_net|supabase_vault|pg_graphql|pg_stat_statements)"?[^;]*;/gi;

export function preprocessMigration(sql) {
  return sql.replace(UNAVAILABLE_EXTENSIONS, "-- [pglite] extension provided by stubs\n");
}

/** Ordered list of migration filenames that build the schema from empty. */
export function resolveManifest() {
  const listed = readFileSync(MANIFEST_PATH, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const excluded = new Set(
    listed.filter((l) => l.startsWith("!")).map((l) => l.slice(1).trim()),
  );
  const included = listed.filter((l) => !l.startsWith("!"));
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const name of included) {
    if (!all.includes(name)) throw new Error(`manifest lists a missing migration: ${name}`);
  }
  const last = included[included.length - 1];
  const newer = all.filter((f) => f > last && !excluded.has(f) && !included.includes(f));
  return [...included, ...newer];
}

export async function createSupabaseDb() {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";");
  await db.exec(readFileSync(path.join(here, "supabase-stubs.sql"), "utf8"));
  return db;
}

export function readMigration(name) {
  return preprocessMigration(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
}

/**
 * Apply migrations in order. Throws an Error naming the failing file.
 * @param {PGlite} db
 * @param {string[]} names
 */
export async function applyMigrations(db, names, { onApplied } = {}) {
  for (const name of names) {
    try {
      await db.exec(readMigration(name));
      onApplied?.(name);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`migration ${name} failed: ${msg}`);
    }
  }
}

/** A fresh database with the full baseline applied. */
export async function createMigratedDb() {
  const db = await createSupabaseDb();
  await applyMigrations(db, resolveManifest());
  return db;
}
