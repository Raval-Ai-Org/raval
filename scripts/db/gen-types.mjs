#!/usr/bin/env node
// gen-types.mjs — regenerate src/integrations/supabase/types.ts from the
// migration baseline, without Docker or a live database.
//
//   node scripts/db/gen-types.mjs          (npm run db:types)
//
// Replays supabase/baseline/manifest.txt into PGlite, introspects the public
// schema (tables, columns, FKs, enums, functions) and writes the same shape
// `supabase gen types typescript` produces, so the typed clients always match
// the migrations in this repository. The helper types after `Database` are
// preserved verbatim from the existing file.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, createMigratedDb } from "./pglite-supabase.mjs";

const OUT = path.join(REPO_ROOT, "src", "integrations", "supabase", "types.ts");

const STRINGISH = new Set([
  "uuid", "text", "varchar", "bpchar", "char", "citext", "date", "timestamptz",
  "timestamp", "time", "timetz", "interval", "inet", "cidr", "bytea", "name",
]);
const NUMERIC = new Set(["int2", "int4", "int8", "float4", "float8", "numeric", "oid"]);

function tsType(udt, enums) {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1), enums)}[]`;
  if (STRINGISH.has(udt)) return "string";
  if (NUMERIC.has(udt)) return "number";
  if (udt === "bool") return "boolean";
  if (udt === "json" || udt === "jsonb") return "Json";
  if (enums.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  return "unknown";
}

const key = (name) => (/^[a-z_][a-z0-9_]*$/i.test(name) ? name : JSON.stringify(name));

async function main() {
  const db = await createMigratedDb();

  const { rows: enumRows } = await db.query(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname order by t.typname`);
  const enums = new Map(enumRows.map((r) => [r.name, r.labels]));

  const { rows: tables } = await db.query(`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`);

  const { rows: columns } = await db.query(`
    select table_name, column_name, udt_name, is_nullable = 'YES' as nullable,
           (column_default is not null or is_identity = 'YES') as has_default,
           is_generated = 'ALWAYS' as generated
      from information_schema.columns
     where table_schema = 'public' order by table_name, column_name`);

  const { rows: fks } = await db.query(`
    select con.conname as name, src.relname as table_name, dst.relname as ref_table,
           (select array_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
           (select array_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_columns,
           exists (select 1 from pg_constraint u where u.conrelid = con.conrelid and u.contype in ('p', 'u')
                    and (select array_agg(x order by x) from unnest(u.conkey) x)
                      = (select array_agg(x order by x) from unnest(con.conkey) x)) as one_to_one
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid join pg_namespace sn on sn.oid = src.relnamespace
      join pg_class dst on dst.oid = con.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
     where con.contype = 'f' and sn.nspname = 'public' and dn.nspname = 'public'
     order by src.relname, con.conname`);

  const { rows: fns } = await db.query(`
    select p.proname as name, p.proretset as setof, p.prokind,
           pg_get_function_result(p.oid) as result,
           t.typname as ret_type, t.typtype as ret_kind, rt.relname as ret_table,
           coalesce(p.proargnames, '{}') as arg_names,
           coalesce(p.proargmodes::text[], '{}') as arg_modes,
           (select array_agg(format_type(x, null)) from unnest(p.proallargtypes) x) as all_types,
           (select array_agg(tt.typname order by o) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality a(x, o)
              join pg_type tt on tt.oid = a.x) as arg_udts,
           p.pronargdefaults as n_defaults, p.pronargs as n_in
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
      left join pg_class rt on rt.oid = t.typrelid and t.typtype = 'c'
     where n.nspname = 'public' and p.prokind = 'f' and t.typname <> 'trigger'
       -- extension-owned functions (pgcrypto, uuid-ossp live in \`extensions\` on Supabase)
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by p.proname, p.oid`);

  const lines = [];
  const push = (s) => lines.push(s);

  push("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  push("");
  push("// GENERATED by scripts/db/gen-types.mjs from the migration baseline — do not edit by hand.");
  push("// Regenerate with: npm run db:types");
  push("export type Database = {");
  push("  __InternalSupabase: {");
  push('    PostgrestVersion: "14.5";');
  push("  };");
  push("  public: {");
  push("    Tables: {");
  for (const { name } of tables) {
    const cols = columns.filter((c) => c.table_name === name);
    push(`      ${key(name)}: {`);
    push("        Row: {");
    for (const c of cols) {
      push(`          ${key(c.column_name)}: ${tsType(c.udt_name, enums)}${c.nullable ? " | null" : ""};`);
    }
    push("        };");
    push("        Insert: {");
    for (const c of cols) {
      const t = tsType(c.udt_name, enums) + (c.nullable ? " | null" : "");
      if (c.generated) push(`          ${key(c.column_name)}?: never;`);
      else push(`          ${key(c.column_name)}${c.nullable || c.has_default ? "?" : ""}: ${t};`);
    }
    push("        };");
    push("        Update: {");
    for (const c of cols) {
      const t = tsType(c.udt_name, enums) + (c.nullable ? " | null" : "");
      push(`          ${key(c.column_name)}?: ${c.generated ? "never" : t};`);
    }
    push("        };");
    const rels = fks.filter((f) => f.table_name === name);
    if (rels.length === 0) {
      push("        Relationships: [];");
    } else {
      push("        Relationships: [");
      for (const f of rels) {
        push("          {");
        push(`            foreignKeyName: ${JSON.stringify(f.name)};`);
        push(`            columns: ${JSON.stringify(f.columns)};`);
        push(`            isOneToOne: ${f.one_to_one};`);
        push(`            referencedRelation: ${JSON.stringify(f.ref_table)};`);
        push(`            referencedColumns: ${JSON.stringify(f.ref_columns)};`);
        push("          },");
      }
      push("        ];");
    }
    push("      };");
  }
  push("    };");
  push("    Views: {");
  push("      [_ in never]: never;");
  push("    };");
  push("    Functions: {");
  const seen = new Set();
  for (const f of fns) {
    if (seen.has(f.name)) continue; // first overload wins
    seen.add(f.name);
    const names = f.arg_names;
    const modes = f.arg_modes.length ? f.arg_modes : names.map(() => "i");
    const udts = f.arg_udts ?? [];
    const inArgs = [];
    const outCols = [];
    names.forEach((n, i) => {
      const mode = modes[i] ?? "i";
      const t = tsType(udts[i] ?? "unknown", enums);
      if (mode === "i" || mode === "b") inArgs.push({ n, t });
      if (mode === "t" || mode === "o" || mode === "b") outCols.push({ n, t });
    });
    const firstDefault = inArgs.length - f.n_defaults;
    const args = inArgs.length
      ? `{ ${inArgs.map((a, i) => `${key(a.n)}${i >= firstDefault ? "?" : ""}: ${a.t}`).join("; ")} }`
      : "never";
    let returns;
    if (outCols.length) returns = `{ ${outCols.map((c) => `${key(c.n)}: ${c.t}`).join("; ")} }[]`;
    else if (f.ret_kind === "c" && f.ret_table)
      returns = `Database["public"]["Tables"][${JSON.stringify(f.ret_table)}]["Row"]${f.setof ? "[]" : ""}`;
    else if (f.ret_type === "void") returns = "undefined";
    else returns = tsType(f.ret_type, enums) + (f.setof ? "[]" : "");
    push(`      ${key(f.name)}: { Args: ${args}; Returns: ${returns} };`);
  }
  push("    };");
  push("    Enums: {");
  for (const [name, labels] of enums) push(`      ${key(name)}: ${labels.map((l) => JSON.stringify(l)).join(" | ")};`);
  push("    };");
  push("    CompositeTypes: {");
  push("      [_ in never]: never;");
  push("    };");
  push("  };");
  push("};");
  push("");

  // Keep the generic helper types (Tables<>, TablesInsert<>, …) from the existing file.
  const existing = readFileSync(OUT, "utf8");
  const helperStart = existing.indexOf("type DatabaseWithoutInternals");
  const constantsStart = existing.indexOf("export const Constants");
  if (helperStart < 0 || constantsStart < 0) throw new Error("types.ts helper section not found");
  lines.push(existing.slice(helperStart, constantsStart).trimEnd());
  lines.push("");
  lines.push("export const Constants = {");
  lines.push("  public: {");
  lines.push("    Enums: {");
  for (const [name, labels] of enums) lines.push(`      ${key(name)}: ${JSON.stringify(labels)},`);
  lines.push("    },");
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");

  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`✓ wrote ${path.relative(REPO_ROOT, OUT)} (${tables.length} tables, ${seen.size} functions, ${enums.size} enums)`);
  await db.close();
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
