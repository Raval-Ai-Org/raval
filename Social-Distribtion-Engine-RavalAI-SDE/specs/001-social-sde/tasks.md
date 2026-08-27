# Tasks: Social Distribution Engine (SDE)

**Input**: Design documents from `/specs/001-social-sde/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are provided in descriptions.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initial repository configuration, build tool setup, and validation checks.

- [ ] T001 Initialize repository build layout and package configs in `pyproject.toml`
- [ ] T002 Configure strict validation gates (lint/format/type) under `pyproject.toml` [P]
- [ ] T003 Setup Docker Compose baseline container specification in `docker-compose.yml`
- [ ] T004 Define complete environment parameter definitions in `.env.example` [P]
- [ ] T005 Setup testing configuration suite in `tests/conftest.py`
- [ ] T006 Configure GitHub Actions CI workflow in `.github/workflows/ci.yml` [P]

**Checkpoint**: Structure is in place, environment loads successfully, and `pytest` succeeds on an empty suite.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core layers (DB models, async engines, configuration schemes, taxonomy structure) blocking all stories.

- [ ] T007 Build application configuration manager in `app/config.py`
- [ ] T008 Setup database connections (async API pool + sync worker engines) in `app/database.py` [P]
- [ ] T009 Create unified database schema models (all 5 tables) in `app/models.py`
- [ ] T010 Configure database migration scripts via Alembic in `alembic/env.py` and `alembic/versions/`
- [ ] T011 Define Pydantic request/response validation contracts in `app/schemas.py` [P]
- [ ] T012 Implement error classification structure in `app/adapters/errors.py`
- [ ] T013 Setup basic health verification endpoint in `app/api/ops.py` [P]
- [ ] T014 Build standard FastAPI application factory instance in `app/main.py`

**Checkpoint**: Database migrations can be run (`alembic upgrade head`), config validated, and local `/healthz` succeeds.

---

## Phase 3: User Story 1 - Immediate Publishing & Validation 🎯 MVP

**Goal**: User submits post for immediate publishing; system validates content and processes targets through DryRun/Staging.

**Independent Test**: Assert that sending a valid immediate post returns 201 + UUID, writes to `posts` and `post_targets`, runs mock adapt successfully, and registers in `delivery_log`.

- [ ] T015 Implement security verification primitives (bearer, HMAC signing, replay filter) in `app/security.py` [P]
- [ ] T016 Setup routing dependency definitions in `app/api/deps.py` [P]
- [ ] T017 Define platform abstract interface contract base in `app/adapters/base.py`
- [ ] T018 Build complete DryRun adapter with all magic failure switches in `app/adapters/dryrun.py`
- [ ] T019 Implement publishing orchestration operations service in `app/services/publisher.py`
- [ ] T020 Setup main publishing API endpoints handler in `app/api/publish.py`
- [ ] T021 Implement job query API endpoints in `app/api/jobs.py` (timeline status replay support)
- [ ] T022 Implement unit tests checking schema content limits in `tests/unit/test_schemas.py` [P]
- [ ] T023 Implement integration test verifying immediate publish pipeline in `tests/integration/test_publish_flow.py`
- [ ] T024 Write integration test checking idempotency handling in `tests/integration/test_idempotency.py` [P]

**Checkpoint**: POST `/publish` completes end-to-end against the DryRun adapter, returns job status with timeline, and ignores duplicates.

---

## Phase 4: User Story 2 - Scheduled Publishing & Durability

**Goal**: Post is scheduled for a future time; Celery sweeps tasks and processes targets reliably across restarts.

**Independent Test**: Submit post with future date, stop API container, prove background worker processes the job when scheduled time matches.

- [ ] T025 Setup Celery application baseline instance in `app/celery_app.py`
- [ ] T026 Build background scheduling worker task query definitions in `app/services/scheduler_tasks.py`
- [ ] T027 Configure worker health-check indicators in `app/api/ops.py` [P]
- [ ] T028 Create integration tests verifying scheduled publishing execution in `tests/integration/test_schedule_durability.py`
- [ ] T029 Create integration tests checking restart validation recovery in `tests/integration/test_reboot_recovery.py`
- [ ] T030 Write integration tests validating double-fire safety claims in `tests/integration/test_claim_no_double_fire.py` [P]

**Checkpoint**: POST `/schedule` writes job, beat ticks claim query to route to worker task, and system handles node restarts.

---

## Phase 5: User Story 3 - Resiliency, Webhooks, and Token Refreshes

**Goal**: Platform calls retry on transient issues; auth errors mark accounts `needs_reauth`; status webhooks publish reliably.

**Independent Test**: Trigger simulated 429 and 401 via DryRun adapter and verify retry backoffs and webhook delivery with HMAC verification.

- [ ] T031 Implement retry backoff calculations in `app/services/publisher.py`
- [ ] T032 Build signed status callback webhook client in `app/services/webhook_out.py`
- [ ] T033 Create webhook config endpoint handler in `app/api/webhooks_cfg.py`
- [ ] T034 Build proactive credentials checker task in `app/services/scheduler_tasks.py` (token refresh)
- [ ] T035 Write unit test verifying error taxonomy mapper logic in `tests/unit/test_error_taxonomy.py` [P]
- [ ] T036 Write integration test validating webhook callbacks in `tests/integration/test_webhooks_out.py`

**Checkpoint**: Webhook endpoint registrations work, callback posts verify, and failing publishes retry or report reauth needs correctly.

---

## Phase 6: User Story 4 - Account Integration & Real Adapters

**Goal**: Workspace managers link accounts, view listings, and publish to real social platforms (X, LinkedIn, Facebook).

**Independent Test**: Complete mock OAuth loops, list credentials, and run live-smoke publishing to platforms with valid dev apps.

- [ ] T037 Create account listing API router in `app/api/accounts.py`
- [ ] T038 Implement OAuth initiation and callback endpoints in `app/api/accounts.py`
- [ ] T039 Build Twitter/X PKCE publishing integration adapter in `app/adapters/twitter.py`
- [ ] T040 Build LinkedIn publishing integration adapter in `app/adapters/linkedin.py`
- [ ] T041 Build Facebook Pages Graph adapter in `app/adapters/meta.py`
- [ ] T042 Build unit tests verifying adapters logic mock suites in `tests/unit/` (X, Linkedin, Facebook) [P]

**Checkpoint**: Accounts hook up through OAuth, token secrets encrypt in database, and live publish adapters validate.

---

## Phase 7: Delivery Readiness & Integration Packaging 📦

**Goal**: Deliver a comprehensive integration kit for the RavalAI team to link the module quickly.

- [ ] T043 Compile and export finalized OpenAPI documentation in `specs/001-social-sde/contracts/openapi.yaml` [P]
- [ ] T044 Write consumer integration details documentation in `specs/001-social-sde/integration/INTEGRATION.md`
- [ ] T045 Build Python client helper SDK wrapper in `specs/001-social-sde/integration/client.py`
- [ ] T046 Build webhook reference receiver script in `specs/001-social-sde/integration/webhook_example.py`
- [ ] T047 Export Postman testing collections in `specs/001-social-sde/integration/postman.json` [P]
- [ ] T048 Implement local mock validation checks in `tests/contract/test_openapi_schemathesis.py`
- [ ] T049 Write operational guidelines playbook in `specs/001-social-sde/runbook.md`
- [ ] T050 Build automated run demo pipeline checker script in `specs/001-social-sde/demo/run-demo.sh`

**Checkpoint**: Run demo script completes end-to-end, generated API schema validates, and all handoff documentation is ready.

---

## Phase 8: Polish & Production Hardening

**Purpose**: Cleanup, stress-testing, configuration optimization.

- [ ] T051 Setup Celery Flower inspect dashboards on `:5555` in `docker-compose.yml` [P]
- [ ] T052 Optimize production database index queries [P]
- [ ] T053 Verify all strict typing limits (`mypy --strict app`) [P]
- [ ] T054 Execute final codebase refactor check (`ruff check && ruff format`) [P]

**Checkpoint**: CI build fully green, strict typing checks pass, code formatted, and Flower is accessible.

---

## Phase 9: Multi-Tenant Readiness & Engine Dogfooding

**Goal**: Close the runtime wiring gaps recorded in `history/prompts/001-social-sde/0006` and
`0007` so the engine publishes through its own pipeline (not the OAuth scripts) and becomes safe
for real RavalAI clients. Decisions are captured in `history/adr/0001..0003`; requirements delta
in `specs/001-social-sde/MULTI_TENANCY.md`.

**Independent Test**: A real LinkedIn post publishes via `POST /api/v1/publish` **and** via
`POST /api/v1/schedule` + beat + worker, using a decrypted token + `author_urn`, with a webhook
fired on success.

- [x] T055 Fix Celery beat task-name mismatch so `beat_schedule` references the registered names (`scheduler.tick_due_jobs`, `scheduler.refresh_tokens`) in `app/celery_app.py` + `get_beat_schedule()`
- [x] T056 Await the async adapter publish inside `process_target` (sync task → `asyncio.run`) in `app/services/scheduler_tasks.py`
- [x] T057 Decrypt `encrypted_access_token` and pass the real bearer token + `author_urn` to adapters in `app/services/scheduler_tasks.py` and `app/services/publisher.py` (requires ADR-0002)
- [x] T058 Fix LinkedIn OAuth: scope `openid profile email w_member_social`, no PKCE, `GET /v2/userinfo`, store `author_urn`+`persona` in `accounts.metadata` in `app/api/accounts.py`
- [x] T059 Implement real Twitter PKCE in the engine OAuth (generate verifier+challenge, store verifier in state, exchange with it) in `app/api/accounts.py`
- [x] T060 Wire webhook delivery (`WebhookService.deliver_event`) on published/failed/retrying in `app/services/publisher.py` and `app/services/scheduler_tasks.py`
- [x] T061 Resolve real platform name from the account row in job/target responses (remove hardcoded `"dryrun"`) in `app/api/jobs.py` and `app/services/publisher.py`
- [x] T062 Catch `IntegrityError` on duplicate `idempotency_key` and return 409 instead of 500 in `app/api/publish.py`
- [x] T063 Scope account lookups by `workspace_id` in `app/services/publisher.py` and `app/services/scheduler_tasks.py`
- [x] T064 Implement per-workspace API-key auth: `api_keys` table + Alembic migration + hash lookup resolver in `app/api/deps.py` (ADR-0001)
- [x] T065 Implement real per-platform token refresh (LinkedIn/X refresh grant, Meta extension) in `app/services/scheduler_tasks.py` (ADR-0003)
- [x] T066 Replace in-memory OAuth state with Redis-backed (TTL) store in `app/api/accounts.py`
- [x] T067 **Dogfood gate**: seed LinkedIn account from `.env` tokens, run the stack, publish a real post via `/publish` and via `/schedule` + worker, capture share URN

**Dogfood evidence (2026-08-01):**
- Immediate: `POST /api/v1/publish` → `urn:li:share:7489056989533253633` (published)
- Scheduled: `/schedule` → beat → worker → `POST https://api.linkedin.com/v2/ugcPosts` → `201` → `urn:li:share:7489060292774211584` (published, post status synced)

**Checkpoint**: Full pytest suite green (existing 166 + new); a real LinkedIn post goes live
through the engine's own pipeline; job responses report real platforms; webhooks fire.

---

## Dependencies & Execution Order

```
[Phase 1: Setup]
       ↓
[Phase 2: Foundational]
       ↓
[Phase 3: User Story 1] (Blocks all other Stories)
       ↓
  ┌────┴──────────────────────────┐
  ↓                               ↓
[Phase 4: US2 Scheduled]   [Phase 5: US3 Webhooks]
  │                               │
  └────┬──────────────────────────┘
       ↓
[Phase 6: US4 OAuth/Adapters]
       ↓
[Phase 7: Delivery Packaging]
       ↓
[Phase 8: Polish/Hardening]
       ↓
[Phase 9: Multi-Tenant Readiness & Engine Dogfooding]
```

### Parallel Execution Opportunities

Within Phase 3 (US1 Immediate Publish):
- T015, T016, and T017 can be implemented in parallel.
- Once T019 (Publisher Service) is complete, T020 (Publish API) and T021 (Jobs API) can be built in parallel.

Within Phase 4 (US2 Scheduling):
- T027 (Ops Health check for workers) can be written in parallel with T026 (Celery Tasks).

Within Phase 6 (US4 Adapters):
- X, LinkedIn, and Facebook adapters can be built completely in parallel once T017 (Base Adapter) is done.

---

## Implementation Strategy

### MVP Scope (User Story 1 Core)

1. Complete Setup and Foundational (Phase 1 & 2)
2. Complete immediate publishing flow using DryRun adapter (Phase 3)
3. Run integration tests for publish flow and idempotency
4. **Demonstrate MVP endpoint**: POST `/publish` works instantly, returns ID, status is terminal, and duplicates are handled

### Incremental Feature Additions
5. Layer in scheduling durability (Phase 4), allowing workers to grab due jobs asynchronously
6. Add failure logic retries and outbound webhooks updates (Phase 5)
7. Build real network adapters and OAuth loops in isolation (Phase 6)
8. Generate integration assets and playbook (Phase 7)
9. Finish with code formatting and typing checks (Phase 8)

---

## Notes

- Strictly follow code validation rules (explicit type signatures, datetime timezone enforcement, raw REST instead of bloated libraries).
- Always ensure tests exist and verify behavior before marking tasks resolved.
