# Deploying Mellox AI

Two supported targets. Both run the same `Dockerfile` (Next.js standalone
server, non-root user, container health check on `/api/health`).

| Target                                | When                               | TLS / proxy                    | Cache                                                                    |
| ------------------------------------- | ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| **Railway** (current)                 | Managed hosting, zero server admin | Railway edge                   | Add a Railway Redis and set `REDIS_URL`, or run without (in-process LRU) |
| **Single VPS** (`docker-compose.yml`) | Own server (Lightsail, Hetzner, …) | Caddy, automatic Let's Encrypt | Bundled Redis (cache only, 256 MB LRU)                                   |

The Social Distribution Engine (SDR) deploys separately — see
[ADR-0005](adr/0005-aws-lightsail-sdr-production-deployment.md).

## 1. Environment

Copy the names from [`.env.example`](../.env.example). Production refuses to
boot when a required variable is missing or malformed (`src/instrumentation.ts`
→ `checkEnv` in `src/server/env.ts`); the log lists variable **names** only.

Required at production startup: `APP_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`OPENROUTER_API_KEY`, and `CRON_SECRET` (at least 16 characters).

`NEXT_PUBLIC_CLARITY_ID` is the public Microsoft Clarity project ID and is
required when building the production Docker image. Set it in Railway Variables
as a build-time variable (or in `.env` for the VPS Compose build). Next.js
inlines it into the browser bundle, so changing it requires a new image build
and deploy; a runtime-only value is too late.

`NEXT_PUBLIC_APP_URL` is optional in the server schema. Set it to the same
canonical origin as `APP_URL` and pass it as a Docker build argument when
building the production image so generated public URLs use the deployed domain.

Recommended: `REDIS_URL`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`, and `TAVILY_API_KEY`.
Video provider credentials are configured separately when the selected provider
requires them. Mellox AI uses OpenRouter for text, vision, tool-use, and image
models; do not configure a direct Anthropic API key.

When `FEATURE_FLAG_SDR_ENABLED` is on, `SDR_BASE_URL`, `SDR_ADMIN_TOKEN`,
`SDR_SECRET_ENCRYPTION_KEY` and `SDR_WEBHOOK_BASE_URL` become required.

For managed social publishing, set `DISTRIBUTION_PROVIDER=postforme`,
`POST_FOR_ME_API_KEY`, and `POST_FOR_ME_WEBHOOK_SECRET` as server-only service
variables. Use an API key and webhook secret from the **same Quickstart project**
where the platforms are enabled; a key from a separate White Label project
cannot use that Quickstart project's platform credentials. In the Post for Me
dashboard, enable LinkedIn, X, Instagram,
Facebook, Threads, TikTok, and YouTube under Project Setup. Set the **Project
Redirect URL** to `https://mellox.ai/app/social/connected` (or the matching
`APP_URL` origin in a non-production environment). The Post for Me webhook URL
is `https://mellox.ai/api/public/hooks/postforme`; subscribe it to
`social.post.updated`, `social.post.result.created`, `social.account.created`,
and `social.account.updated`. Use its webhook secret in
`POST_FOR_ME_WEBHOOK_SECRET`. Apply the Post for Me billing migration before
switching production traffic to this provider.

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

1. Service variables: everything from §1, including `NEXT_PUBLIC_CLARITY_ID`.
   Mark `NEXT_PUBLIC_*` as available at build time. The root Dockerfile declares
   each one as a builder-stage `ARG` and exports it to `ENV` before
   `npm run build`; the Clarity build verifier fails if the ID or emitted
   production CSP/bundle is missing.
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
Clarity's `www.clarity.ms`, load-balanced `a.clarity.ms`–`z.clarity.ms`, and
`c.bing.com` hosts are permitted only in `script-src`/`connect-src` as required.
