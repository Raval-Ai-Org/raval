---
id: 0009
title: production hardening from proposal and audit
stage: general
date: 2026-09-12
surface: agent
model: claude-opus-5
feature: none
branch: main
user: pakistanbooster-lgtm
command: "Implement everything necessary to make Mellox AI complete, polished, secure, scalable, and production-ready (Evolve proposal v2.0 + Unified Forensic Audit 2026-09-11)"
labels: ["security", "scheduler", "webhooks", "multi-tenant", "celery", "production-config"]
links:
  spec: null
  ticket: null
  adr: ../../../../docs/adr/0007-agent-control-plane.md
  pr: null
files:
  - app/services/scheduler_tasks.py
  - app/services/publisher.py
  - app/services/webhook_out.py
  - app/security.py
  - app/config.py
  - docker-compose.yml
  - .github/workflows/ci.yml
  - tests/conftest.py
  - tests/unit/test_claim_due_targets.py
  - tests/unit/test_webhook_out.py
  - tests/unit/test_multi_tenant.py
  - tests/unit/test_security.py
tests:
  - pytest (237 passed, SQLite)
  - ruff check app tests (clean apart from two pre-existing findings in app/api/accounts.py)
---

## Prompt

First, carefully read and understand ALL attached documents and the complete codebase. Use them together as the source of truth. Identify every requirement, issue, missing feature, architectural weakness, security concern, UX problem, and recommended improvement across the documents. Then independently create and execute the best implementation plan. Adapt your approach based on what you discover in the documents and codebase rather than following a limited predefined checklist. Implement everything necessary to make Mellox AI complete, polished, secure, scalable, and production-ready. Upgrade the architecture into a proper modular AI-agent system wherever the documents indicate it is needed. Do not only analyze or report. Actually modify the code, test every change, fix failures, and continue iterating until all document requirements and major end-to-end flows are properly implemented. Skip payment integration and admin dashboard for now.

## Response snapshot

SDR-side changes (the app-side work is recorded in the main repo's docs/adr/0007 and 0008):

- Scheduler tick (`claim_due_targets`) claims only targets that are due: scheduled posts whose time has come, unscheduled targets whose immediate dispatch was lost (5-minute grace), and `retrying` targets whose `next_attempt_at` has passed. Claims use `FOR UPDATE SKIP LOCKED` on Postgres; `claim_target_for_processing` is an atomic ownership guard so two workers never publish the same target. Fixes scheduled posts going out immediately.
- Delivery logs carry the post's `workspace_id` (tenant attribution); `schedule()` validates every account against the calling workspace at ingress (422, not a misleading 409); `_build_job_response` scopes its account lookup.
- Outbound webhooks: one attempt per call, transient failures re-enqueued via the `webhooks.redeliver` Celery task with 5 s / 30 s / 120 s countdowns; every attempt is re-signed with a fresh timestamp; no blocking `time.sleep`, no DB session held across retries.
- `verify_signature` rejects an empty secret and enforces timestamp freshness; production config refuses known dev default secrets.
- docker-compose marked local-only: ports bound to 127.0.0.1, Flower behind a `monitoring` profile with required basic auth.
- Known dev/test values in docker-compose, CI and test fixtures are marked `secret-scan:allow`; the production values formerly in ADR-0005 were removed and listed for rotation in docs/OPERATIONS-RUNBOOK.md.

## Outcome

- ✅ Impact: scheduled posts publish at their time, not immediately; no double publishing across workers; callbacks cannot be replayed with a stale timestamp or verified with an empty secret; cross-tenant account use rejected at schedule time.
- 🧪 Tests: 237 pytest passed (new: claim_due_targets suite, webhook redelivery via a fake queue, schedule ingress tenancy, signature freshness, dev-secret refusal).
- 📁 Files: listed above.
- 🔁 Next prompts: rotate every credential in the runbook's rotation list; deploy the SDR with the new config validation; run the root CI `sdr` job.
- 🧠 Reflection: the scheduling bug came from the tick treating "not yet published" as "due"; separating the three claim reasons made both the query and the tests obvious.

## Evaluation notes (flywheel)

- Failure modes observed: webhook tests initially hung because the real Celery `apply_async` tried to reach Redis; replaced with an autouse fake queue that drains deterministically.
- Graders run and results (PASS/FAIL): pytest PASS; ruff PASS (pre-existing findings excluded).
- Prompt variant (if applicable): none.
- Next experiment (smallest change to try): run the claim query against real Postgres in CI to exercise SKIP LOCKED contention.
