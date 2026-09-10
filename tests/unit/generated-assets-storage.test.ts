import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  path.join(root, "supabase/migrations/20260910020000_harden_generated_asset_storage.sql"),
  "utf8",
);
const persistRoute = readFileSync(path.join(root, "src/app/api/assets/persist/route.ts"), "utf8");
const libraryRoute = readFileSync(path.join(root, "src/app/api/assets/library/route.ts"), "utf8");
const shareMigration = readFileSync(
  path.join(root, "supabase/migrations/20260910030000_harden_client_share_secrets.sql"),
  "utf8",
);
const ownerMigration = readFileSync(
  path.join(root, "supabase/migrations/20260910040000_protect_workspace_owner_membership.sql"),
  "utf8",
);
const cliRunner = readFileSync(path.join(root, "apply_migrations_cli.py"), "utf8");
const cliRunnerViaCli = readFileSync(path.join(root, "apply_migrations_via_cli.py"), "utf8");
const scheduleMigration = readFileSync(
  path.join(root, "supabase/migrations/20260910050000_add_schedule_claim_leases.sql"),
  "utf8",
);
const scheduleRunner = readFileSync(path.join(root, "src/lib/schedules.server.ts"), "utf8");
const ownershipMigration = readFileSync(
  path.join(root, "supabase/migrations/20260910060000_lock_workspace_resource_ownership.sql"),
  "utf8",
);
const contentFn = readFileSync(path.join(root, "src/server/fns/content.ts"), "utf8");
const sdrHandlers = readFileSync(path.join(root, "src/lib/sdr.handlers.ts"), "utf8");

describe("generated asset storage security posture", () => {
  it("makes generated assets private and authorizes parsed workspace paths", () => {
    expect(migration).toMatch(/set public = false/i);
    expect(migration).toMatch(/private\.storage_workspace_id\(name\)/i);
    expect(migration).toMatch(/private\.is_workspace_member\(/i);
    expect(migration).not.toMatch(/getpublicurl/i);
  });

  it("uses signed URLs in both persistence and library responses", () => {
    expect(persistRoute).toMatch(/createSignedUrl\(/);
    expect(persistRoute).not.toMatch(/getPublicUrl\(/);
    expect(libraryRoute).toMatch(/createSignedUrls\(/);
    expect(libraryRoute).not.toMatch(/getPublicUrl\(/);
    expect(libraryRoute).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(libraryRoute).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(persistRoute).toMatch(/media_url: null/);
    expect(persistRoute).toMatch(/asset_storage_path: path/);
    expect(contentFn).toMatch(/createSignedUrls\(paths, 3600\)/);
    expect(sdrHandlers).toMatch(/resolveMediaUrl/);
  });

  it("keeps share token and password hashes out of anonymous PostgREST", () => {
    expect(shareMigration).toMatch(/revoke all on table public\.client_shares from anon/i);
    expect(shareMigration).toMatch(/drop policy if exists [^;]*shares_select_public/i);
  });

  it("prevents deleting the final workspace owner membership", () => {
    expect(ownerMigration).toMatch(/role <> 'owner'::public\.app_role/i);
    expect(ownerMigration).toMatch(/drop policy if exists members_delete_by_owner_or_self/i);
  });

  it("discovers migrations added after the approved baseline", () => {
    expect(cliRunner).toMatch(/glob\.glob\(/);
    expect(cliRunner).toMatch(/EXCLUDED_MIGRATIONS/);
    expect(cliRunner).toMatch(/Malformed migration filename/);
    expect(cliRunner).toMatch(/Duplicate migration version/);
    expect(cliRunnerViaCli).toMatch(/STOPPING: resolve this migration/);
  });

  it("keeps the live scheduler compatible with scheduled_jobs", () => {
    expect(scheduleMigration).toMatch(/locked_at timestamptz/i);
    expect(scheduleMigration).toMatch(/scheduled_jobs_claim_idx/i);
    expect(scheduleRunner).not.toMatch(/locked_at/);
    expect(scheduleRunner).not.toMatch(/locked_by/);
    expect(scheduleRunner).toMatch(/\.neq\("task_type", "market-brain"\)/);
  });

  it("prevents authenticated resource ownership spoofing", () => {
    expect(ownershipMigration).toMatch(/prevent_workspace_resource_reassignment/);
    expect(ownershipMigration).toMatch(/NEW\.workspace_id IS DISTINCT FROM OLD\.workspace_id/);
    expect(ownershipMigration).toMatch(/created_by IS NULL OR created_by = auth\.uid\(\)/);
  });
});
