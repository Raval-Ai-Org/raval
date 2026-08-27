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

## Quick start (for new team members)

**TL;DR:** clone, run `npm run setup`, fill in `.env`, run `npm run dev`. The dev server is on `http://localhost:8080`.

### Why a setup script?

The repo's `.env` file is **gitignored** (it holds secrets like the Supabase service-role key and SDR admin token). The first time you clone, you need to create `.env` from `.env.example` **and** replace the placeholder values with real ones — otherwise `npm run dev` will start, the homepage and `/login` will load, but authentication will silently fail. The page won't return a 404 in the HTTP sense, but from your perspective it will look broken (form submits and nothing happens, or you get redirected in a loop). The setup script catches this for you.

### One-time setup

```bash
git clone https://github.com/Raval-Ai-Org/raval.git
cd raval
npm run setup                    # creates .env from .env.example if missing
# Edit .env — replace the YOUR_* placeholders with real credentials.
# Get the values from a teammate (Junaid) or from 1Password.
# Required keys: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
# SDR_BASE_URL, SDR_ADMIN_TOKEN, SDR_SECRET_ENCRYPTION_KEY, CRON_SECRET
npm install                       # if node_modules wasn't installed by setup
npm run dev                       # http://localhost:8080
```

### What `npm run setup` does

1. Creates `.env` from `.env.example` if it's missing
2. Scans `.env` for placeholder values (`YOUR_PROJECT_REF`, etc.) and warns if found
3. Runs `npm install` if `node_modules` is missing
4. Prints a one-screen status report

It's idempotent — safe to run multiple times.

### What `npm run dev` does before starting Vite

A `predev` hook automatically runs `scripts/predev-check.sh`, which:
- Verifies `.env` exists and has real (non-placeholder) values
- Verifies `node_modules` is installed
- Pings the SDR tunnel to confirm reachability

If anything is wrong, it prints a loud warning. The dev server still starts (so you can debug), but the warning tells you exactly what to fix.

### Test login (works once `.env` has real values)

| Field | Value |
|---|---|
| Email | `junaidsajjad2298@gmail.com` |
| Password | `Junaid@1234` |
| URL | `http://localhost:8080/login` |

If login doesn't work after entering these credentials, the issue is almost always in `.env` — open your browser's DevTools (F12), check the Console for `[Supabase] .env contains placeholder values` and fix accordingly.

### Common "404 on /login" causes (and fixes)

| Symptom | Cause | Fix |
|---|---|---|
| Page loads, form submits, nothing happens | `.env` has placeholder values | Replace `YOUR_*` with real values in `.env`, restart `npm run dev` |
| Hard-refresh (Ctrl+Shift+R) fixes it | Browser cached the old page | Always do a hard refresh after pulling new code |
| Page loads but text is unstyled | Vite build cache stale | `rm -rf node_modules/.vite && npm run dev` |
| `Cannot find module '@/...'` | TS path aliases not resolving | `rm -rf node_modules && npm install && npm run dev` |
| Port 8080 already in use | Another service on 8080 | `lsof -i :8080` to find the process, or change the port in `vite.config.ts` |

### Development

```bash
npm run setup                     # one-time, after clone
npm run dev                       # local dev server; http://localhost:8080
npx vitest run                    # unit/contract/integration tests
npx playwright test tests/e2e/live-platform-e2e.spec.ts   # live e2e suite
npm run build                     # production build
```

See [`specs/001-sdr-integration/quickstart.md`](../specs/001-sdr-integration/quickstart.md)
for standing up the local SDR and the Phase 0 DryRun smoke test.
