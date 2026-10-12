# Media storage

Generated media is stored through `src/server/assets/storage.server.ts`.
When R2 credentials are configured, new persisted Studio and AI-generated
assets are written to the configured Cloudflare R2 bucket. Otherwise, new
assets continue to use the Supabase `generated-assets` bucket.

R2 objects use keys under
`workspace/<workspaceId>/assets/r2/<assetId>/...`; older keys without the
`r2` segment remain in Supabase Storage. The key marker lets reads, signed
playback URLs, downloads, and deletion choose the correct backend without
moving existing objects. Workspace-scoped API routes validate membership and
the workspace path before signing URLs. R2 buckets must remain private; the
application issues short-lived signed URLs for access.

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_BUCKET_NAME` to enable R2. `R2_ENDPOINT` is optional and defaults to the
account's Cloudflare S3 endpoint. A partially configured credential pair is
reported as an error rather than silently falling back to Supabase.

The live check uses temporary users, a temporary workspace, one generated
image, and one legacy Supabase object, and removes them when complete:

```powershell
npx vitest run --config vitest.live.config.ts tests/live/r2-storage.live.ts
```

This storage change does not migrate or copy existing media.
