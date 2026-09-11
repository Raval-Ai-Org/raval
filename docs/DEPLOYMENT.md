# Deploying Mellox AI

Two supported targets. Both run the same `Dockerfile` (Next.js standalone
server, non-root user, container health check on `/api/health`).

| Target | When | TLS / proxy | Cache |
| --- | --- | --- | --- |
| **Railway** (current) | Managed hosting, zero server admin | Railway edge | Add a Railway Redis and set `REDIS_URL`, or run without (in-process LRU) |
| **Single VPS** (`docker-compose.yml`) | Own server (Lightsail, Hetzner, …) | Caddy, automatic Let's Encrypt | Bundled Redis (cache only, 256 MB LRU) |

The Social Distribution Engine (SDR) deploys separately — see
[ADR-0005](adr/0005-aws-lightsail-sdr-production-deployment.md).

## 1. Environment

Copy the names from [`.env.example`](../.env.example). Production refuses to
boot when a required variable is missing or malformed (`src/instrumentation.ts`
→ `checkEnv` in `src/server/env.ts`); the log lists variable **names** only.

Required: `APP_URL`, `NEXT_PUBLIC_APP_URL` (same value, also a **build** arg),
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`OPENROUTER_API_KEY`, `CRON_SECRET` (32+ random chars).

Recommended: `REDIS_URL`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`,
`ANTHROPIC_API_KEY`, `KIE_API_KEY`.

When `FEATURE_FLAG_SDR_ENABLED` is on, `SDR_BASE_URL`, `SDR_ADMIN_TOKEN`,
`SDR_SECRET_ENCRYPTION_KEY` and `SDR_WEBHOOK_BASE_URL` become required.

For the VPS stack also set `APP_DOMAIN`, `ACME_EMAIL` and `REDIS_PASSWORD`.

## 2. Database

Migrations live in `supabase/migrations/`. Every migration added since
2026-09-11 is idempotent and CI replays the full chain on an empty Postgres
(`npm run db:verify`), including an RLS check on every public table.

```bash
supabase link --project-ref <ref>
supabase migration list          # local vs remote
supabase db push --dry-run       # review
supabase db push
```

If `migration list` shows migrations that exist in the database but are not
recorded (the project predates the migration history), mark them applied first
with `supabase migration repair --status applied <version>` — the runbook has
the procedure. A fresh staging/DR database can instead be bootstrapped from
`supabase/baseline/schema.sql` (regenerate with `npm run db:baseline`).

Then enable the scheduler: [supabase/ENABLE-CRON-JOBS.sql](../supabase/ENABLE-CRON-JOBS.sql).

## 3a. Railway

1. Service variables: everything from §1. Mark `NEXT_PUBLIC_*` as available at
   build time (Railway passes them as the Dockerfile `ARG`s).
2. Health check path: `/api/health` (liveness). Point uptime monitoring at
   `/api/health/ready` (Supabase, Redis, cron heartbeats; 503 when degraded).
3. Deploy. Check the boot log for `[env]` lines.

## 3b. Single VPS

```bash
# once, as root on a fresh Ubuntu 22.04/24.04 server
sudo bash deploy/provision.sh deploy

# as the deploy user
git clone <repo> mellox && cd mellox
cp .env.example .env && chmod 600 .env   # fill in real values
bash deploy/deploy.sh
```

`provision.sh` sets up key-only SSH, ufw (22/80/443), fail2ban, unattended
security upgrades and Docker from Docker's apt repository.

`deploy.sh` pulls, builds `mellox-app:<git-sha>`, starts it, waits for the
container health check and **rolls back to the previous tag automatically** if
the new release is not healthy within 120 s. Deploy a specific ref with
`deploy/deploy.sh <tag-or-sha>`; roll back manually with
`APP_IMAGE_TAG=$(cat .deploy/previous) docker compose up -d --no-deps app`.

Only Caddy publishes ports. Logs rotate (json-file 20 MB × 5; Caddy access log
20 MiB × 5, 14 days).

## 4. After every deploy

```bash
curl -sI https://<domain>/ | grep -iE 'content-security-policy|strict-transport'
curl -s  https://<domain>/api/health/ready
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/public/hooks/run-schedules   # 401
```

## Security headers

`next.config.ts` sets CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy,
Permissions-Policy, COOP and (production) HSTS on every response, and
`Cache-Control: no-store` on `/api/*`. The CSP allows inline scripts rather
than using per-request nonces — nonces would force every page to render
dynamically; see [ADR-0008](adr/0008-ai-metering-budgets-guardrails.md).
