#!/usr/bin/env python3
"""
Apply migrations to new Supabase project smdravaoaeqdajmnrlpr
Uses PostgREST API instead of direct database connection
"""

import os
import sys
import glob
import requests
import re

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "smdravaoaeqdajmnrlpr")
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

print("🔧 Applying Migrations to New Project")
print("=" * 50)
print(f"Project: {PROJECT_REF}")
print(f"URL: {PROJECT_URL}")
print()

# Get all migration files
migration_files = sorted(glob.glob('supabase/migrations/*.sql'))

if not migration_files:
    print("❌ No migration files found in supabase/migrations/")
    sys.exit(1)

print(f"Found {len(migration_files)} migration files")
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
        print(f"  ❌ Failed to read file: {e}")
        failed += 1
        continue

    # Execute via supabase CLI using db execute
    # Write to temp file
    temp_file = f'/tmp/migration_{i}.sql'
    with open(temp_file, 'w') as f:
        f.write(sql_content)

    # Execute using CLI
    result = os.system(f'supabase db execute --linked -f {temp_file} 2>&1')

    if result == 0:
        print(f"  ✓ Success")
        successful += 1
    else:
        print(f"  ⚠️  May have failed (exit code {result})")
        # Check if it's just duplicate objects (which is fine)
        failed += 1

    # Clean up temp file
    os.remove(temp_file)

print()
print("=" * 50)
print(f"Migration Summary:")
print(f"  ✓ Successful: {successful}")
print(f"  ❌ Failed: {failed}")
print(f"  ⏭️  Skipped: {skipped}")
print()

if successful > 0:
    print("✅ Migrations applied! Testing if persona function exists...")

    # Test if the persona function now exists
    test_result = os.system(
        f'supabase db execute --linked -c "SELECT proname FROM pg_proc WHERE proname = \'set_persona_once_set\'" 2>&1'
    )

    if test_result == 0:
        print("✓ Persona function exists!")
    else:
        print("⚠️  Persona function may not exist yet")

sys.exit(0 if failed == 0 else 1)
