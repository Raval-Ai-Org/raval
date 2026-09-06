# Mellox AI

AI-native marketing platform — brand-grounded content, SEO/GEO/AEO, and social
media distribution from one workspace. Next.js App Router (React 19) with a
Supabase (PostgreSQL) backend.

## Project layout

The app runs on the Next.js App Router.

| Path                          | What lives there                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/**/page.tsx`         | Routes. Each is a server component exporting `metadata`, rendering the `"use client"` UI beside it (`LoginPage.tsx`, `AppShell.tsx`, …). |
| `src/app/**/route.ts`         | HTTP handlers (`/api/*`, `/sitemap.xml`), all authenticated with a Supabase bearer token.                                                |
| `src/app/api/rpc/[...fn]`     | The single transport every server function is called through.                                                                            |
| `src/server/fns/*.ts`         | Server-function implementations. Never bundled for the browser.                                                                          |
| `src/lib/*.functions.ts`      | Their browser-side stubs: `await listContentItems({ data })` posts to `/api/rpc/<module>/<name>`.                                        |
| `src/lib/navigation.tsx`      | `Link` / `useNavigate` / `useRouterState` / `redirect` on top of `next/navigation`.                                                      |
| `src/components`, `src/hooks` | Shared UI and hooks (all client components).                                                                                             |

Auth is a Supabase session in `localStorage`, so the signed-in routes gate in the
browser via `SessionGate` and every server call carries an `Authorization: Bearer`
header rather than a cookie.

## Social Distribution Engine (SDR) integration

Mellox AI publishes approved content to clients' LinkedIn, X, Facebook, and
Instagram accounts through the **Social Distribution Engine (SDR)** — a separate
FastAPI + Celery service that owns platform OAuth, token storage, and delivery
execution. Mellox AI is the editorial front-end; it proxies to the SDR
server-side, never exposing credentials to the browser, and receives delivery
status via HMAC-verified webhooks.

Full design: [`specs/001-sdr-integration/`](../specs/001-sdr-integration/)
(spec, plan, data model, contracts, tasks).

### Server-only env keys (never `NEXT_PUBLIC_*`)

Set these in the server environment / `.env` (they are read via `process.env`
in server modules only):

| Key                         | Purpose                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDR_BASE_URL`              | Base URL of the SDR service (default; a per-workspace override may be stored in `workspace_sdr.sdr_base_url`)                                                                                      |
| `SDR_ADMIN_TOKEN`           | Server-only admin token used to mint per-workspace SDR API keys (`POST /api/v1/admin/api-keys`) — never used for tenant traffic                                                                    |
| `SDR_SECRET_ENCRYPTION_KEY` | Base64 key for AES-256-GCM encryption of per-workspace keys + webhook secrets at rest in `workspace_sdr`                                                                                           |
| `SDR_WEBHOOK_BASE_URL`      | Public base URL the SDR registers as the delivery callback receiver for each workspace                                                                                                             |
| `CRON_SECRET`               | Guards the reconciliation sweep (`/api/public/hooks/sdr-reconcile`)                                                                                                                                |
| `FEATURE_FLAG_SDR_ENABLED`  | `"true"`/`"1"`/`"yes"` enables the real SDR path; **off by default** so the platform never regresses during rollout (FR-017). Per-workspace override: `FEATURE_FLAG_SDR_ENABLED_WS_<workspaceId>`. |

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
- Mellox AI computes the same over the raw body and compares with
  `timingSafeEqual`. Mismatch or missing header → `401`, **zero state change**.
- Apply is idempotent (upsert on the `(content_item_id, sdr_target_id)`
  uniqueness constraint) and terminal-wins: a stale `retrying` never downgrades
  a `published`/`failed` row.

## Quick start (for new team members)

**TL;DR:** clone, run `npm run setup`, fill in `.env` (from 1Password — see below), run `npm run dev`. The dev server is on `http://localhost:8080`.

### Why a setup script?

The repo's `.env` file is **gitignored** (it holds secrets like the Supabase service-role key and SDR admin token). The first time you clone, you need to create `.env` from `.env.example` **and** replace the placeholder values with real ones — otherwise `npm run dev` will start, the homepage and `/login` will load, but authentication will silently fail. The page won't return a 404 in the HTTP sense, but from your perspective it will look broken (form submits and nothing happens, or you get redirected in a loop). The setup script catches this for you.

### How to get the real `.env` values

**Never commit `.env` to the repo, even if it's private.** Git history is forever, and the Supabase service-role key + SDR encryption key would be exposed to anyone with future read access.

**Safe procedure:**

1. Ask Junaid to share the "Mellox AI local dev .env" item in 1Password
2. Copy each line from 1Password into your local `.env`
3. Run `npm run setup` to verify

Full details on what's in the file, what each value does, and what to do if a secret is leaked: [`docs/TEAM-CREDENTIALS.md`](docs/TEAM-CREDENTIALS.md).

### One-time setup

Cross-platform — same commands on Linux, macOS, and Windows PowerShell.

```bash
git clone https://github.com/Raval-Ai-Org/raval.git
cd raval
npm run setup                    # creates .env from .env.example if missing
# Edit .env — replace the YOUR_* placeholders with real credentials.
# Get the values from a teammate (Junaid) or from 1Password.
# Required keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
# SDR_BASE_URL, SDR_ADMIN_TOKEN, SDR_SECRET_ENCRYPTION_KEY, CRON_SECRET
npm install                       # if node_modules wasn't installed by setup
npm run dev                       # http://localhost:8080
```

**Windows PowerShell notes:**

- `npm run setup` auto-detects Windows and runs `scripts/setup.ps1` under the hood (no need to manually invoke PowerShell)
- If you see a script execution policy error when running `setup.ps1` directly, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once
- The Node.js-based wrappers (`scripts/setup.cjs`, `scripts/predev-check.cjs`) work on every platform and don't need PowerShell at all
- Git for Windows is **not** required — `npm run dev` works with the PowerShell that ships with Windows 10/11

**Per-platform commands** (if you want to run the underlying script directly):

| Platform           | Setup                                                        | Predev check                                                        |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Linux / macOS      | `bash scripts/setup.sh`                                      | `bash scripts/predev-check.sh`                                      |
| Windows PowerShell | `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` | `powershell -ExecutionPolicy Bypass -File scripts\predev-check.ps1` |
| Any (Node.js)      | `node scripts/setup.cjs`                                     | `node scripts/predev-check.cjs`                                     |

### What `npm run setup` does

1. Creates `.env` from `.env.example` if it's missing
2. Scans `.env` for placeholder values (`YOUR_PROJECT_REF`, etc.) and warns if found
3. Runs `npm install` if `node_modules` is missing
4. Prints a one-screen status report

It's idempotent — safe to run multiple times.

### What `npm run dev` does before starting the dev server

A `predev` hook automatically runs `scripts/predev-check.sh`, which:

- Verifies `.env` exists and has real (non-placeholder) values
- Verifies `node_modules` is installed
- Pings the SDR tunnel to confirm reachability

If anything is wrong, it prints a loud warning. The dev server still starts (so you can debug), but the warning tells you exactly what to fix.

### Test login (works once `.env` has real values)

| Field    | Value                         |
| -------- | ----------------------------- |
| Email    | `junaidsajjad2298@gmail.com`  |
| Password | `Junaid@1234`                 |
| URL      | `http://localhost:8080/login` |

If login doesn't work after entering these credentials, the issue is almost always in `.env` — open your browser's DevTools (F12), check the Console for `[Supabase] .env contains placeholder values` and fix accordingly.

### Common "404 on /login" causes (and fixes)

| Symptom                                   | Cause                         | Fix                                                                        |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Page loads, form submits, nothing happens | `.env` has placeholder values | Replace `YOUR_*` with real values in `.env`, restart `npm run dev`         |
| Hard-refresh (Ctrl+Shift+R) fixes it      | Browser cached the old page   | Always do a hard refresh after pulling new code                            |
| Page loads but text is unstyled           | Next build cache stale        | `rm -rf .next && npm run dev`                                              |
| `Cannot find module '@/...'`              | TS path aliases not resolving | `rm -rf node_modules && npm install && npm run dev`                        |
| Port 8080 already in use                  | Another service on 8080       | `lsof -i :8080` to find the process, or change `-p 8080` in `package.json` |

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
