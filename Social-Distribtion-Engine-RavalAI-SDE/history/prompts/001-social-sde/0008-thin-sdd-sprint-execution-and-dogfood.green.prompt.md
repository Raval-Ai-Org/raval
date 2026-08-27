---
id: 0008
title: Thin-SDD sprint execution and dogfood gate
stage: green
date: 2026-08-01
surface: agent
model: claude-code-auto
feature: 001-social-sde
branch: 001-social-sde
user: nauman_sajjad
command: (conversational request — execute the thin-SDD sprint fully auto)
labels: ["multi-tenant", "sprint", "dogfood", "linkedin", "live-publish", "social-sde"]
links:
  spec: specs/001-social-sde/spec.md
  ticket: null
  adr: history/adr/0001-multi-tenant-auth-model-per-workspace-api-keys.md
  pr: null
files:
 - .env (restored to full key set; strong secrets generated; LINKEDIN_* preserved)
 - scripts/_env_utils.py (new — non-destructive .env updates)
 - scripts/linkedin_oauth_and_post.py, scripts/twitter_oauth_and_post.py (no longer clobber .env)
 - scripts/seed_linkedin_account.py (new — refresh + userinfo + account upsert)
 - specs/001-social-sde/MULTI_TENANCY.md (new spec amendment)
 - history/adr/0001..0003-*.md (auth model, LinkedIn persona, token refresh)
 - specs/001-social-sde/tasks.md (Phase 9 added; T055-T067 marked done)
 - app/celery_app.py (beat task names fixed; include=scheduler_tasks; adapters registered for workers)
 - app/services/scheduler_tasks.py (await publish, decrypt token + author_urn, webhooks, _sync_post_status, real token refresh, workspace-scoped lookup)
 - app/services/publisher.py (decrypt token + author_urn, webhooks, real platform in responses, DuplicatePostError→409, workspace-scoped lookup)
 - app/adapters/base.py, linkedin.py, twitter.py, meta.py, dryrun.py (author_urn param; LinkedIn requires it)
 - app/api/accounts.py (LinkedIn openid scopes + userinfo + author_urn metadata; real Twitter PKCE; Redis-backed OAuth state)
 - app/api/deps.py (per-workspace API-key resolver; global token = ops/dev fallback)
 - app/api/jobs.py (real platform in responses)
 - app/api/publish.py (409 on duplicate)
 - app/api/admin.py (new — mint per-workspace API keys)
 - app/models.py (ApiKey model), alembic/versions/002_add_api_keys.py (new migration)
 - tests/conftest.py (db fixture alias, seed_test_accounts), tests/unit/test_multi_tenant.py (new), tests/unit/test_worker_dogfood.py (new), tests/unit/test_scheduler.py, tests/unit/test_adapters.py
tests:
 - Full suite 182 passed (was 167 baseline; +15 new/updated)
 - Live: /healthz healthy (db+redis+workers); LinkedIn post #1 via /publish (urn:li:share:7489056989533253633); LinkedIn post #2 via /schedule+beat+worker (urn:li:share:7489060292774211584)
---

## Prompt

User approved the thin-SDD sprint plan and said: "proceed as planned fully step by step directly and 1000% production level from in the real world okay … implement this plan word by word and character by character explicitly okay go for it please all in the fully auto mode." Leave git/GitHub untouched for now (repo not tied to GitHub). Execute Phase 0 (env restore + script fixes), Phase A (spec amendment), Phase B (3 ADRs), Phase C (Phase 9 tasks), Phase D (12 fixes + tests), and the dogfood gate (real LinkedIn publish through the engine).

## Response snapshot

Executed the full sprint. Phase 0: restored `.env` (kept LINKEDIN_*, generated FERNET_KEY/SDE_API_TOKEN/SDE_SIGNING_SECRET/DB password), created scripts/_env_utils.py, fixed both OAuth scripts to append tokens without clobbering other keys. Phase A: specs/001-social-sde/MULTI_TENANCY.md. Phase B: 3 ADRs (auth model, LinkedIn persona, refresh strategy). Phase C: tasks.md Phase 9 (T055-T067). Phase D: implemented all 12 fixes with 15 new/updated tests; full suite 167→182 green. Dogfood gate: started postgres+redis (rotated DB password to match .env), ran migrations 001→002 (api_keys live), seeded LinkedIn account (refreshed token, userinfo sub sUHgY5YhVR, author URN), started API+worker+beat, published TWO real LinkedIn posts through the engine: #1 via POST /api/v1/publish (urn:li:share:7489056989533253633), #2 via /schedule → beat → worker (urn:li:share:7489060292774211584, HTTP 201 to /v2/ugcPosts from the worker).

Additional live defects found and fixed during the gate: (a) worker had no platform adapters (FastAPI lifespan never runs in Celery) → silently fell back to DryRun → added register_default_adapters() wired into celery_app import + main lifespan; (b) post-level status never recomputed after worker publish → added _sync_post_status() in process_target.

## Outcome

- ✅ Impact: The SDE now publishes through its own pipeline, end-to-end, for both immediate and scheduled paths; multi-tenant auth (per-workspace API keys) + durable OAuth state + real token refresh are in place; 3 ADRs + spec amendment recorded; dogfood evidence on the user's live LinkedIn.
- 🧪 Tests: 182 passed locally (unit+integration+e2e, SQLite); migrations 001→002 verified against Postgres; live LinkedIn publishes verified (201, share URNs captured).
- 📁 Files: listed above (~25 files created/modified).
- 🔁 Next prompts: fill TWITTER_* in .env (X credits still depleted — posting blocked externally); Meta/Facebook live; deploy to public HTTPS + hosted Postgres/Redis; per-workspace key issuance endpoint usage; optionally register a test webhook receiver to see live post.published events.
- 🧠 Reflection: The dogfood gate was essential — three runtime bugs that unit tests could not fully surface (worker task registration, worker adapter registration, post-status aggregation) only appeared when the real stack ran. "Works in scripts" ≠ "works in the engine" was the exact gap this sprint existed to close.

## Evaluation notes (flywheel)

- Failure modes observed: beat task-name mismatch; async adapter not awaited in sync Celery task; token not decrypted (platform_account_id passed as token); autodiscover_tasks not importing the scheduler module (worker had zero tasks registered); worker lacking platform adapters (DryRun fallback); post status not aggregated in the worker path; LinkedIn deprecated scope; hardcoded PKCE verifier; .env clobbered by OAuth scripts; hardcoded "dryrun" platform in job responses; idempotency race → 500; global-token multi-tenant leak; token refresh stub; in-memory OAuth state.
- Graders run and results (PASS/FAIL): PASS — 182/182 tests; live LinkedIn 201s; /healthz healthy.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): register a webhook receiver and confirm post.published events fire for a scheduled publish; then Meta/Facebook live publish through the same pipeline.
