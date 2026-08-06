#!/usr/bin/env python3
"""
Apply migrations to new Supabase project using db query command
"""

import os
import sys
import glob
import subprocess

PROJECT_REF = "smdravaoaeqdajmnrlpr"

print("🔧 Applying Migrations via Supabase CLI")
print("=" * 60)
print(f"Project: {PROJECT_REF}")
print()

# Get all migration files
migration_files = sorted(glob.glob('supabase/migrations/*.sql'))

if not migration_files:
    print("❌ No migration files found")
    sys.exit(1)

print(f"Found {len(migration_files)} migration files")
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
     "SELECT COUNT(*) FROM pg_proc WHERE proname = 'set_persona_once_set'"],
    capture_output=True,
    text=True
)

if test_result.returncode == 0 and '1' in test_result.stdout:
    print("✅ Persona function EXISTS!")
else:
    print("⚠️  Persona function NOT found")
    print(test_result.stdout)

