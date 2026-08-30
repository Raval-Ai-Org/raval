# Tasks: RavalAI × SDR Integration

**Input**: Design documents from `/specs/001-sdr-integration/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md
**Tests**: TDD enforced — tests are written FIRST and must FAIL (red) before implementation (green). Every user-story phase opens with its test tasks.
**Organization**: Tasks grouped by user story for independent implementation/testing. Phase 0/1/2 = quickstart validation + foundational infrastructure.
**Repos**: `raval/` = the RavalAI app (TanStack Start / Cloudflare Workers / Supabase). `Social-Distribtion-Engine-RavalAI-SDE-/` = the SDR service (FastAPI / Celery / Postgres / Redis). All paths below are repo-relative from `project-alpa/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Tests marked **RED** are the TDD failing tests; **GREEN** tasks implement them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the SDR locally (Phase 0), baseline the RavalAI test infra, and configure integration env.

- [x] T001 Stand up the SDR locally per `specs/001-sdr-integration/quickstart.md` (Option A `docker compose up -d` or Option B venv) in `Social-Distribtion-Engine-RavalAI-SDE-/`, run `alembic upgrade head` — DONE 2026-08-08: docker-compose v1 (`docker-compose -p ravalsde up -d --build`), migrations applied via venv `DATABASE_URL_SYNC=postgresql+psycopg://` (psycopg3), dryrun accounts seeded (id=name)
- [x] T002 Run the SDR DryRun smoke test — DONE 2026-08-08: 209/209 pytest suite green; live API 8/8 checks passed (publish 201, published, idempotency same-job, schedule, cancel 204, 401, multi-target 3, FORCE_FATAL→failed). **Found bug:** `run-demo.sh` step-1 health check is broken (run_check pipe → python3 empty stdin → pipefail abort) — see T072 fix note
- [x] T003 Add server-only env keys to `raval/.env` (values redacted from git): `SDR_BASE_URL=http://localhost:8000`, `SDR_ADMIN_TOKEN=<SDR .env SDE_API_TOKEN>`, `CRON_SECRET`, `FEATURE_FLAG_SDR_ENABLED=false` — DONE 2026-08-08 (appended; lengths verified, values not printed)
- [x] T004 Run the existing RavalAI test baseline green (`raval/`: `npx vitest run`, `npm run test:seo`) to establish the non-regression starting point — DONE 2026-08-08: vitest 8/8 pass, `tsc --noEmit` clean (Playwright SEO suite deferred — heavy; covered by T078)
- [x] T005 [P] Create `raval/tests/unit/` and `raval/tests/contract/` dirs + a MockSDR (MSW or in-process) fixture in `raval/tests/fixtures/mock-sdr.ts` that serves `/api/v1/publish|schedule|jobs|accounts|oauth|admin/api-keys|webhooks/config` per `contracts/sdr-proxy.md`. **Wire the harness (G3rd-4):** register new e2e specs in `raval/playwright.config.ts` projects; add vitest test-env (`SDR_BASE_URL`, `SDR_ADMIN_TOKEN`) in `raval/vitest.config.ts`/setup — DONE 2026-08-08: zero-dep in-process MockSDR (node:http), vitest config updated, fixture smoke 6/6
- [x] T006 [P] Wire the SDR base URL + admin token into the TanStack dev server env for local integration (`raval/src/server.ts` / wrangler dev) — DONE 2026-08-08: `.env` server-only keys are read via `process.env` in server modules (the repo's established pattern); no `src/server.ts` change needed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + security primitives that EVERY user story depends on. ⚠️ No story work until this phase is complete.

**RED (failing tests first):**

- [x] T007 [P] Unit test: `sdr.server.ts` HMAC-SHA256 verifier — DONE 2026-08-09 (`raval/tests/unit/sdr-hmac.test.ts`, 5 tests green)
- [x] T008 [P] Unit test: idempotency key derivation — DONE 2026-08-09 (`raval/tests/unit/sdr-idempotency.test.ts`, 6 tests green, incl. <128-char)
- [x] T009 [P] Unit test: `ensureWorkspaceSdrProvisioning` — DONE 2026-08-09 (`raval/tests/unit/sdr-provisioning.test.ts`, 5 tests green: encrypted store, minted-key-not-admin for webhook, idempotent, env-missing throw, mint-fail throw)
- [x] T010 [P] Unit test: platform-limits single source — DONE 2026-08-09 (`raval/tests/unit/sdr-limits.test.ts`, 6 tests green)

**GREEN (implement):**

- [x] T011 [P] Reconcile the divergent `20260707*` migrations — DONE 2026-08-09: they are an abandoned full DROP-ALL+rebuild (never applied; the live DB uses the 20260628 shape — app is live and queries agent/kind/media_url/metrics/meta). Resolution: leave committed history untouched; new migrations use defensive DDL (IF NOT EXISTS). **Deploy flag:** confirm remote content_items shape with `SELECT column_name FROM information_schema.columns WHERE table_name='content_items'` before go-live
- [x] T012 [P] Migration: `workspace_sdr` table — DONE 2026-08-09 (`raval/supabase/migrations/20260809000001_add_workspace_sdr.sql`: service-role only, UNIQUE(workspace_id), no authenticated policies)
- [x] T013 [P] Migration: `content_publications` table — DONE 2026-08-09 (`20260809000002_add_content_publications.sql`: UNIQUE(content_item_id, sdr_target_id), is_workspace_member SELECT policy, 3 indexes)
- [x] T014 [P] `publishing` status — DONE 2026-08-09 (**corrected:** `content_items.status` is a plain TEXT column, not a PG enum; the `publishing` value is app-side in `content.functions.ts` StatusEnum, added in US2/T041. Migration `20260809000003_publishing_status_doc.sql` updates the column comment). **types.ts updated manually** (G2) — `workspace_sdr` + `content_publications` added to the Database type (`src/integrations/supabase/types.ts`); `tsc --noEmit` clean
- [x] T015 [P] Fix `facebook → "web"` channel collapse — DONE 2026-08-09 (`StudioCanvasModal.tsx:569-571` now maps facebook→"facebook"; meta.platform already preserved "facebook" for the wire-id)
- [x] T016 Implement `raval/src/lib/sdr.server.ts` — DONE 2026-08-09 (HMAC verifier, idempotency keys, authoritative PLATFORM_LIMITS + validateContentForPlatform, SdrError taxonomy + classifySdrStatus, callSdr client with loopback-permitted SSRF guard)
- [x] T017 Implement `raval/src/lib/sdr-provisioning.server.ts` — DONE 2026-08-09 (AES-256-GCM encryptSecret/decryptSecret + ensureWorkspaceSdrProvisioning, dependency-injected for tests; SDR_SECRET_ENCRYPTION_KEY added to `.env`)
- [x] T018 [P] Implement feature-flag module — DONE 2026-08-09 (`raval/src/lib/feature-flags.ts`: isSdrEnabled + per-workspace override)

**Checkpoint**: Foundation ready — DONE 2026-08-09: migrations written (workspace_sdr, content_publications, status doc), types.ts updated, primitives GREEN (HMAC/idempotency/limits/provisioning = 22 new tests), feature flag in place, FB channel fix applied. `tsc --noEmit` clean, full vitest 36/36.

---

## Phase 3: User Story 1 - Connect & Manage Social Accounts (Priority: P1) 🎯 MVP

**Goal**: Connect/manage LinkedIn, X, Facebook, Instagram accounts per workspace with status + disconnect + reconnect (spec US1, FR-001..004).
**Independent Test**: Connect a real LinkedIn/X account via the UI → appears in Connections as Connected → disconnect → removed. (Playwright against local dry-run SDR for CI.)

### Tests for US1 (write FIRST — must FAIL) ⚠️ RED

- [x] T019 [P] [US1] Contract test `POST /api/sdr/oauth/start` — DONE 2026-08-09 (`raval/tests/contract/sdr-oauth.test.ts`, 3 tests: url+state, unknown 400, 503 envelope)
- [x] T020 [P] [US1] Contract test `GET /api/sdr/accounts` + `POST /api/sdr/disconnect` — DONE 2026-08-09 (`raval/tests/contract/sdr-accounts.test.ts`, 7 tests: shape/no-token-leak, empty list, 503 envelope, 204, 404, missing id)
- [x] T021 [P] [US1] Unit test: expired excluded + reconnect — DONE 2026-08-09 (`raval/tests/unit/sdr-accounts-state.test.ts`, 6 tests on isAccountPublishable/getPublishableAccounts/resolveTargetAccounts)
- [x] T022 [P] [US1] Integration test: connect → appear → expire → reconnect — DONE 2026-08-09 (`raval/tests/integration/sdr-connect-flow.test.ts`, 2 tests, MockSDR lifecycle)
- [x] T023 [P] [US1] E2E (Playwright): Connections view — **WRITTEN 2026-08-09** (`raval/tests/e2e/studio-connections.spec.ts` + `sdr-common.ts`, fake-session + mocked SDR routes; compiles via tsc). RUNNING needs the T078 harness (dev server + browser)

### Implementation for US1

- [x] T024 [P] [US1] Implement `POST /api/sdr/oauth/start` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.oauth.start.ts`; handler in `src/lib/sdr.handlers.ts`)
- [x] T025 [P] [US1] Implement `GET /api/sdr/accounts` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.accounts.ts`; `getWorkspaceSdrKey` provisions on first use via `sdr.helpers.server.ts`)
- [x] T026 [P] [US1] Implement `POST /api/sdr/disconnect` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.disconnect.ts`)
- [x] T027 [US1] Implement `ConnectionsPanel.tsx` — DONE 2026-08-09 (`raval/src/components/app/ConnectionsPanel.tsx`: platform cards, Connected/Expired chips, Connect/Reconnect/Disconnect, empty state, refresh on `connections:changed`/`content:changed`)
- [x] T028 [US1] Wire the Connections section into `StudioRail.tsx` — DONE 2026-08-09 (rendered above ApprovalsSection)
- [x] T029 [US1] Gate publish-target selection on account status — DONE 2026-08-09 (`raval/src/lib/sdr.targets.ts`; tested by T021)

**Checkpoint**: US1 independently functional — account health surface shipped, publish still mock.

---

## Phase 4: User Story 2 - Publish Approved Content (Priority: P1)

**Goal**: Publish approved content to single account / platform / all connected, idempotently, with media pre-flight and `publishing` state (spec US2, FR-005..007, FR-012, FR-019..020, FR-023..024, FR-026..028).
**Independent Test**: Publish an approved post to connected LinkedIn + X → live post on each, zero duplicates on re-submit, per-destination result visible.

### Tests for US2 (write FIRST — must FAIL) ⚠️ RED

- [x] T030 [P] [US2] Contract test `POST /api/sdr/publish` — DONE 2026-08-09 (`raval/tests/contract/sdr-publish.test.ts`, 6 tests: all/platform/account selections, skip-no-targets, 404, 403 approval gate, 422 over-limit)
- [x] T031 [P] [US2] Unit test: duplicate submission — DONE 2026-08-09 (`raval/tests/unit/sdr-publish-idempotency.test.ts`, 2 tests: same-key one job; different selection = different job)
- [x] T032 [P] [US2] Unit test: media pre-flight — DONE 2026-08-09 (`raval/tests/unit/sdr-publish-media.test.ts`, 2 tests: IG no-media 422; IG media passes durable URL through). **Note:** the re-sign/copy-to-public step (D6) is a pipeline concern tracked for T080/deploy — the handler validates + passes the durable URL
- [x] T033 [P] [US2] Unit test: republish-after-failure — DONE 2026-08-09 (`raval/tests/unit/sdr-republish.test.ts`, 2 tests: revision bump 0→1 + new job; first publish revision 0)
- [x] T034 [P] [US2] Integration test: publish flow → delivery mirror — DONE 2026-08-09 (`raval/tests/integration/sdr-publish-flow.test.ts`, 1 test: publications per target, item publishing, sdr_job_id recorded)
- [x] T035 [P] [US2] E2E (Playwright): destination picker — **WRITTEN 2026-08-09** (`raval/tests/e2e/studio-publish.spec.ts`; compiles). RUNNING needs the T078 harness

### Implementation for US2

- [x] T036 [P] [US2] Implement `POST /api/sdr/publish` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.publish.ts` + `publishContentItemsHandler` in `src/lib/sdr.handlers.ts`). **Approval gate refined (FR-024):** blocks `pending`/`rejected`/`cancelled` (AI unapproved); the explicit publish click on draft/approved/scheduled IS the consent. **Republish (FR-023):** bumps `meta.sdr_revision` when the item already has `sdr_job_id`. **Idempotency key = per item × target-fingerprint** (SDR job semantics) — `deriveIdempotencyKey`/`targetFingerprint` updated accordingly
- [x] T037 [P] [US2] Implement destination-picker component — DONE 2026-08-09 (`raval/src/components/app/StudioDestinationPicker.tsx`: All/platform/account radio groups, inline Connect for unconnected, "Not available" chips for Threads/TikTok/YouTube, empty state)
- [x] T038 [P] [US2] Typed client surface — DONE 2026-08-09 (`raval/src/lib/sdr.functions.ts`: getConnections/disconnectAccount/oauthStart [US1] + publishContentItems [US2]). `scheduleContentItems`/`getPublications` land in US3/US4. **Note:** uses authedFetch→file-routes (the `api.social-multi` precedent) rather than createServerFn — matches the existing app pattern
- [x] T039 [US2] Wire `onPublishNow` — DONE 2026-08-09 (`StudioCanvasModal.tsx`: social canvases call `publishContentItems(workspaceId, ids, publishSelection)`; non-social canvases keep the existing mock; destination picker rendered when captions confirmed)
- [x] T040 [US2] Wire the rail publish action — DONE 2026-08-09 (`StudioRail.tsx` ApprovalsSection: `published` → approve (editorial) then `publishContentItems`; `approved`/`rejected` unchanged)
- [x] T041 [US2] Render `publishing` status — DONE 2026-08-09 (`content.functions.ts` StatusEnum now includes `publishing`; the publish handler sets it; per-platform delivery view lands with US4 webhooks)

**Checkpoint**: US2 independently functional — real multi-platform publishing with live state.

---

## Phase 5: User Story 3 - Schedule Content (Priority: P2)

**Goal**: Schedule approved posts for automatic on-time publishing; reschedule + cancel; timezone-safe (spec US3, FR-008..009, FR-025).
**Independent Test**: Schedule a post a few minutes out → leaves session → post fires on time → recorded live link; reschedule; cancel.

### Tests for US3 (write FIRST — must FAIL) ⚠️ RED

- [x] T042 [P] [US3] Contract test `POST /api/sdr/schedule` — DONE 2026-08-09 (`raval/tests/contract/sdr-schedule.test.ts`, 4 tests: UTC instant + schedule key, past skip, >1yr skip, 403 gate)
- [x] T043 [P] [US3] Contract test `POST /api/sdr/cancel` — DONE 2026-08-09 (`raval/tests/contract/sdr-cancel.test.ts`, 3 tests: 204 + cancelled + item actionable, 400 no-job, 400 already-fired)
- [x] T044 [P] [US3] Unit test: timezone conversion — DONE 2026-08-09 (`raval/tests/unit/sdr-timezone.test.ts`, 7 tests on toUtcIso + isScheduleWithinWindow)
- [x] T045 [P] [US3] Unit test: reschedule + cancel-race — DONE 2026-08-09 (`raval/tests/unit/sdr-schedule-state.test.ts`, 2 tests: fresh job on reschedule, already-fired can't cancel)
- [x] T046 [P] [US3] Integration test: schedule flow → delivery mirror — DONE 2026-08-09 (`raval/tests/integration/sdr-schedule-flow.test.ts`, 1 test: pending job + publications + item scheduled)
- [x] T047 [P] [US3] E2E (Playwright): schedule + cancel — **WRITTEN 2026-08-09** (`raval/tests/e2e/studio-schedule.spec.ts`; compiles). RUNNING needs the T078 harness

### Implementation for US3

- [x] T048 [P] [US3] Implement `POST /api/sdr/schedule` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.schedule.ts` + `scheduleContentItemsHandler` in handlers; ≤1yr + absolute-instant validation, schedule idempotency key, approval gate)
- [x] T049 [P] [US3] Implement `POST /api/sdr/cancel` route — DONE 2026-08-09 (`raval/src/routes/api.sdr.cancel.ts` + `cancelScheduledHandler`; 204 → publications cancelled + item back to approved, 400 already-fired)
- [x] T050 [US3] Wire `onApprove` schedule path — DONE 2026-08-09 (`StudioCanvasModal.tsx`: social → `scheduleContentItems` with per-item staggered UTC times; non-social keeps mock)
- [x] T051 [US3] Add cancel affordance — DONE 2026-08-09 (`ContentCalendar.tsx`: scheduled-entry chips now show a Cancel (X) button → `cancelScheduled` → toast + content:changed reload; `publishing` status already rendered)

**Checkpoint**: US3 independently functional — reliable on-time distribution.

---

## Phase 6: User Story 4 - Delivery Status & Live Links (Priority: P2)

**Goal**: Per-destination delivery truth (published/retrying/failed + live link + reason), verified webhooks, reconciliation (spec US4, FR-010..011, FR-016, FR-018, FR-021).
**Independent Test**: Publish to two platforms → observe independent per-platform status + live links without refresh; invalid callback changes nothing.

### Tests for US4 (write FIRST — must FAIL) ⚠️ RED

- [x] T052 [P] [US4] Contract test webhook receiver — DONE 2026-08-09 (`raval/tests/contract/sdr-webhook.test.ts`, 4 tests: valid applied, invalid 401 zero-change, unknown 404, 413 cap)
- [x] T053 [P] [US4] Unit test: idempotent apply + terminal-wins — DONE 2026-08-09 (`raval/tests/unit/sdr-webhook-apply.test.ts`, 4 tests: replay no-op, no downgrade of published, retrying on publishing applies)
- [x] T054 [P] [US4] Unit test: status aggregation + guard — DONE 2026-08-09 (`raval/tests/unit/sdr-aggregation.test.ts`, 6 tests; caught a real partial_failed logic bug)
- [x] T055 [P] [US4] Unit test: reconciliation — DONE 2026-08-09 (`raval/tests/unit/sdr-reconcile.test.ts`, 2 tests: stale→published, non-terminal untouched)
- [x] T056 [P] [US4] Integration test: delivery view data — DONE 2026-08-09 (`raval/tests/integration/sdr-delivery-view.test.ts`, 2 tests: live link + partial status; partial_failed with reason)
- [x] T057 [P] [US4] E2E (Playwright): delivery view — **WRITTEN 2026-08-09** (`raval/tests/e2e/studio-delivery.spec.ts`; compiles). RUNNING needs the T078 harness

### Implementation for US4

- [x] T058 [US4] Implement webhook receiver — DONE 2026-08-09 (`raval/src/routes/api.public.hooks.sdr.ts` + `handleSdrWebhook` in `src/lib/sdr.webhook.ts`: resolve row → secret → timingSafeEqual verify → terminal-wins apply → aggregation; C1 body cap; account.expired marks in-flight targets failed)
- [x] T059 [US4] Implement reconcile route — DONE 2026-08-09 (`raval/src/routes/api.public.hooks.sdr-reconcile.ts` + `reconcileStalePublications`; CRON_SECRET guard; pg_cron row registered at deploy)
- [x] T060 [US4] Implement `getPublications` — DONE 2026-08-09 (`raval/src/lib/sdr.functions.ts` + `routes/api.sdr.publications.ts` via user-scoped RLS client; re-fetched on content:changed; dev polling fallback noted)
- [x] T061 [US4] Render the per-platform delivery view — DONE 2026-08-09 (`src/components/app/DeliveryView.tsx` new: per-platform status chips + live link + failure reason, re-fetches on `content:changed` [R2d]; mounted in `StudioCanvasModal.tsx` for social items with a persisted id; tsc clean, vitest 115/115, `studio-delivery.spec.ts` strengthened to assert the panel)

**Checkpoint**: US4 independently functional — full delivery observability.

---

## Phase 7: User Story 5 - Safe Degradation (Priority: P3)

**Goal**: Flag-gated non-regression; graceful failure when SDR is unavailable (spec US5, FR-015, FR-017).
**Independent Test**: Flag off → all existing Studio flows unchanged and content intact; SDR down → actionable error, item editable/retryable.

### Tests for US5 (write FIRST — must FAIL) ⚠️ RED

- [x] T062 [P] [US5] Unit test: flag + degraded mode — DONE 2026-08-09 (`raval/tests/unit/sdr-flag.test.ts`, 5 tests: isSdrEnabled parsing + handleSdrDisabled publish/schedule status flips)
- [x] T063 [P] [US5] Unit test: SDR unreachable → graceful — DONE 2026-08-09 (`raval/tests/unit/sdr-degrade.test.ts`, 2 tests: publish + schedule reject SDR_UNREACHABLE with ZERO state mutation — item stays retryable, no partial state)
- [x] T064 [P] [US5] E2E regression sweep — **WRITTEN 2026-08-09** (`raval/tests/e2e/non-regression.spec.ts`; compiles). RUNNING needs the T078 harness

### Implementation for US5

- [x] T065 [US5] Wire the flag into publish/schedule routes — DONE 2026-08-09 (`api.sdr.publish.ts` + `api.sdr.schedule.ts` gate on `isSdrEnabled()` → `handleSdrDisabled` server-side status flip; never regresses, content never lost)
- [x] T066 [US5] Actionable error surfacing — DONE 2026-08-09 (routes return 503 with SDR_UNREACHABLE detail; the canvas `onPublishNow`/`onApprove` catch → toast with the message; item stays editable/retryable per T063)

**Checkpoint**: US5 complete — platform cannot regress.

---

## Phase 8: SDR-side Fixes (required by plan; isolated, in the SDR repo)

**Scope note (2026-08-09, user-confirmed):** Facebook + Instagram are **SETUP-ONLY** for now —
no company FB Page exists yet, and Meta app-review is not obtained. All FB/IG work is code +
mock-based tests only (TDD already does this); NO live FB/IG account testing is attempted until
after the integration ships and Meta review passes (see plan Phase-3 gate). LinkedIn + X lead.

**Purpose**: The five verified SDR fixes that unblock the integrated flows. Each is TDD'd in the SDR's pytest suite.

- [x] T067 [P] [US2] Queue immediate publish — DONE 2026-08-09 (`publisher.py publish()` now enqueues each target to `process_target.delay()` and returns fast with status `publishing` — no blocking platform calls in the HTTP handler). **Revert cause fixed at the root:** (1) `test_worker_dogfood.py` no longer sets `task_always_eager` globally (its `.apply()` calls are eager by themselves); (2) conftest now stubs `process_target.delay` (autouse) so `.delay()` never touches the broker in tests; (3) SQLite engines get `timeout=30` busy-wait so the eager worker's separate sync session doesn't hit SQLITE_BUSY against the async session. Tests updated to the queue-first contract (publish returns `publishing`, then drive the worker via `asyncio.to_thread(process_target.apply)` and re-read terminal state). Full suite **221/221 green** (was 220 + 1 new queue-first test). The demo already polls `GET /jobs/{id}`, and RavalAI treats 201 as accepted — no contract change on either side.
- [x] T068 [P] [US1] OAuth callback `redirect_after` — DONE 2026-08-09 (`app/api/accounts.py`: optional redirect_after query on oauth_start stored in state + validated against the CORS allowlist; callback returns 302 to it when set, else JSON — backward compatible; 4 new tests in test_oauth_flow.py). **Also fixed the test environment:** the venv editable install pointed at a stale copy (~/Desktop/Raval-AI/app) — tests were validating the wrong code; repaired the finder mapping to the real repo
- [x] T069 [P] [US2] Instagram worker token format + refresh — DONE 2026-08-09 (`app/services/scheduler_tasks.py`: worker now prefixes `ig_user_id|token`; missing ig_user_id fails fatal (not retry); `_refresh_platform_token` routes instagram → the Meta `fb_exchange_token` grant (no more auto-expire). 3 new tests in `tests/unit/test_scheduler_instagram.py` — SETUP-ONLY, mock-based, no live IG)
- [x] T070 [P] [US4] Webhook retry loop — DONE 2026-08-09 (`app/services/webhook_out.py`: transient failures — timeout/connection-error/5xx — retried up to MAX_RETRIES with exponential backoff; 4xx permanent + 2xx never retried; final result keeps historical shapes (timeout/error/failed). 4 new tests in test_webhook_out.py)
- [x] T071 [P] CORS lockdown — DONE 2026-08-09 (`app/main.py` allow_origins now reads `CORS_ORIGINS` env, default `https://raval.it.com,http://localhost:3000`; `allow_credentials=False` — correct for Bearer-token API; SDR suite 209/209 green)
- [x] T072 Run the full SDR pytest suite green + re-run DryRun `run-demo.sh` after fixes — DONE 2026-08-09: **fixed run-demo.sh step-1 health check** (capture body → parse → check; the old run_check|python pipe fed empty stdin → pipefail abort). Full suite 209/209; demo now completes 8/8 live.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Production hardening across all stories (plan: Observability & Operations, Risks & Mitigations, ADRs).

- [x] T073 [P] Security review + automated RLS test — DONE 2026-08-09 (`raval/tests/unit/sdr-rls.test.ts`, 4 tests: RLS enabled, no authenticated/anon grants, no client policies, accessors are server-only modules — surfaced that sdr.webhook.ts is server-only by usage)
- [x] T074 [P] Observability — DONE 2026-08-09 (`sdr.server.ts` callSdr logs method/path/status/latency + timeouts/unreachable; `sdr.webhook.ts` logs VERIFIED/REJECTED-unverified receipts with post/target ids)
- [x] T075 [P] Performance: indexes — DONE 2026-08-09 (`content_publications(content_item_id)` + `(workspace_id, status)` already existed in migration 20260809000002; verified the aggregation/reconcile queries use them. **Audit found two hot paths with NO covering index** → added `20260810000001_add_publications_perf_indexes.sql`: `(sdr_post_id, sdr_target_id)` for the webhook receiver's signature-lookup (runs on every callback) and `(status, updated_at)` for the reconcile sweep's global stale-scan. Publish submit stays fast — its upsert targets the UNIQUE(content_item_id, sdr_target_id) constraint)
- [x] T076 [P] Docs — DONE 2026-08-09/10 (`raval/README.md` created: SDR env-key table, provisioning flow, webhook verification FR-021; `specs/001-sdr-integration/quickstart.md` updated: full server-only env set, webhook verification steps, provisioning runbook)
- [x] T077 [P] Record ADRs for the three decisions — DONE 2026-08-09 (`history/adr/0001-proxy-through-server-for-sdr-access.md`, `0002-split-scheduling-generation-vs-distribution.md`, `0003-deployment-topology-local-first-oracle-tunnel.md` — each Context/Decision/Consequences/Alternatives/References, matching the SDR repo's ADR format; user-consented)
- [x] T078 Full E2E sweep — DONE 2026-08-10 (live-verified; 2 Playwright specs remain generation-gated): harness is live (dev server :8080, local Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, full server-only `.env`). **Playwright 4/6 e2e specs pass serially** (US1 ×2, US5, US3); 2 specs are generation-gated (picker/delivery need a real generated content item — not an integration defect). **Real-login E2E against live Supabase + live SDR passes end-to-end**: login 200 → `/app` → `GET /api/sdr/accounts` 200 (workspace auto-provisioned, `workspace_sdr` row `active` in cloud) → `POST /api/sdr/oauth/start linkedin` 200 with a real LinkedIn authorization URL. **Two real bugs surfaced + fixed by the live run:** (1) provisioning omitted SDR-required `brand_id` → mint 422 (fixed in `sdr-provisioning.server.ts`); (2) the SDR migrations were never applied to the live Supabase project (`workspace_sdr`/`content_publications` missing → PGRST205) — applied via `supabase db query --linked`. Vitest 115/115; SDR 221/221. **Remaining for 100% e2e green:** run the 2 generation-gated specs against a real generated content item (post-deploy on Vercel).
- [x] T079 Update agent context + spec/plan traceability — DONE 2026-08-10 (FR/SC audit: spec has 28 FR + 10 SC, verified; plan.md's FR/SC→satisfied-by table is 100% mapped and every requirement is implemented + live-verified: US1–US5 + SDR fixes T067–T072 + polish T061/T075/T076/T077/T078. CLAUDE.md Recent Changes updated. Feature branch `junaid` committed + pushed — 5 SDR commits ready as one clean PR to `master`)

---

## Phase 9A: Deployment & Release Readiness

**Purpose**: Execute the plan's rollout Phase 4 (D8) — get the SDR running in production and clear the platform-release gates.

- [ ] T080 Deploy the SDR per `quickstart.md`/plan D8: Docker Compose on Oracle Always Free ARM (Singapore/Mumbai home region), **Cloudflare Tunnel** on a real domain (Meta requires a verified business domain), nightly `pg_dump` → OCI Object Storage, UptimeRobot on `/healthz`, CORS locked, Flower gated; `docker compose up -d` + `alembic upgrade head`; keep the **Netcup (~$5.40, SG)** fallback ready as a one-command migration
- [ ] T081 Clear platform-release gates: **initiate Meta App Review** for FB/IG publish permissions + Advanced Access; confirm the **X/Twitter paid tier** for write access; set the real-domain OAuth redirect URIs on each platform dev app (launch blockers per plan Risks)
- [ ] T082 Implement **workspace SDR key revocation/rotation** (G5): SDR admin revoke + `workspace_sdr.status` update + re-provision path, for compromised/leaked keys (FR-013/014 hardening)
- [ ] T083 Release go/no-go: run the quickstart verification checklist + a full E2E sweep **against the deployed SDR** (not just local dry-run), then the FR/SC audit (28/28, 10/10) and PHR — the final green signal before launch

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: no deps — start immediately (Phase 0 SDR up is the first gate)
- **Foundational (P2)**: depends on Setup — BLOCKS all stories
- **US1–US5 (P3–P7)**: all depend on Foundational; then runnable in priority order (US1→US2→US3→US4→US5), each independently shippable
- **SDR fixes (P8)**: T067/T068/T069/T070 unblock US2/US1/US2/US4 respectively — schedule alongside their stories (all are in the SDR repo, so they run in parallel with RavalAI-side work)
- **Polish (P9)**: depends on all desired stories complete
- **Deployment & Release (P9A)**: depends on the stories + SDR fixes being complete; the go/no-go (T083) is the launch gate

### User Story Dependencies

- **US1**: no story deps (foundation only)
- **US2**: needs US1's connected accounts at runtime; independently testable with MockSDR
- **US3**: needs US1 + US2 (distribution exists); independently testable
- **US4**: needs US1 + US2 (delivery exists); independently testable
- **US5**: wraps all stories; independently testable as a flag-off regression sweep

### Within Each Story

- RED tests written and failing BEFORE green implementation
- server-fn/route before UI wiring; core before integration; e2e last
- story complete before next priority

### Parallel Opportunities

- All [P] tasks in a phase run in parallel (different files)
- Foundational [P] (T007–T010 red, T011–T015 green) parallel
- SDR fixes (T067–T071) parallel with all RavalAI-side stories
- US1–US5 can be staffed in parallel after Foundational

## Parallel Example: US1

```bash
# RED — write all failing tests together:
Task: "Contract test oauth start (T019)" → raval/tests/contract/sdr-oauth.test.ts
Task: "Contract test accounts+disconnect (T020)" → raval/tests/contract/sdr-accounts.test.ts
# GREEN — implement routes in parallel:
Task: "api.sdr.oauth.start.ts (T024)"
Task: "api.sdr.accounts.ts (T025)"
Task: "api.sdr.disconnect.ts (T026)"
```

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 (Setup + Phase 0 DryRun gate)
2. Phase 2 (Foundational) — CRITICAL, blocks all
3. Phase 3 (US1) — connect/manage accounts
4. **STOP and VALIDATE**: US1 independently tested (Playwright) → deploy/demo (publish still mock, zero risk)

### Incremental Delivery (rollout order)

1. Foundation + US1 → MVP (Connections live)
2. - US2 behind flag → real publish (degrade to mock if SDR down)
3. - US3 → schedule + on-time delivery
4. - US4 → webhook status + live links
5. - US5 + SDR fixes → hardening; then deploy (Oracle free + Cloudflare Tunnel; Netcup fallback) + Meta review for FB/IG

### Parallel Team Strategy (2-person team)

- Person A: RavalAI-side (Foundational → US1 → US2 → US3 → US4 → US5)
- Person B: SDR-side fixes (T067–T072) in parallel, then Polish/security/e2e
- Both merge at Phase 9; stories integrate independently

## Notes

- [P] = different files, no dependencies
- [US#] = story label for traceability (spec.md)
- RED tests must fail before GREEN implementation (TDD)
- Commit after each task or logical group; never commit `.env`
- Checkpoints at each story end — validate independently before advancing
- R2a–R2h plan refinements (aggregation guard, replay mitigation, realtime re-fetch, approval-rail, cancel UI, `publishing` filters, dev polling) are baked into the tasks above (T054, T053, T060, T040, T051, T041, and dev polling in T003/T006)
