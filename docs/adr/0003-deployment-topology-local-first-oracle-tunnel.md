# ADR-0003: Deployment Topology — Local-First, Oracle Free + Cloudflare Tunnel, Netcup Fallback

- **Status:** Accepted
- **Date:** 2026-08-08
- **Feature:** 001-sdr-integration
- **Context:** The SDR is an always-on service (FastAPI + Celery worker/beat + Redis + Postgres). It cannot run serverless: Celery's worker and beat must run 24/7, which no managed free PaaS supports. Meta requires a verified business domain for FB/IG OAuth callbacks, and the SDR must be reachable from RavalAI's Cloudflare Workers to proxy publish/schedule and receive webhook delivery. The team is 2 people with a disk-tight local machine, so cost, portability, and minimal maintenance are the deciding constraints.

## Decision

Run the SDR **locally for development**, and deploy it in production as Docker Compose on **Oracle Always Free ARM** behind a **Cloudflare Tunnel** on a real domain, with a **Netcup VPS** as a one-command paid fallback:

- **Phase 0 (local):** `docker compose up -d` or venv on the developer machine; DryRun smoke test (`specs/001-social-sde/demo/run-demo.sh`) validates all adapters without external accounts.
- **Production:** Docker Compose on Oracle Always Free ARM (2 OCPU/12GB — halved Jun 2026, still fits the 5-container stack) → Cloudflare Tunnel on a real domain (Meta requires the verified domain).
- **Backups + monitoring:** nightly `pg_dump` → OCI Object Storage; UptimeRobot on `/healthz`; CORS locked down (`CORS_ORIGINS`); Flower access gated.
- **Fallback:** Netcup VPS 500 G12 (~$5.40, Singapore) — the same `docker compose up -d` + `alembic upgrade head` restores the service, so Oracle free-tier changes/reclaims are a one-command migration.

## Consequences

### Positive

- **Free-tier viable**: Oracle ARM meets the Celery 24/7 + Postgres + Redis requirements at zero recurring cost; backups live in OCI object storage.
- **Portable**: identical compose file on Oracle and Netcup means a host change is `docker compose up -d` + restore dump, not a rebuild.
- **Real-domain webhooks**: Cloudflare Tunnel gives a stable public URL that Meta accepts for FB/IG callbacks and that RavalAI can reach for webhook verification.
- **Observable**: `/healthz` covers DB + Redis + worker; UptimeRobot pings it; `delivery_logs` is the audit trail.

### Negative

- Oracle free tier can change/reclaim at any time (mitigated: portability + backups + the paid fallback kept ready).
- Cloudflare Tunnel adds a network dependency on Cloudflare's edge (accepted — it's already the app's platform).
- OCI object storage + UptimeRobot are extra accounts to manage for a 2-person team (accepted — they're free/cheap and standard).

## Alternatives Considered

- **Serverless (Workers/containers)**: impossible — Celery worker + beat need an always-on host; verified against current offerings.
- **Managed free Postgres/Redis (Neon, Render, Upstash)**: Neon suspends always-awake workloads (~day 17), Render free Postgres hard-expires at 30 days, Upstash free Redis dies to Celery idle polling — all rejected.
- **Paid PaaS at launch (Fly/Render/Railway)**: deferred — the portability hedge (Oracle free + Netcup fallback) makes free safe now; can move later without a redesign.

## References

- Feature Spec: `specs/001-sdr-integration/spec.md` (Phase 0 assumption, rollout phases)
- Implementation Plan: `specs/001-sdr-integration/plan.md` (decision D8, Rollout Phase 4)
- Research: `specs/001-sdr-integration/research.md` §6 (deployment, merged from PHR 004)
- Quickstart: `specs/001-sdr-integration/quickstart.md`
- Evaluator Evidence: `history/prompts/social-distribution-engine/004-sdr-deployment-deep-dive-recommendation.plan.prompt.md`
