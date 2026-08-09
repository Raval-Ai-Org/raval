#!/usr/bin/env python3
"""
Apply migrations to new Supabase project using db query command
"""

import os
import sys
import glob
import subprocess

PROJECT_REF = "slcmqbbjzyztqyucauol"

print("🔧 Applying Migrations via Supabase CLI")
print("=" * 60)
print(f"Project: {PROJECT_REF}")
print()

# Final-state migration set for a completely fresh Supabase project.
# The cron migration 20260709194553 (competitor-watch-scan pg_cron job) is
# deliberately EXCLUDED: stale Lovable URL + incompatible auth contract, and
# no production deployment URL exists yet. It will be applied separately
# after the app is deployed.
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
]

migration_files = []
for name in FINAL_STATE_MIGRATIONS:
    path = os.path.join('supabase', 'migrations', name)
    if not os.path.isfile(path):
        print(f"❌ Expected migration not found: {path}")
        sys.exit(1)
    migration_files.append(path)

if not migration_files:
    print("❌ No migration files found")
    sys.exit(1)

print(f"Found {len(migration_files)} migration files (final-state set)")
print()

successful = 0
errors = []

for i, filepath in enumerate(migration_files, 1):
    filename = os.path.basename(filepath)
    print(f"[{i}/{len(migration_files)}] {filename[:60]}...")

    # Read the SQL file
    with open(filepath, 'r') as f:
        sql = f.read()

    # Execute using db query
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', '--file', filepath],
        capture_output=True,
        text=True
    )

    if result.returncode == 0 or 'already exists' in result.stderr.lower():
        print(f"  ✓ Applied")
        successful += 1
    else:
        error_msg = result.stderr[:100] if result.stderr else "Unknown error"
        print(f"  ⚠️  {error_msg}")
        errors.append(f"{filename}: {error_msg}")

print()
print("=" * 60)
print(f"✓ Successfully applied: {successful}/{len(migration_files)}")

if errors:
    print(f"⚠️  Errors: {len(errors)}")
    print("\nFirst few errors:")
    for err in errors[:5]:
        print(f"  - {err}")

print()
print("Testing if persona function exists...")
test_result = subprocess.run(
    ['supabase', 'db', 'query', '--linked', '-c',
     "SELECT COUNT(*) FROM pg_proc WHERE proname = 'set_persona_once'"],
    capture_output=True,
    text=True
)

if test_result.returncode == 0 and '1' in test_result.stdout:
    print("✅ Persona function EXISTS!")
else:
    print("⚠️  Persona function NOT found")
    print(test_result.stdout)

