---
id: 0004
title: instagram-adapter implementation
stage: green
date: 2026-08-03
surface: agent
model: claude-opus
feature: instagram-adapter
branch: 002-instagram-adapter
user: nauman_sajjad
command: /sp.implement
labels: ["instagram", "facebook", "meta", "adapter", "implement", "oauth"]
links:
  spec: specs/002-instagram-adapter/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - app/adapters/instagram.py (NEW)
  - app/adapters/__init__.py (register instagram)
  - app/api/accounts.py (allowlist + Meta helpers + callback rewire)
  - app/services/publisher.py (instagram composite)
  - scripts/seed_meta_account.py (NEW, dev-only)
  - tests/unit/test_adapters.py (Instagram adapter tests)
  - tests/unit/test_oauth_flow.py (NEW)
  - tests/unit/test_publisher.py (composite tests)
  - .env.example (META_PAGE_ACCESS_TOKEN)
  - .dockerignore (NEW)
  - specs/002-instagram-adapter/tasks.md (all 27 marked done)
tests:
  - Full suite: 209 passed, 9 warnings (baseline was 182; +27 new)
  - test_adapters: 55 passed (incl. Instagram success/error/video)
  - test_oauth_flow: 8 passed (Page/IG resolution, authorize-only contract)
  - test_publisher: 8 passed (incl. ig_user_id|token and page_id|token composites)
---

## Prompt

Execute the implementation plan in specs/002-instagram-adapter/tasks.md for branch 002-instagram-adapter. Tasks T001-T027. Baseline: 182 tests passing. Implement the Instagram adapter, Facebook OAuth Page resolution, Instagram OAuth support, publisher composite, registry, tests, and dev seed script per the task list.

## Response snapshot

Executed /sp.implement end-to-end. Setup: baseline suite green (182), Meta settings confirmed, created .dockerignore. Foundational: added instagram to oauth_start allowlist + Meta branch (IG scopes), added _exchange_long_lived_token + _resolve_primary_page helpers. US1: added authorize-only contract tests (AccountResponse never leaks credentials); audited schema (no leak). US2 (MVP): rewired oauth_callback so facebook resolves a Page (page_id + Page token, metadata {page_id, persona}), not /me; added facebook composite test. US3: added _resolve_instagram_account + _resolve_meta_identity helpers; instagram token exchange + profile resolution; created app/adapters/instagram.py (two-stage media->media_publish->permalink, image + video, full error taxonomy: Auth 190/403, RateLimit 429/18/613, Transient 5xx, Fatal 4xx); registered instagram in registry; publisher instagram composite (ig_user_id|token). US4: video branch + tests. US5: error matrix + delivery tests. Polish: dev-only seed_meta_account.py, .env.example META_PAGE_ACCESS_TOKEN, FR-012 security audit (no token logging found). Final: 209 passed, 9 warnings — 27 new tests over baseline 182, no regressions.

## Outcome

- ✅ Impact: Instagram Content Publishing adapter live in the engine (image + video, two-stage flow, permalink); Facebook connect now resolves a Page (not /me) through the authorize-only OAuth flow; ONE RavalAI Meta app contract honored (FR-001/002); dev seed script isolated as test-only.
- 🧪 Tests: 209 passed / 9 warnings (baseline 182 → +27). New: test_oauth_flow.py (8), instagram adapter tests (13), publisher composites (3), authorize-only contract (2).
- 📁 Files: 4 source changes + 2 new source files + 3 test files touched + .env.example + .dockerignore + tasks.md (all 27 [x]).
- 🔁 Next prompts: Live wiring (blocked on user's Meta app + Page token in .env): seed/authorize facebook → approved test post → instagram. Then commit branch.
- 🧠 Reflection: Two test-fix iterations: (1) respx regex `/media` matched `/media_publish` (needs anchoring); (2) authorize-only test over-matched `token` in `token_expires_at` (refined to explicit secret names). Both were test bugs, not code bugs. The OAuth flow already existed and matched the user's exact product intent — the implementation closed the /me-vs-Page gap and added IG end-to-end.

## Evaluation notes (flywheel)

- Failure modes observed: respx URL regex over-match; over-broad credential-name check in a guard test.
- Graders run and results (PASS/FAIL): Full suite PASS (209); adapter/oauth/publisher unit suites PASS; security audit PASS (no leaks).
- Prompt variant (if applicable): /sp.implement
- Next experiment (smallest change to try): live facebook wiring once Meta creds land; propose /sp.adr meta-token-lifecycle if refresh diverges from LinkedIn/X.
