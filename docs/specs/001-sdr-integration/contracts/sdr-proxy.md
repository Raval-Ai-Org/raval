# Contract: RavalAI → SDR Server Proxy

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08

The RavalAI-internal server surface that the Studio calls. Every handler lives in the Cloudflare Worker (TanStack server fn or file route), validates the caller's Supabase session + workspace membership, then proxies to the SDR using the workspace's per-workspace key. **The SDR is never reachable from the browser.**

The SDR's own external contract is authoritative and unchanged: `app/api/*`, `app/schemas.py`, and `specs/001-social-sde/integration/INTEGRATION.md` in the SDR repo (the SDR's `openapi.yaml`/`quickstart.md` are superseded design intent).

## Auth model (every endpoint)

- Caller sends `Authorization: Bearer <supabase access_token>` (already attached by `attachSupabaseAuth` middleware / `authedFetch`).
- Handler runs `requireUserId(request)` (`src/server/api-auth.ts`); for workspace-scoped ops, uses the user-scoped Supabase client so RLS (`is_workspace_member`) authorizes the `workspace_id`.
- The per-workspace SDR key + webhook secret are read server-side from `workspace_sdr` via the **service-role** client only. `SDR_ADMIN_TOKEN` + default `SDR_BASE_URL` come from server-only env (never `VITE_*`).
- Outbound fetch validates the SDR base URL with `assertPublicUrl` (SSRF guard).

## Endpoints

### `POST /api/sdr/oauth/start` (connect **and** reconnect — FR-001/FR-004)

Body: `{ workspaceId, platform }` (`platform` ∈ twitter|linkedin|facebook|instagram — wire-id is `twitter` per the SDR contract and RavalAI's `PlatformId`; the UI label is "X").
Flow: `ensureWorkspaceSdrProvisioning(workspaceId)` → proxy `GET /api/v1/oauth/{platform}/start` with the workspace key → return `{ authorizationUrl, stateToken }`.
Reconnect: an expired account (status `expired`) triggers the same `oauth/start` for its platform; on successful callback the account returns to `active` and is re-offered as a target (FR-004).
Errors: 400 unknown platform · 401/403 auth · 500 provisioning failure.

### `GET /api/sdr/accounts`

Query: `workspaceId`.
Flow: proxy `GET /api/v1/accounts` → return `[{ accountId, platform, platformUsername, status, tokenExpiresAt }]` (tokens never included).
Errors: 401/403 · 500.

### `POST /api/sdr/disconnect` (FR-003)

Body: `{ workspaceId, accountId }`.
Flow: proxy `DELETE /api/v1/accounts/{accountId}` (SDR soft-deletes → status `disconnected`) → remove the account from the Connections view and from all future destination selections.
Errors: 401/403 · 404 unknown account · 500.

### `POST /api/sdr/publish`

Body: `{ workspaceId, contentItemIds: string[], destinationSelection }` where destinationSelection is one of:

- `{ type: "account", accountId }`
- `{ type: "platform", platform }` (all that platform's accounts)
- `{ type: "all" }`
  Server resolves each content item → its `meta.platform` + body + durable `media_url` → builds SDR `PublishRequest` per connected account:

```json
{
  "idempotency_key": "publish:{content_item_id}:{platform}:{account_id}:{sdr_revision}",
  "scheduled_at": null,
  "targets": [{ "account_id": "...", "content": { "text": "...", "media_urls": ["..."] } }]
}
```

Proxy `POST /api/v1/publish` → on 201 upsert `content_publications` rows (status `publishing`, store `sdr_post_id`/`sdr_target_id`) + set item status `publishing` + `meta.sdr_job_id` → return `{ jobId }`.
Idempotency: same key → SDR returns existing job (409 on duplicate is handled as "already exists" → return existing).
Errors: 400 (validation, e.g. IG missing media pre-flight) · 401/403 · 409 (already exists) · 422 → mapped to actionable pre-publish validation · 503 (SDR unreachable → feature-flag degrade to current mock behavior).

### `POST /api/sdr/schedule`

Same shape as publish but `scheduled_at` = absolute UTC instant from `content_items.scheduled_at`; idempotency key `schedule:{...}:{sdr_revision}`. Reschedule = cancel existing pending/retrying target (`DELETE /api/v1/jobs/{id}`) then schedule fresh.

### `GET /api/sdr/jobs/{sdrJobId}`

Proxy `GET /api/v1/jobs/{id}` (used for reconciliation/debug; primary status path is webhooks).

### `POST /api/sdr/cancel`

Body: `{ workspaceId, contentItemId }`. Cancels the pending schedule via SDR `DELETE /api/v1/jobs/{id}`; sets `content_publications.status=cancelled` for pending rows + item back to a cancellable state. Only valid while not yet fired.

## Error envelope (RavalAI → Studio)

```json
{
  "error": {
    "code": "PLATFORM_VALIDATION | ACCOUNT_EXPIRED | SDR_UNREACHABLE | DUPLICATE | ...",
    "detail": "human-readable",
    "requestId": "..."
  }
}
```

## Concurrency & consistency

- `ensureWorkspaceSdrProvisioning` is idempotent (`ON CONFLICT (workspace_id)`).
- Publish submit and webhook apply can race; the webhook receiver is the authority for terminal delivery state.
- The 3 existing call sites that change to server fns: `StudioCanvasModal.tsx:891-922` (publish now), `:850-889` (schedule), `StudioRail.tsx:465-478` (approve→publish). **Approval-rail behavior (FR-024):** the rail's `approved` decision stays _editorial_ (sets `approved`); only an explicit Publish/Schedule action in the canvas (or the rail's explicit "Publish now") triggers distribution — an approve alone never posts.
- Everything else (SEO/email/article/landing canvases) is untouched, and SDR aggregation never recomputes their status (no `content_publications` rows).
- **Dev-mode (R2h):** a localhost RavalAI cannot receive SDR webhooks (the SDR can't reach `localhost`). In dev, the client/server polls `GET /api/v1/jobs/{id}` for status until the webhook receiver is deployed behind a public URL; the webhook path is the production mechanism.
