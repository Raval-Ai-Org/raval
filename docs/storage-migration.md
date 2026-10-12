# Supabase Storage to private R2

The migration copies workspace-owned objects from `generated-assets` to the existing
private `mellox-media` bucket. Supabase Auth and the application PostgreSQL data
remain in Supabase. Only storage metadata and references change.

New Studio uploads use the authenticated `/api/assets/upload` endpoint. It checks
workspace editor access, rate limits, container signatures, and a streaming 50 MB
request limit before using the existing idempotent asset persistence service.
Production persistence requires R2; a missing configuration returns an error.
Report logos also use R2. Generated Studio, carousel, Story, UGC, Canva and
background publishing flows share the existing storage service. Downloads use
short-lived signed attachment URLs and video seeking uses R2 byte-range responses.
User-uploaded bytes are preserved; generated-image attribution does not rewrite
customer uploads. Content and agency readers refresh metadata-only media paths.

## Operation

Use the existing R2 environment variables and `SUPABASE_DB_URL`,
`SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Credentials and signed URLs must
never be saved in migration logs. Run from the repository root:

```sh
npm run storage:migrate -- --dry-run
npm run storage:migrate -- --install-schema
npm run storage:migrate -- --copy
npm run storage:migrate -- --check-references
npm run storage:migrate -- --verify
# After the compatible application release is healthy:
npm run storage:migrate -- --activate
```

Dry-run inventories every bucket without writes. Unknown buckets, non-workspace
paths and orphaned workspaces are reported as ineligible; they require ownership
review rather than guessing a destination. The operator must investigate a
nonzero ineligible count before claiming completion.

The private PostgreSQL `media_storage_migrations` table tracks each deterministic
source/destination, workspace, byte count, SHA-256 checksum and checkpoint state.
An advisory lock prevents concurrent migration commands. Copy and verification
stream at most four objects concurrently through restricted local temporary files;
reference transactions run serially. Copy never overwrites an existing destination
unless its independently downloaded bytes match the source (matching objects are
reused without a write). Failed and interrupted copies can be resumed with the
same command. Temporary files are removed after each attempt.

Verification re-downloads both backends and compares complete SHA-256 hashes and
byte counts, checks a signed range request, and rejects public access. Activation
repeats these checks immediately before a transaction replaces exact string
references in all public text, JSON and JSONB columns. This covers nested jobs,
snapshots, thumbnail paths and metadata without overwriting unrelated edits.
`--check-references` executes the same database updates inside rolled-back
transactions to discover trigger or schema problems before cutover.

Old cached and in-flight paths are resolved through a service-role-only alias RPC.
Workspace validation precedes signing. Unmigrated paths retain Supabase reads.
Migration-source objects are excluded from application cleanup, including pending
copies and rolled-back migrations. Deleting a migrated R2 copy writes a tombstone
so a retry cannot resurrect it. Deleted workspaces are not copied or activated.
Repeat inventory and copy after deployment to catch uploads made during copying.
Migration tombstones cover both original and destination paths, including pending
copies. Retained Supabase originals become hidden from ordinary members after
activation or deletion, and checkpointed originals cannot be changed or removed
through member storage credentials. Operators can still verify and roll back them.
Production signing and cleanup fail closed if the retention RPCs are unavailable.

## Rollback and retention

```sh
npm run storage:migrate -- --rollback
```

Rollback checks the original source against its checkpoint before reversing
references atomically and disabling its active alias. It leaves both object copies
in place and preserves unrelated database changes. Tombstones are skipped.
For an application rollback, keep R2 credentials configured so newer assets remain
readable. Restore the last healthy deployment or revert the release commit.

**This migration has no source-deletion mode.** Never remove originals until a
separate independent verification and explicit owner approval. The legacy
brand-kit purge script is disabled while migration originals are retained.

Before release, run unit/contract and PostgreSQL migration tests, lint, typecheck,
secret scan, dependency audit and production build. Run the live R2 suite locally
and against the deployed base URL, including the new upload route. Inspect the
deployed health commit and the final manifest counts. Successful local tests do
not establish a successful Railway release.
