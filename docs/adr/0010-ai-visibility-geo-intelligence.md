# ADR-0010: AI Visibility — port the GEO-Module into Mellox as durable scans

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

Mellox shipped a single-page GEO audit: `/api/geo-audit` fetched the homepage,
robots.txt, sitemap and llms.txt, scored 45 checks, and the browser kept the
result in localStorage and inserted the score into `geo_audit_runs` itself.

A separately developed **GEO-Module** existed as a Python/FastAPI backend
(~125k lines): multi-page crawler, rich page extraction, content/AEO analyzers,
trust/authority/claim engines, explainable scoring, recommendations, fix safety
tiers and AI answer mention/citation detection. It had no UI, no
authentication, no tenancy, SQLite via `create_all`, synchronous crawls inside
HTTP requests, an SSRF validator the crawler never used, and a queue and
scheduler that nothing ran.

## Decision

1. **Port, don't run a sidecar.** The valuable code is deterministic heuristics;
   it was ported to TypeScript (`src/lib/geo`) on Mellox's own safe fetch,
   Supabase, RLS, route kernel, rate limits, plan limits and AI gateway. A
   Python service would have meant a second deploy, a second database and new
   auth and tenancy for FastAPI.
2. **One engine, one surface.** The 45-point audit's checks became rules in the
   same catalog; `/api/geo-audit` was removed and the AI Visibility dialog is the
   single UI (quick homepage check or full site scan).
3. **Durable scans without new infrastructure.** `geo_scans` rows with a lease
   (`claim_geo_scans`, SKIP LOCKED), time-boxed resumable slices, a one-minute
   pg_cron hook, and `after()` for immediate start — the same shape as
   `studio_jobs` and `scheduled_jobs`.
4. **Server-computed scores only.** The worker writes findings and
   `geo_audit_runs`; the browser INSERT policy was dropped.
5. **Validation = rescan + fingerprint diff**, replacing the module's simulated
   before/after validation.
6. **Paid AI probes are flagged off** (`FEATURE_FLAG_GEO_AI_PROBES_ENABLED`) and go
   through the metered, budget-checked OpenRouter gateway.
7. **Not ported:** orchestration layer, lab, and GitHub/WordPress auto-apply
   connectors (no approval/rollback surface exists yet).

## Consequences

- Scans survive restarts and deploys and never hold a request open for a crawl.
- Findings, page evidence and history are queryable per workspace under RLS.
- Crawl volume is bounded by plan page caps, a `geo-scan` rate tier and one
  active full scan per workspace.
- The Python GEO-Module folder is no longer needed at runtime.
- On serverless hosts without long `after()` execution, full scans progress one
  cron slice per minute.
