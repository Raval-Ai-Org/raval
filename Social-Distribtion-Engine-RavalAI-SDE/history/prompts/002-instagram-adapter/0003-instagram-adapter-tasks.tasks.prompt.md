---
id: 0003
title: instagram-adapter tasks
stage: tasks
date: 2026-08-03
surface: agent
model: claude-opus
feature: instagram-adapter
branch: 002-instagram-adapter
user: nauman_sajjad
command: /sp.tasks
labels: ["instagram", "facebook", "meta", "adapter", "tasks"]
links:
  spec: specs/002-instagram-adapter/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - specs/002-instagram-adapter/tasks.md
  - history/prompts/002-instagram-adapter/0003-instagram-adapter-tasks.tasks.prompt.md
tests:
  - Format validation: 27 tasks, sequential T001-T027, 10 US-labeled, all checklist-compliant
---

## Prompt

Generate implementation tasks for the instagram-adapter feature per specs/002-instagram-adapter/plan.md, research.md, data-model.md, contracts/meta-api.md, and spec.md. Cover: (1) extend facebook OAuth to resolve a Page (page_id + Page token via GET /me/accounts) instead of /me, (2) add instagram to OAuth platform allowlist + _exchange_code_for_token + _fetch_user_profile with IG resolution via GET /{page_id}?fields=instagram_business_account, (3) new app/adapters/instagram.py implementing two-stage media -> media_publish (image + video, caption, permalink), (4) register instagram in adapters/__init__.py, (5) publisher instagram account_id composite (ig_user_id|token), (6) scripts/seed_meta_account.py dev-only fallback, (7) unit tests (adapter success + error taxonomy + publisher composite). Baseline 182 tests must stay passing.

## Response snapshot

Ran check-prerequisites.sh (FEATURE_DIR specs/002-instagram-adapter; docs research/data-model/contracts/quickstart present). Loaded tasks-template.md. Generated specs/002-instagram-adapter/tasks.md: 27 tasks (T001-T027) across 8 phases — Setup (baseline + Meta settings), Foundational (instagram allowlist T003, Meta long-lived/page helpers T004), US1 authorize-only (no-credential-leak test + audit), US2 FB Page connect+publish MVP (page resolution rewiring + tests), US3 IG connect+image publish (exchange/profile branches, new InstagramAdapter two-stage image flow, publisher ig_user_id|token composite, registry registration), US4 IG video, US5 delivery/error visibility, Polish (seed_meta_account.py dev-only, full-suite gate, FR-012 security audit). Dependency chain US1→US2→US3→US4 with US5 parallel. MVP = US1+US2 (Facebook). TDD ordering within stories (tests before implementation). Format validated: all 27 start with `- [ ] T###`, sequential IDs, 10 [P][USn]-labeled.

## Outcome

- ✅ Impact: Immediately executable task list for the Meta feature; TDD; clear file paths (accounts.py:228/472/529, publisher.py:420, adapters/__init__.py, new instagram.py); MVP slice identified.
- 🧪 Tests: Format validation passed (27 tasks, sequential, US-labeled). Baseline suite = 182 passed / 9 warnings (not re-run this stage — gate is T025 at implementation).
- 📁 Files: tasks.md, PHR 0003.
- 🔁 Next prompts: /sp.implement (execute tasks) → red/green, then live wiring (fb → ig) with approved posts.
- 🧠 Reflection: No ADR forced. Scope stays within adapter + OAuth extensions; no new tables. The FB `/me`→Page fix (T009) and IG adapter (T016) are the two substantive pieces; everything else is wiring/tests.

## Evaluation notes (flywheel)

- Failure modes observed: None at tasks stage.
- Graders run and results (PASS/FAIL): Tasks format validation PASS (27 tasks, checklist-compliant).
- Prompt variant (if applicable): /sp.tasks
- Next experiment (smallest change to try): /sp.implement
