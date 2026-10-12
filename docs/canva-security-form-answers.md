# Canva Security information: form drafts

Exact Portal questions and field limits were not supplied. These thematic answers are each at most 500 characters, including spaces; this is a chosen draft limit, not a verified Canva field limit. Match them to the actual fields before submission.

**Do not submit proposed-code controls as production facts until the new migration and application are deployed and verified.** Storage geography, backups, retention commitments and operational access controls still require your confirmation. The candid answers below identify missing evidence instead of inventing it. No Google/Canva approval or certification is claimed.

Only the paragraph under each heading is paste-ready; headings and counts are not part of the answer. Canonical text is in [the JSON file](canva-security-form-answers.json). Regenerate/check with `node scripts/validate-canva-security-answers.mjs --write`.

## Integration purpose (308 characters)

Mellox AI lets authenticated business and agency workspace editors edit selected marketing images and carousels in Canva, then import edited PNG pages into their own Mellox workspace. Access is workspace-scoped. Users initiate design creation and import; Mellox does not enumerate their entire Canva library.

## OAuth state and authorization (411 characters)

We use server-side authorization-code OAuth with S256 PKCE. State and verifier each use 48 random bytes. The database stores hashed state and an encrypted verifier, bound to the authenticated user and workspace. State expires after ten minutes and is consumed once. Final credential installation rechecks membership and state in a transaction; withdrawal prevents a pending callback from installing credentials.

## Redirect URL restrictions (399 characters)

The callback is fixed by server configuration: https://mellox.ai/api/integrations/canva/callback. Production requires a non-loopback HTTPS origin. Credentials, query strings, fragments and non-root paths are rejected in APP_URL. Clients cannot choose the OAuth callback. Post-connect return paths must be internal relative paths. The exact callback must also be registered in Canva Developer Portal.

## Scopes and least privilege (340 characters)

Requested scopes: asset:write uploads selected images; asset:read checks upload jobs; design:content:write creates/imports designs; design:meta:read retrieves design editor links; design:content:read exports PNG pages. All five support implemented actions. We do not request profile, folder, brand-template, collaboration or webhook scopes.

## Token encryption and storage (448 characters)

Access and refresh tokens are encrypted with AES-256-GCM and fresh 12-byte IVs, in separate columns of the same service-role-only Supabase Postgres record. Keys remain in server environment configuration; the default key is provider-specific HKDF-SHA256 derived from the Supabase service credential. A compatible dedicated key supports older grants. Tokens are not returned to browsers. We do not claim KMS/HSM or independent physical token stores.

## Access controls (417 characters)

Requests require Supabase authentication and server-side workspace role checks. Canva mutations require editor or higher; viewers can read connection status. Credential tables deny anonymous and authenticated database roles; credential functions are executable only by service_role. Mapping tables enforce workspace RLS. Actual staff access, MFA and production administrative privileges require operator confirmation.

## Webhook signature verification (418 characters)

Not applicable to this implementation: no Canva webhook receiver, webhook subscription code or collaboration event scope is present. Actions use authenticated REST requests and bounded job polling. We do not claim Canva webhook signature verification. Confirm there are no subscriptions configured externally; future webhook support must verify Canva signatures and reject replayed or invalid events before processing.

## Canva data collected and stored (473 characters)

We store encrypted OAuth tokens, expiry/scopes, connection status, Canva user/team and design/asset IDs, source mappings, import versions/pages and audit identifiers in Supabase Postgres. Newly persisted edited images use the configured Cloudflare R2 bucket under the workspace path; older images remain readable in Supabase Storage. Temporary export links are processed server-side, not stored as asset identity. We do not fetch Canva profile email or all library designs.

## Storage locations and subprocessors (440 characters)

Logical storage is Supabase Postgres and Cloudflare R2 for new assets; older files may remain in Supabase Storage. The hosting server processes Canva requests and image bytes. Canva receives user-selected images and design content. Provider regions, replicas, backups and processor contracts are unverified and require operator confirmation. User-selected publishing or other Mellox workflows may send imported assets to the chosen service.

## Retention periods (453 characters)

There is no implemented fixed calendar retention period for Canva assets, mappings or audit records. OAuth state is valid for ten minutes; that is not a deletion deadline. Finalized states are deleted after installation. Tokens and pending states are removed on disconnect. Imported assets and revoked connection metadata remain with workspace content. Expired abandoned-state cleanup and backup retention rules still need definition and implementation.

## Disconnect and revocation (459 characters)

An authenticated workspace editor can disconnect Canva in Mellox Connections. A database transaction withdraws pending authorization, marks connection metadata revoked and deletes local tokens. Mellox then attempts Canva token revocation. Non-success or network failures are reported as unconfirmed, with instructions to remove Mellox in Canva account settings. Imported designs/assets remain. Remote revocation retries are not scheduled after local deletion.

## Data deletion (474 characters)

Disconnect deletes authorization, not imported content. Workspace owners can use the typed-confirmation deletion flow, which now withdraws Canva access before database cascades remove workspace records. Object-storage cleanup is best effort, without guaranteed retry or backup erasure. A user-account erasure and ownership-transfer workflow was not found. Retention, deletion deadlines and backup handling require operator confirmation; we do not guarantee complete erasure.

## Backups and recovery (423 characters)

Backup configuration, storage countries, encryption, frequency, retention and restore-drill evidence were not verified in this repository audit. We cannot truthfully certify a backup period or recovery guarantee from the source code. The operator must confirm the actual Supabase and hosting settings and establish how deleted Canva data remains excluded after a restore before making affirmative backup or deletion claims.

## SAST practices (442 characters)

Existing CI includes TypeScript, ESLint and a custom tracked-file secret scan. A dedicated Semgrep 1.180.0 workflow has now been prepared for PRs, main/master pushes and weekly scans using p/security-audit, failing on findings with metrics disabled. The workflow has not yet run or been triaged, so we do not claim an established or clean SAST program. Verify a successful run and branch-protection settings before claiming enforced scanning.

## SCA and dependency vulnerability handling (453 characters)

CI defines npm audit for production Node dependencies on PRs and main/master pushes, failing at high severity. The local audit on 2026-10-12 found six moderate findings and no high or critical findings. Fixes require compatibility review; they were not automatically applied. This does not establish vulnerability-free dependencies or SCA for development/Python dependencies. Production CI execution and required-check enforcement remain to be verified.
