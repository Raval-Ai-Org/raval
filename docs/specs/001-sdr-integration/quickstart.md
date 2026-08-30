# Quickstart: RavalAI × SDR Integration (Phase 0/1)

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08

How to stand up the SDR locally, smoke-test all 4 adapters in DryRun, and point the RavalAI dev server at it — the host-independent Phase 0 path.

## 1. Stand up the SDR locally

Repo: `../Social-Distribtion-Engine-RavalAI-SDE-/` (its own git repo, Python 3.12).

**Option A — Docker Compose (full parity):**

```bash
cd Social-Distribtion-Engine-RavalAI-SDE-
cp .env.example .env
# fill: POSTGRES_PASSWORD, SDE_API_TOKEN (>=16 chars), SDE_SIGNING_SECRET (>=32 bytes),
#       FERNET_KEY (Fernet.generate_key())
docker compose up -d --build          # postgres, redis, api, worker, beat (+flower)
docker compose run --rm api alembic upgrade head
```

> Disk-sensitive machine: pull images, run the smoke test, then `docker compose down` and prune to reclaim disk.

**Option B — local venv (lighter, for tests):**

```bash
cd Social-Distribtion-Engine-Ravalai-SDE-   # (note repo dir name)
source venv/bin/activate
pip install -e ".[dev]"
# run the pytest suite (uses dryrun accounts, no external APIs):
pytest -q
```

## 2. Smoke-test (DryRun, no external accounts)

DryRun activates automatically for accounts whose platform is `dryrun` (or an unregistered platform). Magic strings in text force failure modes (`FORCE_429` retryable, `FORCE_401` auth, `FORCE_500` transient, `FORCE_FATAL` fatal).

```bash
# Option A (against a running compose stack):
cd Social-Distribtion-Engine-RavalAI-SDE-/specs/001-social-sde/demo
./run-demo.sh          # health → publish → job status → idempotency → schedule → cancel → 401 → multi-target
```

Verify in the output: 201 publish, job reaches `published`, duplicate key returns the same job, cancel returns 204, missing Bearer → 401. Then a DryRun failure pass with `FORCE_FATAL` text → status `failed` with `error_category=fatal`.

**RavalAI dev pointed at the local SDR:**

```bash
cd raval
# server-only env (never VITE_*):
#   SDR_BASE_URL=http://localhost:8000
#   SDR_ADMIN_TOKEN=<the SDE_API_TOKEN from SDR .env>
#   SDR_SECRET_ENCRYPTION_KEY=<base64 32-byte key — e.g. from FERNET_KEY>
#   SDR_WEBHOOK_BASE_URL=<public URL that reaches the webhook receiver; in dev
#                         localhost can't receive SDR callbacks, so dev relies on
#                         the GET /api/v1/jobs/{id} polling fallback (R2h)>
#   CRON_SECRET=<shared secret guarding the reconcile sweep>
#   FEATURE_FLAG_SDR_ENABLED=false   # flip to true only when the SDR is live
npm run dev
```

## 3. First integration slice (Phase 1, read-only)

1. **Provisioning** — trigger a first connect; `ensureWorkspaceSdrProvisioning` mints the per-workspace key + registers the webhook (verify `api_keys` + `webhook_endpoints` rows appear in the SDR DB).
2. **Connections view** — `GET /api/sdr/accounts` returns connected accounts; connect LinkedIn/X via the OAuth start → consent → callback (SDR fix #2 adds the `redirect_after` bounce).
3. Publish remains the current mock until Phase 2 flag.

## 4. Verification checklist

- [ ] SDR `/healthz` returns healthy (DB + Redis + worker)
- [ ] All 4 adapters pass DryRun (`dryrun` platform) incl. FORCE_* failure modes
- [ ] Per-workspace key minted; global `SDE_API_TOKEN` NOT used for tenant traffic
- [ ] Webhook registered; a signed delivery is verified and applied; an unsigned one is rejected (401)
- [ ] `content_publications` reflects per-platform status; item status aggregates correctly
- [ ] Publish is idempotent (SC-003); republish-after-failure uses a new `sdr_revision` (FR-023)
- [ ] SDR-down → feature flag degrades to current mock (SC-007/008)

### Webhook verification (FR-021 / SC-009)

The SDR signs every delivery event (`app/services/webhook_out.py`): header
`X-Signature-256: sha256=<hex>` over `HMAC-SHA256(secret, "POST|/webhook|" + rawBody)`
with the **workspace's** webhook secret. The receiver
(`src/lib/sdr.webhook.ts`, route `POST /api/public/hooks/sdr`):

1. Resolves the delivery row by `(sdr_post_id, sdr_target_id)` → the workspace
   secret (no row → 404, nothing applied).
2. Verifies the signature with `timingSafeEqual` **before any state change**
   (missing/mismatch → 401, zero state change).
3. Applies idempotently — upsert on `UNIQUE(content_item_id, sdr_target_id)`,
   terminal-wins (a stale `retrying` never downgrades `published`/`failed`).
4. Recomputes the item's aggregated status (only for items with SDR rows).

Manual check: sign a tiny body with the workspace secret and `curl` it to the
receiver — expect `200 {"ok": true}` and the row updated; send the same body
with a bad signature — expect `401` and no change.

### Provisioning (FR-022)

On a workspace's first SDR action, `ensureWorkspaceSdrProvisioning`
(`src/lib/sdr-provisioning.server.ts`) mints a per-workspace SDR key
(`POST /api/v1/admin/api-keys` with the server-only `SDR_ADMIN_TOKEN`), registers
the workspace's webhook endpoint with a generated secret, and stores both
AES-256-GCM-encrypted in `workspace_sdr` (service-role only). Idempotent — concurrent
first-actions converge on one row via `ON CONFLICT (workspace_id)`. Verify a fresh
workspace: `api_keys` + `webhook_endpoints` rows appear in the SDR DB, and the raw
key/secret never appear in the browser or Supabase client tables.

## 5. Known SDR-side fixes to land before live (isolated)

1. Queue immediate publish (return 202)
2. OAuth callback `redirect_after`
3. Instagram worker token format + refresh
4. Webhook retry loop
5. CORS lockdown

See [plan.md](./plan.md) → "SDR-side fixes".
