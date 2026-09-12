# Operations runbook

What to do when something is wrong, and the switches that stop things safely.
Deployment itself is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Health at a glance

| Check          | Where                                                                                                                  | Healthy                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Liveness       | `GET /api/health`                                                                                                      | 200                                                                  |
| Readiness      | `GET /api/health/ready`                                                                                                | 200, `ok: true` (503 lists what failed: Supabase, Redis, stale cron) |
| Scheduler      | `select * from cron_heartbeats order by job;`                                                                          | every job's `last_succeeded_at` within 3× its interval               |
| Cron delivery  | `select * from net._http_response order by created desc limit 20;`                                                     | `status_code` 200                                                    |
| AI spend       | `select * from ai_usage_daily where day = current_date order by cost_usd desc;`                                        | within plan ceilings                                                 |
| Guardrails     | `select kind, severity, count(*) from guardrail_events where created_at > now() - interval '1 day' group by 1,2;`      | no unexplained spikes                                                |
| Webhooks       | `select outcome, reason, count(*) from sdr_webhook_events where received_at > now() - interval '1 hour' group by 1,2;` | rejections near zero                                                 |
| Agent findings | Operations inbox in the app, or `agent_findings where status = 'open'`                                                 | reviewed                                                             |

`ops-watch` (every 5 min) alerts to `ALERT_WEBHOOK_URL` on missed jobs, AI
spend anomalies (today > 3× trailing 7-day average and > $5), truncation above
10% of calls, and ≥ 20 rejected webhook callbacks per hour. Alerts are
de-duplicated per key for an hour.

## Kill switches

| Switch                         | Effect                                                                                                      | How                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS_DISABLED=1` (app env)  | Every agent run and agent tool call is denied by policy; cron tick becomes a no-op                          | Set and redeploy/restart                                                                                                        |
| Workspace agents paused        | Same, for one workspace                                                                                     | Operations inbox → settings (owner/admin), or `update workspace_agent_settings set agents_paused = true where workspace_id = …` |
| `FEATURE_FLAG_SDR_ENABLED` off | Publish/schedule return 503 `DISTRIBUTION_DISABLED`; nothing is marked published; the UI hides the controls | Unset and restart. Per workspace: `FEATURE_FLAG_SDR_ENABLED_WS_<id>`                                                            |
| Stop all cron jobs             | Scheduler, reconcile, agents, ops-watch stop                                                                | `select cron.unschedule(jobname) from cron.job where jobname like 'mellox-%';`                                                  |
| AI spend                       | Lower ceilings without a deploy                                                                             | `PLAN_<ID>_DAILY_USD` / `_MONTHLY_USD`, `AI_USER_DAILY_USD` (see `src/server/plans.ts`)                                         |

At 80% of a ceiling users see a warning (`X-Usage-Warning`); at 100% text
generation degrades to a cheap model with a 1 000-token cap, and image/video
return 429 until the period resets.

## Cron and Vault

Jobs call `public.call_app_hook(path)`, which reads `mellox_app_base_url` and
`mellox_cron_secret` from Vault. Migration `20260911120600` schedules the
`mellox-*` jobs only once both secrets exist.

- **First setup / re-schedule**: [supabase/ENABLE-CRON-JOBS.sql](../supabase/ENABLE-CRON-JOBS.sql).
- **A job shows 401**: Vault `mellox_cron_secret` ≠ app `CRON_SECRET`.
- **503**: `CRON_SECRET` unset or < 16 chars on the app.
- **Timeouts**: `mellox_app_base_url` unreachable from Supabase.
- **Legacy jobs**: any job whose command contains a literal header or URL
  (e.g. an old `mellox-run-schedules` built with `net.http_post`) must be
  replaced by STEP 3 of the SQL file — its secret is readable by anyone with
  `cron.job` access. Rotate that secret afterwards.

## Credential rotation

These values were committed to git or stored in plaintext at some point.
Git history keeps them: **rotate all of them**, then update every place that
uses each one.

| Credential                          | Where it was exposed                                  | Rotate by                                        | Also update                                                                            |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `CRON_SECRET`                       | Plaintext in a `cron.job` command on the live project | New random 32+ chars                             | App env **and** Vault `mellox_cron_secret` (`vault.update_secret`), then re-run STEP 3 |
| `SDR_ADMIN_TOKEN` / `SDE_API_TOKEN` | ADR-0005 (history)                                    | New random token                                 | App env and SDR `.env` (must match)                                                    |
| SDR `WEBHOOK_SECRET`                | ADR-0005 (history)                                    | New random secret                                | SDR `.env`; per-workspace webhook secrets are re-issued on reconnect                   |
| SDR `FERNET_KEY`                    | ADR-0005 (history)                                    | New Fernet key                                   | SDR `.env`; stored OAuth tokens must be re-encrypted, or accounts reconnected          |
| SDR Postgres password               | ADR-0005 (history)                                    | `ALTER USER sde PASSWORD …`                      | `POSTGRES_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_SYNC`                               |
| GitHub personal access token        | ADR-0005 (history)                                    | Revoke in GitHub → Settings → Developer settings | Use a deploy key or fine-grained token instead                                         |
| Test account password               | README / launch plan (history)                        | Change the password in Supabase Auth             | `E2E_TEST_PASSWORD` in CI secrets only                                                 |

`node scripts/scan-secrets.mjs` (also a CI job) fails if any of these patterns
come back.

## Migration rollout to an existing project

1. `supabase migration list` — compare local and remote.
2. For each migration whose objects already exist but is not recorded, run
   `supabase migration repair --status applied <version>` (never for one whose
   objects are missing).
3. `supabase db push --dry-run`, review, then `supabase db push`.
4. Verify: new tables exist with RLS (`select relname, relrowsecurity from pg_class …`),
   `select * from cron_heartbeats;`, and `/api/health/ready`.
5. Regenerate types if the schema changed: `npm run db:types`.

All migrations from `20260911120000` onward are idempotent — re-running one is
safe.

## Incidents

**Scheduled posts not going out** — check `cron_heartbeats` for
`run-schedules`, then `net._http_response`. Jobs are claimed with a lease
(`claim_due_scheduled_jobs`, 5 min); a crashed run releases on lease expiry.

**Posts stuck in "publishing"** — `sdr-reconcile` resolves them against the
SDR every 5 min. The Distribution Reliability Worker lists the stale rows and
likely causes in the Operations inbox. It never changes delivery state.

**Webhook rejections spike** — the app and SDR disagree on the secret, a
callback is older than `SDR_WEBHOOK_TOLERANCE_SECONDS` (default 900 s; check
clocks), or someone is forging callbacks. Receipts (no bodies) are in
`sdr_webhook_events`.

**AI answers cut off** — `guardrail_events` with `kind = 'truncation'` show the
route and model. Token budgets per task are in `src/lib/ai-gateway.server.ts`.

**Spend anomaly** — find the workspace in `ai_usage_daily`, then the route in
`ai_usage_events`. Lower that plan's ceiling via env, or pause the workspace's
agents.

## Backups and disaster recovery

- Supabase: daily backups (plan-dependent); enable PITR for production.
- Fresh environment from scratch: apply `supabase/baseline/schema.sql`, then
  every migration newer than the baseline manifest, then Vault secrets and
  cron.
- Redis holds only cache — losing it costs money (cache misses), not data.
