#!/usr/bin/env node
// purge-brand-kit-files.mjs — remove the files Brand Styles left in storage.
//
// Brand Styles and the Brand Kit library are gone (ADR-0032): a brand has one
// look, saved on its Brand DNA. Their uploads (example posts and videos, logos,
// font files) lived in the `generated-assets` bucket under
//   workspace/<workspace id>/assets/brand-kit/<asset id>/…
// and nothing reads them any more. SQL cannot reach storage, so this operator
// tool removes them. Run it AFTER 20261012090000_drop_brand_styles.sql.
//
//   node scripts/purge-brand-kit-files.mjs              count only (dry run)
//   node scripts/purge-brand-kit-files.mjs --confirm    delete (cannot be undone)
//   … --env-file .env.production                        read another env file
//
// Only paths that contain /assets/brand-kit/ are ever listed or removed; every
// other file in the bucket (generated images, carousels, videos) is untouched.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "generated-assets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const envFile = args.includes("--env-file") ? args[args.indexOf("--env-file") + 1] : ".env";

function loadEnv(file) {
  if (!file || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv(envFile);
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or --env-file).");
  process.exit(1);
}

const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);

/** Every entry directly under a folder (files have an id; folders don't). */
async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Every file path under a folder, however deep. */
async function walk(prefix) {
  const files = [];
  for (const entry of await list(prefix)) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) files.push({ path, bytes: Number(entry.metadata?.size) || 0 });
    else files.push(...(await walk(path)));
  }
  return files;
}

async function main() {
  const workspaces = (await list("workspace")).filter((e) => !e.id && UUID.test(e.name));
  let total = 0;
  let bytes = 0;
  let removed = 0;
  for (const ws of workspaces) {
    const prefix = `workspace/${ws.name}/assets/brand-kit`;
    const files = (await walk(prefix)).filter((f) => f.path.includes("/assets/brand-kit/"));
    if (!files.length) continue;
    const size = files.reduce((n, f) => n + f.bytes, 0);
    total += files.length;
    bytes += size;
    console.log(`${ws.name}  ${files.length} files  ${(size / 1_048_576).toFixed(1)} MB`);
    if (!confirm) continue;
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100).map((f) => f.path);
      const { error } = await bucket.remove(batch);
      if (error) throw new Error(`remove under ${prefix}: ${error.message}`);
      removed += batch.length;
    }
  }
  console.log(
    `\n${total} Brand Kit files, ${(bytes / 1_048_576).toFixed(1)} MB, in ${workspaces.length} workspaces checked.`,
  );
  console.log(
    confirm ? `Removed ${removed}.` : "Dry run: nothing was removed. Add --confirm to delete them.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
