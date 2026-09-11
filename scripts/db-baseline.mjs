#!/usr/bin/env node
// db-baseline.mjs — prove the migration baseline builds the schema from an
// empty database, and (optionally) write it out as one consolidated file.
//
//   node scripts/db-baseline.mjs --verify   replay manifest on empty PGlite,
//                                           then re-apply every post-baseline
//                                           migration to prove idempotency
//   node scripts/db-baseline.mjs --write    also write supabase/baseline/schema.sql
//
// Exit 1 on any failure. Runs in CI (.github/workflows/ci.yml).
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  applyMigrations,
  createSupabaseDb,
  readMigration,
  resolveManifest,
} from "./db/pglite-supabase.mjs";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

// Migrations written from 2026-09-11 onward are required to be idempotent —
// safe to re-run against a database that already has them.
const IDEMPOTENT_FROM = "20260911000000";

async function main() {
  const names = resolveManifest();
  const db = await createSupabaseDb();
  const started = Date.now();
  await applyMigrations(db, names);
  console.log(`✓ ${names.length} migrations replayed on an empty database (${Date.now() - started} ms)`);

  const reapply = names.filter((n) => n >= IDEMPOTENT_FROM);
  await applyMigrations(db, reapply);
  console.log(`✓ ${reapply.length} post-${IDEMPOTENT_FROM} migrations are idempotent (re-applied cleanly)`);

  const { rows } = await db.query(
    `select c.relname as table, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1`,
  );
  const noRls = rows.filter((r) => !r.rls).map((r) => r.table);
  if (noRls.length) {
    throw new Error(`public tables without row-level security: ${noRls.join(", ")}`);
  }
  console.log(`✓ ${rows.length} public tables, all with row-level security enabled`);

  if (write) {
    const header = [
      "-- Mellox AI consolidated schema baseline — GENERATED, do not edit.",
      "-- Source: supabase/baseline/manifest.txt  ·  node scripts/db-baseline.mjs --write",
      "-- Bootstraps an EMPTY Supabase project (staging / disaster recovery).",
      "-- Requires the Supabase platform schemas (auth, storage, vault) and the",
      "-- pg_cron + pg_net extensions to be enabled first.",
      "",
    ].join("\n");
    const body = names
      .map((n) => `-- ═══ ${n} ═══\n${readMigration(n).trim()}\n`)
      .join("\n");
    const out = path.join(REPO_ROOT, "supabase", "baseline", "schema.sql");
    writeFileSync(out, `${header}\n${body}`, "utf8");
    console.log(`✓ wrote ${path.relative(REPO_ROOT, out)}`);
  }
  await db.close();
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
