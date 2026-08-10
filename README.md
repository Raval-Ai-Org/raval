# RavalAI

AI-native marketing platform — brand-grounded content, SEO/GEO/AEO, and social
media distribution from one workspace. TanStack Start (React 19) on Cloudflare
Workers with a Supabase (PostgreSQL) backend.

## Social Distribution Engine (SDR) integration

RavalAI publishes approved content to clients' LinkedIn, X, Facebook, and
Instagram accounts through the **Social Distribution Engine (SDR)** — a separate
FastAPI + Celery service that owns platform OAuth, token storage, and delivery
execution. RavalAI is the editorial front-end; it proxies to the SDR
server-side, never exposing credentials to the browser, and receives delivery
status via HMAC-verified webhooks.

Full design: [`specs/001-sdr-integration/`](../specs/001-sdr-integration/)
(spec, plan, data model, contracts, tasks).

### Server-only env keys (never `VITE_*`)

Set these in the server environment / `.env` (they are read via `process.env`
in server modules only):

| Key | Purpose |
|---|---|
| `SDR_BASE_URL` | Base URL of the SDR service (default; a per-workspace override may be stored in `workspace_sdr.sdr_base_url`) |
| `SDR_ADMIN_TOKEN` | Server-only admin token used to mint per-workspace SDR API keys (`POST /api/v1/admin/api-keys`) — never used for tenant traffic |
| `SDR_SECRET_ENCRYPTION_KEY` | Base64 key for AES-256-GCM encryption of per-workspace keys + webhook secrets at rest in `workspace_sdr` |
| `SDR_WEBHOOK_BASE_URL` | Public base URL the SDR registers as the delivery callback receiver for each workspace |
| `CRON_SECRET` | Guards the reconciliation sweep (`/api/public/hooks/sdr-reconcile`) |
| `FEATURE_FLAG_SDR_ENABLED` | `"true"`/`"1"`/`"yes"` enables the real SDR path; **off by default** so the platform never regresses during rollout (FR-017). Per-workspace override: `FEATURE_FLAG_SDR_ENABLED_WS_<workspaceId>`. |

### How it works

1. **Provisioning (FR-022)** — on a workspace's first SDR action, the server
   calls `ensureWorkspaceSdrProvisioning`: it mints a per-workspace SDR key via
   `SDR_ADMIN_TOKEN`, registers a webhook endpoint with a generated
   per-workspace secret, and stores both encrypted in `workspace_sdr`
   (service-role only — never browser-visible, FR-014).
2. **Publish / schedule (US2/US3)** — the Studio calls `/api/sdr/publish` or
   `/api/sdr/schedule`; the server proxies to the SDR with the workspace's key,
   idempotently, and mirrors results into `content_publications`.
3. **Delivery status (US4)** — the SDR pushes per-target events to
   `/api/public/hooks/sdr`; the receiver verifies `X-Signature-256` (HMAC-SHA256
   over `POST|/webhook|<body>` with the workspace secret) with
   `timingSafeEqual` **before any state change** (FR-021). The Studio delivery
   view re-fetches `getPublications` on `content:changed`.
4. **Reconciliation (FR-018)** — a periodic sweep
   (`/api/public/hooks/sdr-reconcile`, guarded by `CRON_SECRET`) resolves any
   publication stuck in `publishing`/`pending` against the SDR job status.

### Webhook verification (FR-021 / SC-009)

- SDR signs each delivery: `X-Signature-256: sha256=<hex>` where the payload is
  `HMAC-SHA256(secret, "POST|/webhook|" + rawBody)`.
- RavalAI computes the same over the raw body and compares with
  `timingSafeEqual`. Mismatch or missing header → `401`, **zero state change**.
- Apply is idempotent (upsert on the `(content_item_id, sdr_target_id)`
  uniqueness constraint) and terminal-wins: a stale `retrying` never downgrades
  a `published`/`failed` row.

### Development

```bash
npm install
npm run dev        # local dev server; point SDR_BASE_URL at your local SDR
npx vitest run     # unit/contract/integration tests
npm run build
```

See [`specs/001-sdr-integration/quickstart.md`](../specs/001-sdr-integration/quickstart.md)
for standing up the local SDR and the Phase 0 DryRun smoke test.
