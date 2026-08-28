# Data Model: RavalAI × SDR Integration

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08

Additive changes to RavalAI's Supabase schema. The SDR's own Postgres schema is **untouched** — it remains the authoritative store for accounts, tokens, posts, post_targets, api_keys, webhook_endpoints, and delivery_logs.

> **Pre-schema gate**: reconcile the divergent `20260707*` migrations (e.g. `20260707193010_*.sql`, `20260707193303`, `20260707193445`) that re-`CREATE TABLE content_items` with a different shape (`metadata`, `scheduled_for`, `published_at`, no `agent`/`kind`/`media_url`/`metrics`/`meta`) than the shape the app uses. No SDR columns are added until this is resolved.

---

## 1. `workspace_sdr` (new) — per-workspace distribution identity

Purpose: the server-side-only mapping between a RavalAI workspace and its SDR identity (key + webhook secret). **Never readable by the user client.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `workspace_id` | uuid FK → `workspaces(id)` | one row per workspace |
| `sdr_workspace_id` | text | the SDR workspace this maps to (SDR accepts `workspace_id` 1–64) |
| `encrypted_api_key` | text | per-workspace SDR API key, encrypted at rest (app-layer encryption, mirroring the SDR's Fernet posture; raw key shown once at mint, then only the encrypted form is stored) |
| `webhook_secret` | text | per-workspace secret used to verify SDR webhook signatures; stored encrypted |
| `sdr_base_url` | text | default from server env; per-workspace override allowed |
| `status` | text | `active` \| `provisioning` \| `error` (default `provisioning`) |
| `last_provisioned_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**RLS**: `ENABLE ROW LEVEL SECURITY`; **no `authenticated` policies** — only `service_role` (via `SECURITY DEFINER` helper or service client) may read/write. This is what guarantees FR-014 (credentials never in the browser).

**Lifecycle**:
1. First SDR-related action in a workspace (e.g., first connect attempt) → server fn `ensureWorkspaceSdrProvisioning(workspaceId)`.
2. Server (service-role client) mints a key via SDR `POST /api/v1/admin/api-keys` using server-only `SDR_ADMIN_TOKEN`; registers webhook via `POST /api/v1/webhooks/config` with a generated per-workspace secret.
3. Raw key + secret are encrypted and written; `status=active`.
4. Provisioning is idempotent — concurrent first-actions converge on one row (`INSERT ... ON CONFLICT (workspace_id)`).

---

## 2. `content_publications` (new) — webhook-driven delivery mirror

Purpose: the queryable per-platform delivery truth that drives the Studio's status view. **Written only by the webhook receiver** (and the server fns that create pending rows on submit); never written directly by the client.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `workspace_id` | uuid FK → `workspaces(id)` | for RLS + queries |
| `content_item_id` | uuid FK → `content_items(id)` ON DELETE CASCADE | the editorial item being distributed |
| `sdr_post_id` | text | the SDR job id (`job_id`) |
| `sdr_target_id` | text | the SDR target id (`target_id`) — per-account delivery unit |
| `platform` | text | `twitter` \| `linkedin` \| `facebook` \| `instagram` (wire-id `twitter`, per SDR contract + RavalAI `PlatformId`; label "X") |
| `account_id` | text | the connected account id (SDR account id) this delivery targeted |
| `status` | text | `pending` \| `publishing` \| `published` \| `failed` \| `retrying` \| `cancelled` \| `partial_failed` |
| `platform_post_id` | text nullable | platform-native post id (from SDR `target.platform_post_id`) |
| `platform_post_url` | text nullable | live link (from SDR `target.platform_post_url`) |
| `error_category` | text nullable | `transient` \| `auth` \| `rate_limit` \| `fatal` \| `media` \| `unknown` |
| `last_error` | text nullable | human-readable reason |
| `attempt` | int default 0 | delivery attempt count |
| `delivered_at` | timestamptz nullable | when published |
| `created_at` / `updated_at` | timestamptz | |

**Uniqueness**: `UNIQUE (content_item_id, sdr_target_id)` — makes webhook application idempotent (FR-021): a delivered or re-delivered callback upserts the same row to the same state.

**RLS**: `ENABLE ROW LEVEL SECURITY`; policy `publications_workspace_members` → workspace members can `SELECT` (and `SELECT` only) their own rows via `is_workspace_member(workspace_id, auth.uid())`; `INSERT`/`UPDATE`/`DELETE` via `service_role` only (server fns + webhook receiver).

**Indexes**: `(content_item_id)`, `(workspace_id, status)`, `(platform)`, `(status)`.

**Status transitions** (mirror the SDR's `JobResponse`/`TargetStatus` semantics):
```text
pending ──► publishing ──► published        (per-target)
             │  │   └──► retrying ──► published  (transient recovery)
             │  └──────────► failed          (permanent / auth)
             └────────────► cancelled
```
Overall `content_items.status` is aggregated from its rows: all `published` → `published`; any `pending|publishing|retrying` → `publishing`; all `failed|cancelled` → `failed`; mix of published + not → `partial_failed`.

---

## 3. `content_items` changes (additive)

- **`status` enum**: add `publishing` (in-flight). Editorial values `draft|pending|approved|rejected|scheduled|published` unchanged. (`publishing` is the transitional state between submit and webhook-confirmed `published`.)
- **`meta` jsonb**: add keys `sdr_job_id`, `sdr_revision` (int). `sdr_revision` increments on each republish of a previously-failed item so the SDR idempotency key changes (FR-023).
- **`media_url`**: unchanged column; the media durability rule (FR-019) is a server-side policy — the value handed to the SDR must be a durable public URL.

---

## 4. Validation rules

- `workspace_sdr.workspace_id` → must reference an existing workspace; one row per workspace.
- `content_publications.status` → one of the enumerated set (no free text).
- `content_publications.platform` → one of the 4 supported platforms.
- `content_items.meta.sdr_revision` → non-negative int; incremented only on republish-after-failure.
- Webhook upsert: a `failed`/`published` callback must not be overwritten by a stale `retrying` callback (apply highest-confidence terminal state wins).

## 5. What we deliberately did NOT add

- No new column on `content_items` for external job id / URL (lives in `content_publications`).
- No SDR-token storage in Supabase beyond the per-workspace key + webhook secret in `workspace_sdr` (encrypted).
- No client-readable SDR tables.
