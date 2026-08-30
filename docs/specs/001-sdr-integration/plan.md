# Implementation Plan: RavalAI × SDR Integration

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-sdr-integration/spec.md`

## Summary

Integrate the **Social Distribution Engine (SDR)** — an existing standalone FastAPI + Celery + Redis + PostgreSQL service that publishes to LinkedIn, X, Facebook, and Instagram — into the **RavalAI platform** (TanStack Start + Supabase on Cloudflare Workers). The user publishes approved content from the Studio to one, some, or all connected brand accounts; the SDR owns platform authorization, token storage, delivery execution, and retries; RavalAI owns editorial state, the Connections view, the destination picker, and a webhook-fed per-platform delivery view. Coupling is **contract-only**: RavalAI server functions proxy to the SDR over HTTPS with a per-workspace Bearer key, and the SDR pushes delivery status back to a RavalAI webhook receiver that verifies an HMAC signature before applying any state change. Rollout is phased and feature-flagged so the platform never regresses.

## Technical Context

**Language/Version**: TypeScript (React 19, TanStack Start/Router/Query) on the RavalAI side; Python 3.12 (existing) on the SDR side — **no changes to SDR runtime**.
**Primary Dependencies**: `@supabase/supabase-js` (server + client), TanStack server functions (`createServerFn`) and file routes (`createFileRoute` server handlers), Node `crypto` (`timingSafeEqual`, `createHmac`) for webhook verification, `httpx`/server-side `fetch` for SDR proxying.
**Storage**: Supabase PostgreSQL (RavalAI) — two new tables (`workspace_sdr`, `content_publications`), one enum value added to `content_items.status`, `meta` jsonb extensions; the SDR keeps its own PostgreSQL (accounts, posts, post_targets, api_keys, webhook_endpoints, delivery_logs) — **untouched schema**.
**Testing**: Vitest (unit: idempotency, HMAC, validation, status transitions), Playwright (e2e: connect/publish/schedule against a local dry-run SDR), SDR's existing pytest suite (regression on the SDR-side fixes). TDD red→green→refactor per task.
**Target Platform**: Cloudflare Workers (server functions + webhook receiver; `nodejs_compat` already enabled) + browser (Studio) + Dockerized SDR service (dev/local + Oracle/Netcup).
**Project Type**: Web application (single TanStack app with server functions) + one external always-on service (SDR).
**Performance Goals**: publish submit returns fast (optimistic UI); confirmed "Published" + live link ≤60s (SC-002); scheduled posts fire within 5min ≥99% when healthy (SC-004); the Studio reflects delivery changes without manual refresh.
**Constraints**: SDR credentials never reach the browser (FR-014); every delivery callback verified before applying state (FR-021); publish idempotent (FR-006/SC-003); media URLs durable at fire time (FR-019/SC-010); backward-compatible — all existing Studio flows unchanged during rollout (FR-017/SC-007); Cloudflare Workers has no persistent process, so all RavalAI-side work is request-triggered (the SDR holds the scheduler).
**Scale/Scope**: multi-tenant; N workspaces × up to 4 platforms × multiple accounts each; delivery volume = client posting cadence (low-to-moderate; thousands of posts/month).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after design._

Gates drawn from the project's governing rules (CLAUDE.md Rule 1–25 + default policies):

| Gate                                                               | Status  | Justification                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Specification is source of truth (Rule 12)                         | ✅ PASS | plan.md implements spec.md exactly (US1–5, FR-001..028, SC-001..010); no scope additions                                                                                                        |
| Surgical changes / smallest viable diff (Rule 3, default policies) | ✅ PASS | RavalAI changes are additive (2 tables, 1 enum value, new server fns/routes, new components, 3 call-site edits); SDR changes are isolated fixes; no refactors of unrelated code                 |
| Backward compatibility (Rule 15, SC-007)                           | ✅ PASS | real publish is feature-flagged; all existing flows degrade to current behavior when SDR is unreachable or flag is off                                                                          |
| Security by default (Rule 13, FR-014/021)                          | ✅ PASS | per-workspace keys server-only; HMAC-verified webhooks; RLS on all new tables; no secrets in client                                                                                             |
| No invented APIs/contracts (default policies)                      | ✅ PASS | all SDR endpoints verified against the SDR codebase (`app/api/*`, `app/schemas.py`); RavalAI patterns verified (`api.social-multi.ts`, `run-schedules.ts`, `api-auth.ts`)                       |
| Single source of truth (Rule 16, FR-027)                           | ✅ PASS | platform limits sourced from the SDR's authoritative capabilities; editorial state (RavalAI) vs distribution state (SDR) separated, with `content_publications` as a webhook-driven mirror only |
| Idempotency + error handling (Rule 6, FR-006/016)                  | ✅ PASS | idempotency key derivation + retry taxonomy designed in §Idempotency & Failure Handling                                                                                                         |
| Observability (Rule 19)                                            | ✅ PASS | SDR `delivery_logs` = audit trail; RavalAI logs proxied calls + webhook receipts; status visible in Studio                                                                                      |
| Test edge cases (Rule 24)                                          | ✅ PASS | extreme edge-case matrix in §Edge Cases; TDD coverage in §Testing                                                                                                                               |
| Dependency discipline (Rule 21)                                    | ✅ PASS | no new npm deps required; uses existing server-fn + `crypto` patterns                                                                                                                           |
| Complexity justified (Rule 2/22)                                   | ✅ PASS | proxy layer + mirror table are the minimum structure for security + separation (see Complexity Tracking)                                                                                        |

All gates PASS — no violations requiring justification.

## Architecture

### Topology (decided)

Two independent services, contract-only coupling. **Not** microservices, **not** a merge — the correct 2-system shape for the SDR's own "modular monolith + build-for-extraction" doctrine.

```text
Browser (Studio, Supabase JWT + RLS)
   │
   ▼  (server fns carry the user's Supabase Bearer; middleware attaches it)
TanStack server function / file route (Cloudflare Worker)   ◄── src/lib/sdr.server.ts
   │  validates user + workspace (RLS via user-scoped client)
   │  reads per-workspace SDR key from workspace_sdr (service-role only)
   ▼
SDR  POST /api/v1/publish · /schedule · /jobs/{id} · /accounts · /oauth/{p}/start · /webhooks/config · /admin/api-keys
   │  (Bearer: per-workspace key, never the global token)
   ▼
SDR adapters → LinkedIn / X / Facebook / Instagram APIs → post live
   │
   ▼
SDR webhook (HMAC-SHA256, X-Signature-256) ──► raval: /api/public/hooks/sdr
   │  verify signature → upsert content_publications → set content_items.status
   ▼
Supabase realtime (content_items already REPLICA IDENTITY FULL) ──► Studio updates without refresh
```

### Key decisions (with alternatives considered)

| Decision                                                                           | Rationale                                                                                                                                                                                                                                                        | Alternatives rejected                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 — Proxy-through-server** (browser → server fn → SDR)                          | SDR keys never in browser (FR-014); server fn re-validates Supabase JWT + workspace RLS before any outbound call; gives one choke point for audit + idempotency                                                                                                  | (a) direct browser→SDR: exposes per-workspace keys to the client, no RLS, breaks isolation — **rejected**; (b) shared Supabase DB between RavalAI and SDR: couples data planes, violates SDR's own-DB doctrine and build-for-extraction — **rejected**; (c) merge SDR into `raval/`: one failure domain, kills service independence — **rejected** |
| **D2 — Per-workspace SDR credential**                                              | Minted once via `POST /api/v1/admin/api-keys` (using server-only `SDR_ADMIN_TOKEN`), stored encrypted in `workspace_sdr` (service-role only), never the SDR global token (satisfies SDR FR-MT-02)                                                                | single shared key: no per-tenant isolation/audit — **rejected**; client-held keys: insecure — **rejected**                                                                                                                                                                                                                                         |
| **D3 — HMAC-verified webhook receiver**                                            | SDR signs `POST\|/webhook\|body` with the workspace's secret (`webhook_out.py:148-153`); receiver verifies with `timingSafeEqual` before applying anything (FR-021); apply is idempotent upsert                                                                  | unverified endpoint: anyone can flip post status — **rejected**; polling only: slower, weaker consistency — **rejected as primary** (reconciliation still added as a backstop)                                                                                                                                                                     |
| **D4 — Split scheduling**                                                          | RavalAI `scheduled_jobs`+pg_cron = content **generation** (unchanged, untouched); SDR = distribution **timing** via `POST /schedule` with an absolute UTC instant; `content_items.scheduled_at` remains the display source of truth                              | double-scheduling social posts through both systems — **rejected** (two schedulers = double-post risk)                                                                                                                                                                                                                                             |
| **D5 — Additive data model**                                                       | `workspace_sdr` + `content_publications` + one enum value; no destructive changes; reconcile the divergent `20260707*` migrations before adding columns                                                                                                          | reusing `content_items.meta` only: loses per-platform delivery queryability and audit shape — **rejected**; migrating SDR state into RavalAI — **rejected**                                                                                                                                                                                        |
| **D6 — Media URL durability**                                                      | Media handed to SDR must be fetchable at fire time (FR-019); use durable public URLs (public bucket or re-signed proxy), never short-lived signed URLs for scheduled posts                                                                                       | passing short-lived signed URLs: scheduled image posts break at fire time — **rejected**                                                                                                                                                                                                                                                           |
| **D7 — Approval gate**                                                             | Publish/schedule only from `approved` (or higher) content; the explicit user click is the consent (FR-024) — mirrors the SDR approval-boundary doctrine                                                                                                          | auto-publish on approval: violates the approval boundary — **rejected**                                                                                                                                                                                                                                                                            |
| **D8 — Deployment: local-first, Oracle free + Cloudflare Tunnel, Netcup fallback** | Phase 0 runs the SDR locally (dry-run); production deploys Docker Compose on Oracle Always Free ARM (Singapore/Mumbai) behind Cloudflare Tunnel on a real domain, `pg_dump`→object storage + UptimeRobot; one-command migration to Netcup (~$5.40, SG) if needed | serverless for the SDR — **impossible** (Celery worker/beat need an always-on host); paid PaaS at launch — deferred (portability hedge makes free safe)                                                                                                                                                                                            |

### Interfaces & integration contract

- **RavalAI-internal server surface** (new, all in `raval/`): see [contracts/sdr-proxy.md](./contracts/sdr-proxy.md).
- **SDR → RavalAI webhooks**: see [contracts/sdr-webhook.md](./contracts/sdr-webhook.md).
- **SDR external surface**: unchanged and authoritative — the SDR repo's `app/api/*`, `app/schemas.py`, and `specs/001-social-sde/integration/INTEGRATION.md` are ground truth (the SDR's `openapi.yaml`/`quickstart.md` are superseded design intent and are NOT used as the contract).
- **Full RavalAI server surface covers every FR**: `POST /api/sdr/oauth/start` (connect **and** reconnect — FR-001/FR-004), `GET /api/sdr/accounts` (FR-002), `POST /api/sdr/disconnect` (FR-003), `POST /api/sdr/publish` (FR-005/006), `POST /api/sdr/schedule` (FR-008), `GET /api/sdr/jobs/{id}` (reconciliation), `POST /api/sdr/cancel` (FR-009), and the webhook receiver `POST /api/public/hooks/sdr` (FR-021). All specified in [contracts/sdr-proxy.md](./contracts/sdr-proxy.md).

**Destination-picker behavior (FR-007 / FR-028, US2):** the publish picker shows, per platform: connected accounts (toggleable individually or by platform), **unconnected-but-supported platforms → disabled chip + inline Connect** (opens `oauth/start`, FR-007), and **undeliverable platforms (Threads/TikTok/YouTube) → "Not available", never offered as targets** (FR-028). Unconnected/undeliverable selections never block publishing to connected destinations.

**Timezone rule (FR-025):** the Studio schedule control accepts and displays local time in the user's timezone; the value is stored as an absolute instant (`timestamptz` on `content_items.scheduled_at`); the SDR receives an ISO-8601 UTC instant. No timezone ambiguity in storage or on the wire.

**Schedule UI (FR-008/FR-009):** scheduled items get a **cancel affordance** in the calendar and Recent views (calls `POST /api/sdr/cancel`, FR-009); reschedule reuses the existing drag-drop `rescheduleContentItem`, wired as cancel-old + schedule-new. Server validates `scheduled_at` ≤ 1 year out (the SDR's schedule cap) with a clear message otherwise.

**Publish naming (US2 UX clarity):** the social **Publish** action (the canvas destination step) is distinct from the existing app-deploy "Publish" in the Share menu (`PublishDialog.tsx`, which deploys the RavalAI app). The social publish is wired only in the social-post canvas + approval rail, and the UI labels it as distributing the post — never confused with app deployment.

**Error taxonomy (RavalAI server → Studio):**

| SDR category                                   | RavalAI handling                          | Studio UX                             |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| `transient` / `rate_limit` (429, 5xx, timeout) | retry via SDR backoff; surface "Retrying" | status chip Retrying + timing         |
| `auth` (401/403, expired token)                | mark account Expired; never retry         | "Reconnect required" + inline Connect |
| `fatal` / `media` (4xx, invalid content)       | permanent; surface reason                 | actionable error + edit/republish     |
| validation (422)                               | pre-validate server-side (FR-027)         | warning before submit                 |

## Data Model

Additive only. Full detail in [data-model.md](./data-model.md). Summary:

- **`workspace_sdr`** — workspace_id (PK/FK), sdr_workspace_id, encrypted_api_key, webhook_secret, sdr_base_url, status, timestamps. **RLS: no `authenticated` policies** — readable only by service-role (server routes), so keys are never browser-accessible (FR-014).
- **`content_publications`** — id, workspace_id, content_item_id (FK), sdr_post_id, sdr_target_id, platform, account_id, status (`pending|publishing|published|failed|retrying|cancelled|partial_failed`), platform_post_id, platform_post_url, error_category, last_error, attempt, delivered_at, timestamps. **UNIQUE (content_item_id, sdr_target_id)** for idempotent webhook apply. RLS: workspace members read (their own), service-role write.
- **`content_items.status`** — add `publishing` (in-flight). Editorial states unchanged. Migration = `ALTER TYPE ... ADD VALUE 'publishing'`; **all status-filtering UI must handle it** (ContentCalendar filter, StudioRail Scheduled/Recent sections, StudioCanvasModal state chips) so an in-flight item renders as "Publishing…" and is never mis-grouped as failed/scheduled.
- **Realtime for delivery view (R2d)**: `content_publications` is NOT added to the realtime publication set. Instead the client re-fetches publications via a server fn when it observes a `content_items` status change (the existing `content:changed` event / realtime on `content_items`). Simpler than adding a new replication surface, and satisfies US4 "status updates without manual refresh" (SC-002).
- **`content_items.meta`** — add `sdr_job_id`, `sdr_revision` (for D4/D5 republish semantics).
- **Fix (pre-schema, FR-026):** (a) reconcile divergent `20260707*` migrations (`20260707193010_*.sql` etc.) that redefine `content_items` with a different shape, before adding any column; (b) fix the `facebook → "web"` channel collapse in `StudioCanvasModal.tsx:569-571` so a Facebook variant keeps `channel`/`platform` identity as `facebook` end-to-end, and render it correctly in the content calendar and Recent views. Without (b), Facebook publishing is impossible (spec US2.1 / FR-026).

## Security Model

- **Credentials**: per-workspace SDR API key + webhook secret stored encrypted in `workspace_sdr`, service-role-only. `SDR_ADMIN_TOKEN`, `SDR_BASE_URL` in server-only env (never `VITE_*`). No secrets cross the browser (FR-014).
- **AuthN/AuthZ**: every server fn/route re-validates the Supabase JWT (`requireUserId` / `requireSupabaseAuth`) and relies on RLS (`is_workspace_member`) for workspace scoping; the SDR key is looked up per workspace server-side (FR-013).
- **Webhook integrity**: HMAC-SHA256 verification with constant-time compare; reject unverified (FR-021); replay/idempotent apply; reconcile stale `publishing` via a periodic sweep (FR-018) — never by trusting an unsigned callback.
- **SSRF**: webhook receiver and any outbound fetch validate public URLs (`assertPublicUrl`), mirroring `run-schedules.ts`'s `CRON_SECRET` guard pattern.
- **Approval boundary**: publish/schedule require explicit user action on approved content (D7 / FR-024); the SDR never auto-publishes without a request.

## Idempotency & Failure Handling

- **Idempotency key**: `publish:{content_item_id}:{platform}:{account_id}:{sdr_revision}`. `sdr_revision` increments whenever a previously-failed post is edited and republished → the SDR treats it as a fresh job (FR-023), never returning the old failed result. Re-submitting the _same_ key returns the existing job (no duplicate — SC-003).
- **Schedule idempotency**: `schedule:{content_item_id}:{platform}:{account_id}:{sdr_revision}`; reschedule = cancel old + schedule new (SDR cancel is only valid for pending/retrying targets).
- **Retry taxonomy**: transient/rate-limit → SDR exponential backoff (60→3600s, `MAX_RETRIES=5`); auth → expire account + Reconnect; fatal/media → permanent + reason surfaced. Webhook misses → **reconciliation** = a pg_cron row invoking `POST /api/public/hooks/sdr-reconcile` (guarded with `CRON_SECRET`, mirroring the existing `run-schedules.ts` pattern — not a Cloudflare cron trigger), sweeping `content_publications` stuck in `publishing`/`pending` >10 min against `GET /api/v1/jobs/{id}` and reconciling to a definitive state (FR-018).
- **Partial success**: per-target status in `content_publications`; overall item status derived (`published` if all, `partial_failed` on mix, `failed` if all failed) — never a blanket success/failure (FR-011).
- **Aggregation guard**: the webhook receiver recomputes `content_items.status` **only for items that have `content_publications` rows / `meta.sdr_job_id`**. Non-social canvases (SEO/email/article/landing) publish through the existing path with no SDR rows and are **never** touched by SDR aggregation — preserves SC-007 non-regression and prevents the receiver clobbering their status.

## Edge Cases (to the extremes)

- **Media URL expires before a scheduled post fires** → SDR download fails → clear retryable failure, never silent drop (FR-019/SC-010).
- **Text-only publish to Instagram** → guided to attach exactly one image before submit (FR-020).
- **Unverified / replayed / duplicate webhook** → rejected or applied idempotently; zero state change from unverified sources (FR-021/SC-009).
- **Account expires mid-publish** → that target fails with "Reconnect required"; other targets still publish (partial success).
- **Cancel race** (cancel just as beat claims the target) → atomic claim + cancel ordering; clean fire-or-cancel, never both.
- **Two team members publish the same item** → same idempotency key → single delivery (last explicit action wins for schedule).
- **Republish after permanent failure** → new `sdr_revision` → fresh job, old failure not returned (FR-023).
- **Distribution service down** → server fn returns actionable error; item stays editable/retryable; content never lost; feature flag degrades to today's mock (US5/SC-008).
- **Threads/TikTok/YouTube variants** → rendered but never offered as publish destinations (FR-028).
- **Facebook variant identity** → preserved end-to-end; never collapsed to another channel (FR-026).
- **Platform limit edge** (X 280 / LinkedIn 3000 / FB 63206 / IG 2200 + media caps) → authoritative server-side pre-validation (FR-027); warnings before submit, not post-rejection.
- **Workspace with 2 accounts on one platform** → account-level selection in the picker (US2 scenario 6).

## Rollout Phases (non-disruptive, flag-gated)

| Phase | Scope                                                                                                                                                                        | Gate to next                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **0** | Stand up SDR locally (venv or `docker compose up` + `alembic upgrade head`); run the DryRun smoke test (`specs/001-social-sde/demo/run-demo.sh`) incl. FORCE_* failure modes | all 4 adapters dry-run pass                                           |
| **1** | Connections view + OAuth connect (read-only; publish still mock)                                                                                                             | connect works end-to-end for LinkedIn + X                             |
| **2** | Real publish behind env flag; degrade to mock when SDR unreachable                                                                                                           | live publish + live link on LinkedIn + X                              |
| **3** | Schedule + webhook confirmation + partial-success surfacing                                                                                                                  | schedule + status verified; **Meta app-review obtained** before FB/IG |
| **4** | Deploy (Oracle free + Cloudflare Tunnel; Netcup fallback) + hardening: CORS lockdown, gate Flower, nightly `pg_dump`, UptimeRobot, reconciliation sweep, SDR-side queue fix  | live E2E across platforms; load/DR drill                              |

## SDR-side fixes (required by this plan; isolated)

1. **Queue immediate publish** — move `publisher.publish()` off the HTTP handler onto the existing `scheduler.process_target` path (returns 202; satisfies the 2–3s UX and SDR's own queue-first doctrine).
2. **OAuth callback redirect** — after storing the account, redirect the browser back to the host platform (accept `redirect_after`); the callback currently returns JSON.
3. **Instagram worker token-format bug** — prefix `ig_user_id|token` in the worker path like `facebook`; add an IG token-refresh strategy so IG accounts don't auto-expire.
4. **Webhook retry loop** — honor the declared `MAX_RETRIES=3`.
5. **CORS lockdown** (`main.py:86` `*`) before any public URL.

## Testing Strategy (SDD + TDD)

- **Unit (Vitest, red→green)**: idempotency-key derivation; `sdr_revision` semantics; HMAC verify (valid/invalid/replay); platform-limit validation; status transition logic (`content_publications` → `content_items.status` aggregation); `workspace_sdr` provisioning.
- **Contract (Vitest + MSW)**: server fns against a mocked SDR (publish 201/409, schedule, jobs, accounts, oauth start); webhook receiver (valid sig → applied; invalid → 400; duplicate → idempotent; expired-media failure mapped).
- **E2E (Playwright)**: connect → publish → live link; schedule → fires → status updates without refresh; degradation with SDR down. Runs against a **local dry-run SDR** (no external accounts needed for CI).
- **SDR regression (pytest)**: existing suite green after the 5 fixes; new tests for queueing, OAuth redirect, IG token format, webhook retry.
- **TDD flow**: each task in `tasks.md` = failing test first → implement → refactor; acceptance scenarios in spec.md are the test oracle.

## Observability & Operations

- SDR: `delivery_logs` (audit), `/healthz` (DB+Redis+worker), structlog, optional Sentry/OTel.
- RavalAI: log every proxied SDR call (request-id, workspace, latency, outcome) + every webhook receipt (verified/unverified); `content_publications` is the queryable delivery truth; Studio reflects via realtime.
- Monitoring: UptimeRobot on SDR `/healthz`; nightly `pg_dump` to object storage; reconciliation sweep alerts on stale `publishing`.
- Runbook: provisioning a workspace (mint key → store → register webhook); reconnecting an expired account; DR = `docker compose up -d` on the fallback host + restore dump.

## Risks & Mitigations

| Risk                                                 | Impact   | Mitigation                                                                                             |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Meta app-review delay blocks FB/IG at launch         | Med-High | launch LinkedIn + X first (Phases 2–3); start Meta review early; FB/IG gate is explicit in Phase 3     |
| Oracle free tier changes/reclaim                     | Med      | portability (one `docker compose up -d` to Netcup); backups + monitoring; keep the paid fallback ready |
| X/Twitter paid developer tier cost                   | Med      | budget Basic tier; dry-run CI avoids live API cost                                                     |
| Divergent `20260707*` migrations corrupt schema work | High     | reconcile migrations before adding columns (pre-schema gate)                                           |
| Webhook loss strands posts in `publishing`           | Med      | reconciliation sweep + alerts (FR-018)                                                                 |

## Spec Traceability (FR/SC → plan coverage)

Every spec requirement is mapped to where this plan satisfies it. Verified complete (2026-08-08) after **two review passes**: the six first-pass gaps (G1–G6) and eight second-pass refinements (R2a aggregation guard, R2b concrete reconciliation, R2c replay mitigation, R2d realtime delivery path, R2e approval-rail behavior, R2f cancel UI + 1-yr cap, R2g `publishing` migration + UI filters, R2h dev-mode polling) were all closed.

| Spec                               | Satisfied by                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| FR-001 connect                     | D2, `POST /api/sdr/oauth/start` (contracts/sdr-proxy.md)                                                           |
| FR-002 display accounts            | `GET /api/sdr/accounts`, Connections view (US1)                                                                    |
| FR-003 disconnect                  | **G1-closed:** `POST /api/sdr/disconnect` (contracts/sdr-proxy.md) → SDR `DELETE /api/v1/accounts/{id}`            |
| FR-004 expired → Reconnect         | **G4-closed:** `oauth/start` reused for expired accounts; `account.expired` webhook; error taxonomy auth→Reconnect |
| FR-005 publish single/platform/all | `destinationSelection` in `POST /api/sdr/publish`                                                                  |
| FR-006 idempotent                  | idempotency key `publish:{item}:{platform}:{account}:{revision}` (SC-003)                                          |
| FR-007 inline Connect, no block    | **G5-closed:** destination-picker behavior (disabled + inline Connect; never blocks connected)                     |
| FR-008 schedule                    | `POST /api/sdr/schedule`, SDR beat (SC-004)                                                                        |
| FR-009 reschedule + cancel         | `POST /api/sdr/cancel` + calendar reschedule                                                                       |
| FR-010 per-destination status      | `content_publications` + webhook receiver (US4)                                                                    |
| FR-011 partial success             | status aggregation (`partial_failed`); per-target rows                                                             |
| FR-012 limits validated visibly    | FR-027 single-source limits; error taxonomy validation                                                             |
| FR-013 isolation                   | D2 per-workspace key + RLS (`is_workspace_member`)                                                                 |
| FR-014 no creds in browser         | D1 proxy-through-server; `workspace_sdr` service-role-only                                                         |
| FR-015 graceful failure            | US5; 503 degrade-to-mock behind flag (SC-008)                                                                      |
| FR-016 retry + permanent surfaced  | retry taxonomy (60→3600s backoff; auth/fatal surfaced)                                                             |
| FR-017 feature flag                | D8 rollout flag (SC-007)                                                                                           |
| FR-018 reconcile stale             | reconciliation sweep backstop (contracts/sdr-webhook.md)                                                           |
| FR-019 media durable               | D6 + media rule (SC-010)                                                                                           |
| FR-020 IG media guidance           | picker pre-flight (IG exactly one image)                                                                           |
| FR-021 verify webhook              | D3 + contracts/sdr-webhook.md (SC-009)                                                                             |
| FR-022 provisioning                | `ensureWorkspaceSdrProvisioning` (idempotent)                                                                      |
| FR-023 republish fresh identity    | `meta.sdr_revision` increments on republish                                                                        |
| FR-024 approval gate               | D7; publish only from approved content + explicit click                                                            |
| FR-025 timezone                    | **G3-closed:** timezone rule (local accept/render, absolute instant, UTC on wire)                                  |
| FR-026 platform identity preserved | **G2-closed:** `facebook→"web"` fix (pre-schema) + calendar/render                                                 |
| FR-027 limits single source        | authoritative SDR capabilities mirror (server-side)                                                                |
| FR-028 undeliverable variants      | picker "Not available"; never offered (FR-028)                                                                     |

| SC                                | Satisfied by                                           |
| --------------------------------- | ------------------------------------------------------ |
| SC-001 connect <2min              | US1 + OAuth start/callback flow (test: Playwright e2e) |
| SC-002 published + link ≤60s      | webhook → realtime → Studio (US4, SC-002)              |
| SC-003 0 duplicates               | idempotency key + SDR 409 handling                     |
| SC-004 scheduled ≤5min ≥99%       | SDR beat claim + webhook (US3)                         |
| SC-005 expired never silent       | `account.expired` + Reconnect path                     |
| SC-006 all outcomes visible       | `content_publications` drives Studio                   |
| SC-007 non-regression             | flag-gated rollout; Phase 5 degrade                    |
| SC-008 no content loss            | graceful failure paths; terminal-wins reconciliation   |
| SC-009 verified-only state change | HMAC verify before apply (contracts/sdr-webhook.md)    |
| SC-010 media delivery ≥99%        | durable media URLs + retryable media failure           |

## Complexity Tracking

No constitution violations to justify — the two structural additions (server proxy layer + `content_publications` mirror table) are the minimum shape for the security (FR-014) and separation (FR-010) requirements, and are documented as decisions D1/D5.

## Generated Artifacts

- [research.md](./research.md) — Phase 0 decisions log
- [data-model.md](./data-model.md) — Phase 1 data model
- [contracts/sdr-proxy.md](./contracts/sdr-proxy.md) — Phase 1 contract
- [contracts/sdr-webhook.md](./contracts/sdr-webhook.md) — Phase 1 contract
- [quickstart.md](./quickstart.md) — Phase 0/1 runbook
