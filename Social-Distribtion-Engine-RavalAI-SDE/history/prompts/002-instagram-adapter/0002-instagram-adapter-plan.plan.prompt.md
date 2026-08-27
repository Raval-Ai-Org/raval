---
id: 0002
title: instagram-adapter plan
stage: plan
date: 2026-08-03
surface: agent
model: claude-opus
feature: instagram-adapter
branch: 002-instagram-adapter
user: nauman_sajjad
command: /sp.plan
labels: ["instagram", "facebook", "meta", "adapter", "plan", "oauth"]
links:
  spec: specs/002-instagram-adapter/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - specs/002-instagram-adapter/plan.md
  - specs/002-instagram-adapter/research.md
  - specs/002-instagram-adapter/data-model.md
  - specs/002-instagram-adapter/contracts/meta-api.md
  - specs/002-instagram-adapter/quickstart.md
  - specs/002-instagram-adapter/spec.md (amended: OAuth-first US1 + FR-001/002/012)
  - specs/002-instagram-adapter/checklists/requirements.md (updated)
  - history/prompts/002-instagram-adapter/0002-instagram-adapter-plan.plan.prompt.md
tests:
  - No code tests this stage; baseline 182 passed / 9 warnings (re-run after implementation)
---

## Prompt

Plan the instagram-adapter feature per specs/002-instagram-adapter/spec.md. Critical architectural contract from the spec and MULTI_TENANCY.md: ONE RavalAI-owned Meta app, built once; clients authorize only via the existing OAuth flow in app/api/accounts.py (oauth_start/oauth_callback, Redis state, encrypted per-workspace tokens); no per-client developer accounts or credentials. Key gaps the plan must address: (1) extend Facebook OAuth to resolve a Page (page_id + page access token) instead of storing the user profile — the FacebookAdapter expects page_id|token; (2) add Instagram to the OAuth platform list + _exchange_code_for_token + _fetch_user_profile, resolving IG user id from the linked Page (GET /{page-id}?fields=instagram_business_account); (3) new app/adapters/instagram.py implementing the two-stage media -> media_publish flow; (4) register instagram adapter; (5) tests. Note: existing Facebook OAuth stores /me (user) — that must be revisited. Keep the user's test-only creds out of the plan as a product path (dev/test seed is acceptable as a fallback only).

## Response snapshot

Verified the authorize-only OAuth flow ALREADY exists in app/api/accounts.py (oauth_start/oauth_callback, Redis durable CSRF state, Fernet-encrypted per-workspace tokens; platform allowlist twitter|linkedin|facebook — instagram missing). Confirmed the user's product intent exactly matches specs/001-social-sde/MULTI_TENANCY.md (one RavalAI dev app per platform; brands authorize through it; encrypted isolated per-account tokens). Key finding: facebook OAuth currently stores the /me user profile, but publisher.py:420-423 already builds page_id|token from metadata — so the OAuth flow must resolve a Page (GET /me/accounts) and store page_id + Page token; instagram resolves ig_user_id via GET /{page_id}?fields=instagram_business_account. Wrote plan.md (constitution check passed — approval boundary, deterministic dispatch, failure taxonomy, encrypted storage, adapter-as-armor, smallest-viable-diff all satisfied), research.md (9 decisions R1-R9), data-model.md (no schema migration; metadata deltas {page_id, persona} / {ig_user_id, page_id, persona}; account_id composites page_id|token / ig_user_id|token), contracts/meta-api.md (v18.0 endpoints + error taxonomy), quickstart.md (authorize-only product path + dev-seed fallback). Amended spec.md to make authorize-only the P1 story (US1) + FR-001/002/012; updated checklist. No ADR triggered this phase (design extends existing patterns; no new architecture). Risks flagged: Meta app-review for production IG publish, IG rate limits, video >60s permission, single-page selection MVP.

## Outcome

- ✅ Impact: Complete implementation plan for Meta (FB Page + IG) via the authorize-only multi-tenant contract; closes the /me-vs-Page gap in existing FB OAuth; defines new InstagramAdapter two-stage flow.
- 🧪 Tests: No code tests this stage; baseline suite = 182 passed, 9 warnings.
- 📁 Files: plan.md, research.md, data-model.md, contracts/meta-api.md, quickstart.md, amended spec.md + checklist, PHR 0002.
- 🔁 Next prompts: /sp.tasks for 002-instagram-adapter, then implementation (sp.implement) + tests, then live wiring (fb then ig) with approved posts.
- 🧠 Reflection: The biggest risk is scope creep — the existing OAuth flow already encodes the user's exact intent, so the plan reuses it rather than rebuilding. The real work is (a) FB Page resolution, (b) IG platform support + adapter, (c) publisher composite, (d) tests. ADR suggestion: none forced this phase; may propose one for "Meta token lifecycle (long-lived Page token + extension vs refresh grant)" if implementation confirms divergence from LinkedIn/X refresh path.

## Evaluation notes (flywheel)

- Failure modes observed: None at plan stage.
- Graders run and results (PASS/FAIL): Constitution gate PASS; spec quality checklist PASS (post-amendment re-check).
- Prompt variant (if applicable): /sp.plan
- Next experiment (smallest change to try): /sp.tasks
