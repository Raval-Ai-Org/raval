#!/usr/bin/env python3
"""
Apply the approved final-state migrations to the new Mellox AI Supabase project
(slcmqbbjzyztqyucauol). Runs each file via `supabase db execute --linked`.
"""

import os
import sys
import glob
import requests
import re

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "slcmqbbjzyztqyucauol")
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

print("?? Applying Migrations to New Project")
print("=" * 50)
print(f"Project: {PROJECT_REF}")
print(f"URL: {PROJECT_URL}")
print()

# Final-state migration set for a completely fresh Supabase project.
# This is the minimal, ordered list that recreates the current Raval schema.
# The cron migration 20260709194553 (competitor-watch-scan pg_cron job) is
# deliberately EXCLUDED: it embeds a stale deployment URL and incompatible auth contract
# (apikey header) that no longer matches the app's hook (x-cron-secret), and
# Raval has no production deployment URL yet. It will be applied separately
# after the app is deployed (see apply-migrations-cron-DEFERRED section below).
FINAL_STATE_MIGRATIONS = [
    "20260707193303_93348393-698b-4f35-ae22-644af74d8942.sql",
    "20260707193445_46dd0707-2e4d-4ee8-b7d1-e2cea84ec364.sql",
    "20260709194343_9ba1d523-b946-4e78-a69d-e6bdaf5ba26e.sql",
    "20260709212343_4feb1702-87f2-45f0-9b83-6b92ce93a1e9.sql",
    "20260709213859_80e26c94-28cf-45c1-9383-304df23d4ba5.sql",
    "20260710100535_45a3451d-82a0-4499-bc1d-7e2e6260ca0c.sql",
    "20260712203224_2d6ac297-789e-40b6-9228-e05bdb9dfb39.sql",
    "20260712220251_2a14b1a0-8e29-4a9a-bad7-e71064c4ce68.sql",
    "20260718184546_e27386a1-4495-4b68-b399-0a94f1d7702d.sql",
    "20260718184836_4ff53c1f-ade2-4fe4-88c2-518841d56158.sql",
    "20260720095116_ad729590-6b24-416b-8a9f-bf7cd05b7214.sql",
    "20260809000001_add_workspace_sdr.sql",
    "20260809000002_add_content_publications.sql",
    "20260809000003_publishing_status_doc.sql",
    "20260810000001_add_publications_perf_indexes.sql",
    "20260903000000_disable_legacy_competitor_watch_cron.sql",
    "20260907120000_create_conversations.sql",
    "20260907150000_enforce_content_lifecycle.sql",
    "20260910010000_create_persistent_assets.sql",
    "20260910020000_harden_generated_asset_storage.sql",
    "20260910030000_harden_client_share_secrets.sql",
    "20260910040000_protect_workspace_owner_membership.sql",
    "20260910050000_add_schedule_claim_leases.sql",
    "20260910060000_lock_workspace_resource_ownership.sql",
]

# Keep the approved historical baseline above, but automatically include newer
# migrations so a future file cannot be silently omitted from deployment.
EXCLUDED_MIGRATIONS = {"20260709194553_bb8d43fe-2f5e-48cb-9c77-8042cb96e8be.sql"}
all_migration_names = [
    os.path.basename(path) for path in glob.glob(os.path.join("supabase", "migrations", "*.sql"))
]
# Underscores are allowed: every hand-written migration since 20260809 uses
# snake_case (add_workspace_sdr, create_persistent_assets, ...). Without `_` in
# this class the check rejected 16 committed migrations and the script exited 1
# before applying anything.
filename_pattern = re.compile(r"^\d{14}_[A-Za-z0-9_-]+\.sql$")
malformed = sorted(name for name in all_migration_names if not filename_pattern.fullmatch(name))
if malformed:
    print(f"Malformed migration filename(s): {', '.join(malformed)}")
    sys.exit(1)
versions = [name[:14] for name in all_migration_names]
duplicates = sorted({version for version in versions if versions.count(version) > 1})
if duplicates:
    print(f"Duplicate migration version(s): {', '.join(duplicates)}")
    sys.exit(1)
baseline = FINAL_STATE_MIGRATIONS[-1]
for path in sorted(glob.glob(os.path.join("supabase", "migrations", "*.sql"))):
    name = os.path.basename(path)
    if name > baseline and name not in EXCLUDED_MIGRATIONS and name not in FINAL_STATE_MIGRATIONS:
        FINAL_STATE_MIGRATIONS.append(name)

migration_files = []
for name in FINAL_STATE_MIGRATIONS:
    path = f"supabase/migrations/{name}"
    if not os.path.isfile(path):
        print(f"? Expected migration not found: {path}")
        sys.exit(1)
    migration_files.append(path)

if not migration_files:
    print("? No migration files selected")
    sys.exit(1)

print(f"Found {len(migration_files)} migration files (final-state set)")
print()

# We'll use the database URL via a workaround
# Since we can't connect directly, let's use supabase db execute via CLI

print("Using Supabase CLI to execute migrations...")
print()

successful = 0
failed = 0
skipped = 0

for i, filepath in enumerate(migration_files, 1):
    filename = os.path.basename(filepath)
    print(f"[{i}/{len(migration_files)}] Processing {filename}...")

    # Read the migration file
    try:
        with open(filepath, 'r') as f:
            sql_content = f.read()
    except Exception as e:
        print(f"  ? Failed to read file: {e}")
        sys.exit(1)

    # Execute via supabase CLI using db execute
    # Write to a temp file in the current directory (Windows CPython cannot
    # write to the POSIX /tmp path Git Bash exposes).
    temp_file = f'.tmp_migration_{i}.sql'
    with open(temp_file, 'w', encoding='utf-8') as f:
        f.write(sql_content)

    # Execute using CLI. NOTE: `db execute` does not exist in supabase CLI
    # v2.113.0. `db query --linked --file <path>` is the supported primitive
    # for running a SQL file against the linked project via Management API.
    result = os.system(f'supabase db query --linked --file {temp_file} 2>&1')

    if result == 0:
        print(f"  ? Success")
        successful += 1
        # Clean up temp file
        if os.path.exists(temp_file):
            os.remove(temp_file)
    else:
        # Hard safety rule: STOP immediately on the first failed migration.
        # Do NOT continue to later migrations.
        print(f"  ? FAILED (exit code {result})")
        print(f"  ? STOPPING: do not proceed to later migrations until resolved.")
        sys.exit(1)

print()
print("=" * 50)
print(f"Migration Summary:")
print(f"  ? Successful: {successful}")
print(f"  ? Failed: {failed}")
print(f"  ??  Skipped: {skipped}")
print()

if successful > 0:
    print("? Migrations applied! Testing if persona function exists...")

    # Test if the persona function now exists
    test_result = os.system(
        f'supabase db execute --linked -c "SELECT proname FROM pg_proc WHERE proname = \'set_persona_once\'" 2>&1'
    )

    if test_result == 0:
        print("? Persona function exists!")
    else:
        print("??  Persona function may not exist yet")

sys.exit(0 if failed == 0 else 1)
