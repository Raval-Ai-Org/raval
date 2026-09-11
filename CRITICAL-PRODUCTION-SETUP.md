# Critical production setup

The short list of things that must be true before Mellox AI serves real users.
The full procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and
[docs/OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md).

## 1. Rotate every credential that was ever committed

Several production values were committed to git in earlier revisions (the SDR
deployment ADR, the README test login) and the cron secret was stored in
plaintext inside a `cron.job` command. They are removed from the files now, but
git history keeps them: **treat them as compromised and rotate them.** The
list, and how to rotate each one, is in the runbook under
"Credential rotation".

## 2. Scheduled jobs go through Vault — never a URL or secret in SQL

Scheduled publishing, Market Brain collections, competitor alerts, SDR
reconciliation, the agent tick and ops-watch are all driven by `pg_cron`
calling `public.call_app_hook(path)`. That function reads the app origin and
`CRON_SECRET` from **Supabase Vault** at call time, so no committed SQL (and no
`cron.job` row) contains either value.

1. Set `CRON_SECRET` (32+ random characters) in the app's environment.
2. Create the Vault secrets `mellox_app_base_url` and `mellox_cron_secret`
   (STEP 1 of [supabase/ENABLE-CRON-JOBS.sql](supabase/ENABLE-CRON-JOBS.sql)).
3. Run STEP 3 of the same file (or re-run migration `20260911120600`) to
   schedule the jobs; any legacy job that embedded a header or URL is
   replaced.
4. Verify with `/api/health/ready` — it reports stale cron heartbeats.

## 3. One public origin

`APP_URL` and `NEXT_PUBLIC_APP_URL` must be the same public HTTPS origin.
`NEXT_PUBLIC_APP_URL` is inlined at build time, so it must be present as a
build argument (see the `ARG` lines in the `Dockerfile`). Canonical URLs,
`robots.txt`, the sitemap, outbound `User-Agent`/`Referer` strings and cron
callbacks all derive from it (`getAppUrl()` in `src/server/env.ts`). Production
refuses to boot when it points at localhost.

## Checklist

- [ ] Every item in the runbook's rotation list rotated
- [ ] `APP_URL` = `NEXT_PUBLIC_APP_URL` = the public origin (build + runtime)
- [ ] `CRON_SECRET` set (32+ chars) and stored in Vault as `mellox_cron_secret`
- [ ] `mellox_app_base_url` stored in Vault; `mellox-*` cron jobs listed in `cron.job`
- [ ] Migrations applied (`supabase migration list` shows local = remote)
- [ ] `REDIS_URL`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL` set (recommended)
- [ ] `curl -sI https://<domain>/ | grep -i content-security-policy` returns the CSP
- [ ] `curl -s https://<domain>/api/health/ready` returns `"ok":true`
- [ ] `curl -X POST https://<domain>/api/public/hooks/run-schedules` returns 401 (secret required)

## Related documentation

- [Deployment](docs/DEPLOYMENT.md)
- [Operations runbook](docs/OPERATIONS-RUNBOOK.md)
- [Environment variables](.env.example)
- [Google OAuth setup](docs/GOOGLE-OAUTH-SETUP.md)
