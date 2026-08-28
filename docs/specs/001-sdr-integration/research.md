# Research: RavalAI × SDR Integration

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08

Research for this feature was performed via a **codebase audit of both repositories** (SDR: `app/api/*`, `app/schemas.py`, `app/services/*`, `app/adapters/*`, `specs/001-social-sde/integration/*`; RavalAI: `src/routes/*`, `src/lib/*`, `src/components/app/*`, `supabase/migrations/*`) and a **live-deployment research sweep** (PHR 004). Every claim below was verified against code or current vendor data — nothing is assumed.

## 1. Integration topology

- **Decision**: Proxy-through-server — the browser never calls the SDR. RavalAI server functions validate the Supabase JWT + workspace RLS, then proxy to the SDR with a per-workspace Bearer key. The SDR pushes delivery status back via HMAC-signed webhooks.
- **Rationale**: keeps SDR credentials out of the browser (spec FR-014), preserves RLS workspace isolation (FR-013), gives one auditable choke point for idempotency, and keeps the two services independently deployable.
- **Alternatives considered**:
  - Direct browser→SDR: exposes per-workspace keys, no RLS, breaks isolation — rejected.
  - Shared Supabase DB: couples data planes, violates the SDR's own-DB "build for extraction" doctrine — rejected.
  - Merging SDR into `raval/`: one failure domain, kills service independence — rejected.
- **Evidence**: RavalAI is TanStack Start on **Cloudflare Workers** (`wrangler.jsonc`, `main: src/server.ts`), server code = `createServerFn` + file routes (`src/routes/api.*.ts`), server auth helpers in `src/server/api-auth.ts` (`requireUserId`, `jsonError`, `assertPublicUrl`). SDR is FastAPI + Celery + Redis + Postgres with a clean REST contract.

## 2. SDR contract surface (verified)

- Auth: `Authorization: Bearer <token>`; per-workspace keys hashed (SHA-256) in `api_keys`, matched in `deps.py:92-101`. The global `SDE_API_TOKEN` grants the default workspace — **must not be used for tenant traffic** (SDR FR-MT-02).
- Publish: `POST /api/v1/publish` body `{idempotency_key, scheduled_at, targets:[{account_id, content:{text, media_urls, metadata}}]}` → 201 `{job_id, status, targets[]}`; 409 on duplicate idempotency key. **Immediate publish runs in the HTTP handler** (`publish.py:77`) — a known gap to fix (queue it).
- Schedule: `POST /api/v1/schedule` (scheduled_at required, ≤1 year out, UTC). Celery beat (30s tick, `FOR UPDATE SKIP LOCKED`) claims due targets.
- Jobs: `GET /api/v1/jobs/{id}`, `GET /api/v1/jobs?status&limit&offset`, `DELETE /api/v1/jobs/{id}` (cancel only pending/retrying).
- Accounts: `GET /api/v1/accounts`, `DELETE /api/v1/accounts/{id}` (soft-delete).
- OAuth: `GET /api/v1/oauth/{platform}/start` (twitter PKCE, linkedin w_member_social, facebook/instagram Meta dialog), `GET /api/v1/oauth/{platform}/callback` (stores Fernet-encrypted tokens). **Callback currently returns JSON, not a redirect** — needs a `redirect_after` bounce to the host.
- Webhooks-out: `POST /api/v1/webhooks/config` (per-workspace URL + secret), events `post.published` / `post.failed` / `post.retrying` / `account.expired`, signed `X-Signature-256` = `sha256=<hex>` of HMAC-SHA256 over `POST|/webhook|<body>` (`webhook_out.py:148-153`). Single-shot (no retry loop — `MAX_RETRIES` unused).
- Keys: `POST /api/v1/admin/api-keys` (gated by the global token) → raw key shown once.
- DryRun: activated by account platform `"dryrun"` or an unregistered platform; magic strings `FORCE_429/401/500/FATAL` (`dryrun.py`).
- Adapters: all four real (twitter v2, linkedin UGC, meta Graph, instagram container→publish). Media is **downloaded from URLs at publish time** (`twitter.py:262`, `meta.py:168`, `linkedin.py:288`). Instagram requires exactly one media.

## 3. RavalAI integration points (verified)

- Publish is a pure DB status flip in three sites: `StudioCanvasModal.tsx:891-922` (publish now), `:850-889` (schedule), `StudioRail.tsx:465-478` (approve→publish). Status enum `draft|pending|approved|rejected|scheduled|published` (`content.functions.ts:36-43`).
- `content_items` has `meta jsonb` (free-form, already stores `{source, platform, prompt, chars}`) and single `media_url`; **no external job-id / published-url / per-platform columns** — new `content_publications` mirror needed.
- Facebook variants are collapsed to channel `"web"` (`StudioCanvasModal.tsx:569-571`) — must be fixed so FB posts stay FB.
- Server-route template: `src/routes/api/public/hooks/run-schedules.ts` (secret-guarded, `timingSafeEqual`) — the pattern for the SDR webhook receiver.
- `content_items` has `REPLICA IDENTITY FULL` — Supabase realtime already available for live status updates.
- Supabase `service_role` client is server-only (`client.server.ts`) — the correct vehicle for reading `workspace_sdr` without exposing it to the user client.
- ⚠️ Divergent `20260707*` migrations redefine `content_items` with a different shape — reconcile before schema work.

## 4. Media URL durability (researched)

- **Decision**: media handed to the SDR must be a **durable public URL** reachable at fire time (for scheduled posts: minutes–days later). Do not pass short-lived signed URLs.
- **Rationale**: every adapter downloads media at publish time; an expired signed URL = silent delivery failure.
- **Options**: (a) public bucket URL (simplest, chosen); (b) server-side re-signing proxy that issues long-lived or re-signed URLs at submit time; (c) upload media bytes to the SDR once at submit time (larger change — not chosen for v1).
- **Instagram constraint**: exactly one image required — the picker must guide text-only IG posts to attach media before submit (FR-020).

## 5. Webhook verification pattern (researched)

- **Decision**: verify HMAC-SHA256 with constant-time compare (`timingSafeEqual`) against the workspace's stored webhook secret; reject unverified; apply idempotently (upsert `content_publications` on `(content_item_id, sdr_target_id)`).
- **Rationale**: an open receiver is a state-corruption surface (spec FR-021/SC-009); the SDR already signs every delivery.
- **Reconciliation backstop**: a periodic sweep flips stale `publishing` items to a definitive state (FR-018) — never trust an unsigned callback.

## 6. Deployment (merged from PHR 004 research)

- **Decision**: Phase 0 runs the SDR locally. Production: Docker Compose on **Oracle Always Free ARM** (~2 OCPU/12GB, halved Jun 2026, still fits the 5-container stack), **Cloudflare Tunnel** on a real domain (Meta requires a verified business domain for FB/IG callbacks), nightly `pg_dump` → OCI Object Storage, UptimeRobot monitoring. One-command migration to **Netcup VPS 500 G12 (~$5.40, Singapore)** as the paid fallback.
- **Why not serverless for the SDR**: Celery worker + beat must run 24/7; Vercel/Cloudflare Containers cannot host them (verified). No managed-PaaS free tier runs Celery 24/7 in 2026 (verified).
- **Why not free managed Postgres/Redis**: Neon suspends always-awake workloads (~day 17), Render free Postgres hard-expires at 30 days, Upstash free Redis dies to Celery idle polling (~86K cmd/day/consumer) — all verified. Postgres lives in the SDR's own Docker volume; Redis self-hosted on the same host.

## 7. SDR-side fixes required (isolated, verified against code)

1. Queue immediate publish (`publish.py:77` runs platform calls in the HTTP handler) — enqueue to the existing `scheduler.process_target` path.
2. OAuth callback `redirect_after` bounce to the host platform (callback currently returns JSON).
3. Instagram worker token format (`ig_user_id|token`) + an IG refresh strategy (`scheduler_tasks.py:266-286`, `:738`).
4. Webhook retry loop (honor `MAX_RETRIES=3`).
5. CORS lockdown (`main.py:86` `*`).
