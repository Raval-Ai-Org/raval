# Verification record — 2026-09-12

What was implemented against the **Evolve proposal v2.0** (workstreams A–E, G;
F admin dashboard and H payments explicitly out of scope) and the **Unified
Forensic Audit 2026-09-11**, what was actually verified, and what remains the
owner's to do.

## Automated checks (all green at time of writing)

| Check            | Command                           | Result                                                                                                                |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Types            | `npm run typecheck`               | clean                                                                                                                 |
| Lint             | `npx eslint . --max-warnings 400` | exit 0 (2 pre-existing errors under the cap's file set, 416 warnings — the legacy `any`/unused backlog)               |
| Format           | `npm run format:check`            | clean                                                                                                                 |
| Tests            | `npm test`                        | **472 passed / 57 files**                                                                                             |
| Production build | `npm run build`                   | success                                                                                                               |
| Migration replay | `npm run db:verify`               | 36 migrations on an empty DB; 10 post-baseline migrations re-applied idempotently; **33 public tables, all with RLS** |
| Types generated  | `npm run db:types`                | regenerated from the replayed schema                                                                                  |
| Baseline         | `npm run db:baseline`             | `supabase/baseline/schema.sql` rewritten                                                                              |
| Secret scan      | `node scripts/scan-secrets.mjs`   | clean across 693 tracked files                                                                                        |
| SDR tests        | `pytest -q`                       | **237 passed**                                                                                                        |
| SDR lint         | `ruff check app tests`            | clean                                                                                                                 |

New test coverage added by this work: tenant isolation (73 PGlite RLS cases),
agent control plane (24), AI platform (25), guardrails (13), env/cron/ops-watch
(16), plus SDR claim/webhook/tenancy suites.

## Verified in a browser (dev server, port 8081)

- Security headers present on page responses: CSP (with `frame-ancestors
'none'`, `object-src 'none'`, explicit `connect-src`), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, COOP, `Permissions-Policy`.
- Landing page and `/login` render with **no console errors** and no CSP
  violations.
- Authenticated APIs return 401 unauthenticated: `/api/usage`,
  `/api/agents/findings`, `/api/sdr/status`.
- Cron hooks return 401 without the shared secret: `run-schedules`,
  `agents-tick`, `ops-watch`.
- `/api/health` 200 (liveness). `/api/health/ready` correctly distinguished
  `database: ok` from `scheduler: unavailable (migrations pending?)` while the
  new tables were still missing — a pending migration no longer looks like an
  unreachable database.

## Live database — migrations applied 2026-09-12

The remote migration history recorded only `20260910010000`, while the database
actually contained objects from several later migrations. Rather than trust
either side, each candidate migration was probed read-only for a marker object
before anything was changed.

1. **51 versions repaired** (`migration repair --status applied`): everything
   through `20260907120000`, plus `20260910070000` and `20260910080000` —
   objects confirmed present. This rewrites only the history table.
2. **16 migrations pushed** (`db push --include-all`, dry-run reviewed first):
   `20260907150000`, `20260910020000`–`20260910060000`, `20260911000000`,
   `20260911000100`, `20260911090000`, and `20260911120000`–`20260911120600`.
   The five trigger/policy migrations whose state REST cannot observe were
   pushed rather than repaired: each is written `DROP … IF EXISTS` +
   `CREATE OR REPLACE`, so re-applying is safe and leaves the state known.
3. **Verified after the push**: `scheduled_jobs.locked_at`, `api_rate_limits`,
   `ai_usage_events`, `ai_usage_daily`, `guardrail_events`,
   `sdr_webhook_events`, `cron_heartbeats`, `agent_run_steps`,
   `agent_action_requests`, `agent_findings`, `workspace_agent_settings` and
   `agent_runs.worker` all respond. `supabase migration list` now shows **zero**
   local-only migrations.

## Not verified here (needs the live environment)

- **Cron jobs are still inert.** `20260911120600` is guarded: it schedules
  nothing until the Vault secrets `mellox_app_base_url` and
  `mellox_cron_secret` exist, and they do not yet. The live project also still
  has a legacy `mellox-run-schedules` job whose command embeds the secret in
  plaintext — it must be replaced (ENABLE-CRON-JOBS.sql STEP 3) and that secret
  rotated. `cron.job` is not readable over REST, so this was not verified from
  here.
- **Redis, Sentry, alert webhook**: not configured locally, so the shared cache
  (falls back to in-process LRU), error reporting and alert delivery were
  exercised only through unit tests.
- **Real provider calls** (OpenRouter/Anthropic/KIE/DataForSEO) were not made;
  metering, budgets and truncation handling are covered by injected-dependency
  tests.
- **The VPS stack** (`docker-compose.yml`, `Caddyfile`, `deploy/*.sh`) is not
  exercised — no Docker on the build machine. It is written to the documented
  procedure but its first run should be on a throwaway server.
- **SDR service deployment**: code changes are tested (SQLite); deploying them
  is separate (ADR-0005).

## Owner's remaining actions

1. **Rotate every credential** in the runbook's rotation list. Several were
   committed to git history; the files are clean now but history is not.
2. Set the Vault secrets and re-schedule cron (ENABLE-CRON-JOBS.sql) — the
   migrations themselves are now applied.
3. Set `REDIS_URL`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL` in production.
4. Provision DNS/server if moving to the VPS topology; otherwise keep Railway.
5. Deploy the updated SDR service.

## Known gaps deliberately left

- Payments (workstream H) and the admin dashboard (workstream F) — out of
  scope by instruction. The Caddyfile reserves an admin subdomain block.
- Autonomous publishing is intentionally not implemented; both workers are
  read-only or approval-gated (ADR-0007).
- Reach/engagement analytics are shown as "not connected" rather than
  estimated — the fabricated figures were removed, not replaced.
- The eslint warning backlog (416) and the two remaining errors predate this
  work and are capped, not fixed.
