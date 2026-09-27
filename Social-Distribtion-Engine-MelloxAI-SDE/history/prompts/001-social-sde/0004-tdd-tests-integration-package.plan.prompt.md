---
id: 0004
title: TDD tests and integration package
stage: plan
date: 2026-07-29
surface: agent
model: Claude Opus 5
feature: 001-social-sde
branch: 001-social-sde
user: Muhammad Junaid Sajjad
command: /sp.plan + manual dry run + TDD tests + integration package
labels: [testing, tdd, integration, dry-run, coverage]
links:
  spec: specs/001-social-sde/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - tests/unit/test_webhook_out.py (new)
  - tests/unit/test_publisher.py (new)
  - tests/unit/test_scheduler.py (updated)
  - app/celery_app.py (updated)
  - app/services/scheduler_tasks.py (updated)
tests:
  - tests/unit/ - 153 unit tests (up from 140)
  - tests/e2e/test_publish_workflow.py - 13 E2E tests
  - Total: 166 tests, all passing
---

## Prompt

User asked for: expert analysis on OAuth/developer account requirements for social media publishing, dry-run demo of the SDE module, running all tests, adopting TDD for coverage gaps, and preparing integration readiness package. Approved plan: A → B → D → E (skipping C: Twitter setup).

Key questions:

1. Do clients need their own developer accounts? (No — just standard OAuth)
2. How does token refresh work? (Daily Celery beat task, platform-specific refresh logic)
3. Dry run demo to prove system works?
4. Why not TDD alongside?
5. Full E2E visible test in browser?

## Response snapshot

Completed all 4 steps:

- **Step A**: Started Docker stack (PostgreSQL + Redis), API server (port 8001), Celery worker + beat. Ran 8-check visible demo: health ✅, publish ✅, job status ✅, schedule ✅, cancel ✅, auth rejection ✅, multi-target ✅.
- **Step B**: Ran all 153 unit + 13 E2E = 166 tests. All passing. Fixed 2 scheduler tests (task name mismatch).
- **Step D**: Added 13 new TDD tests:
  - 8 webhook delivery tests (was 0% coverage → HMAC signing, timeout, connection error, 404, delivery logs)
  - 5 publisher service tests (idempotency, account not found, inactive account, schedule)
- **Step E**: Updated COMPLETION_REPORT.md with latest metrics (166 tests, 50% coverage)

Fixed issues found:

1. Circular import in celery_app.py → inline beat schedule
2. Beat scheduler task name mismatch → fixed task names
3. Docker Compose v1 incompatibility → used docker run directly
4. Port 8001 instead of 8000 (omniroute on 8000)

## Outcome

- ✅ Impact: System verified working end-to-end with DryRun adapter. 166 tests passing. Coverage improved from 42% to 50%.
- 🧪 Tests: 153 unit + 13 E2E = 166 total, 0 failures
- 📁 Files: 2 new test files, 2 updated source files
- 🔁 Next prompts: Twitter developer account setup for real publishing
- 🧠 Reflection: TDD added meaningful coverage for webhook and publisher paths. Circular import was a design debt from previous implementation. Beat schedule configuration was incomplete.

## Evaluation notes (flywheel)

- Failure modes observed: Circular import between celery_app.py and scheduler_tasks.py; Beat schedule task names didn't match shared_task decorators; Docker Compose v1 incompatibility; Omnibus AI on port 8000
- Graders run and results (PASS/FAIL): PASS - all 166 tests passing, demo visible
- Prompt variant (if applicable): N/A
- Next experiment (smallest change to try): Set up Twitter developer account, configure OAuth, publish a real tweet via the SDE
