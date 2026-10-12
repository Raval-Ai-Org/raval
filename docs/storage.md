# Media storage

Generated media is stored through `src/server/assets/storage.server.ts`.
When R2 credentials are configured, new persisted Studio and AI-generated
assets are written to the configured Cloudflare R2 bucket. Production writes require R2. Development and tests can retain the legacy
Supabase fallback. Studio user uploads and report logos also use R2.

R2 objects use keys under
`workspace/<workspaceId>/assets/r2/<assetId>/...`; older keys without the
`r2` segment remain in Supabase Storage. The key marker lets reads, signed
playback URLs, downloads, and deletion choose the correct backend without
requiring an immediate bulk cutover. Migrated legacy paths have server-only
aliases for cached and in-flight readers. Workspace-scoped API routes validate membership and
the workspace path before signing URLs. R2 buckets must remain private; the
application issues short-lived signed URLs for access.

Library and content readers validate stored keys against the owning workspace
before signing, including thumbnail keys and UGC references. Browser downloads
obtain a fresh five-minute attachment URL from `/api/assets/download`, with
membership and path authorization. Attachment navigation supports large videos
without browser buffering or a bucket CORS dependency. Browser `fetch` or canvas
use of signed URLs still requires a bucket CORS rule for the application origin;
keep the bucket private and allow only GET/HEAD for approved origins.

Persistence accepts PNG, JPEG, WebP, GIF, MP4, WebM, and QuickTime media. Concurrent
requests cannot overwrite another active persistence attempt. A failed process's
15-minute persistence lease can be reclaimed with an atomic timestamp check;
deleted assets cannot be restored by replaying their idempotency key.

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_BUCKET_NAME` to enable R2. `R2_ENDPOINT` is optional and defaults to the
account's Cloudflare S3 endpoint. A partially configured credential pair is
reported as an error rather than silently falling back to Supabase.

The live check uses temporary users, a temporary workspace, one generated
image, and one legacy Supabase object, and removes them when complete:

```powershell
npx vitest run --config vitest.live.config.ts tests/live/r2-storage.live.ts
```

This suite also persists a public CC0 sample video and checks range requests,
attachment downloads, and denial of an outsider's download request. To exercise
the deployed HTTP routes against temporary test data:

```powershell
$env:R2_SMOKE_BASE_URL = "https://mellox.ai"
npx vitest run --config vitest.live.config.ts tests/live/r2-storage.live.ts
Remove-Item Env:R2_SMOKE_BASE_URL
```

Release only after unit/contract, workspace isolation, lint, secret scan,
production dependency audit, and the production build checks pass. Verify that
`/api/health` reports the released Git commit, then run the deployed smoke suite.
If deployment or smoke checks fail, restore the last healthy Railway deployment
or revert the release commit. Keep R2 credentials configured during rollback so
already-created R2 media remains accessible. Rollback never requires deleting
objects or migrating legacy Supabase media.

Existing-file migration, checkpoints, checksum verification, safe reference
cutover and rollback are documented in [storage-migration.md](storage-migration.md).
Original Supabase objects remain retained until independently verified and
explicitly approved for retirement.
