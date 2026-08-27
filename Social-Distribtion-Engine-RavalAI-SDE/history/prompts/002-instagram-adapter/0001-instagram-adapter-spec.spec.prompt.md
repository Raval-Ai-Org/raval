---
id: 0001
title: instagram-adapter spec
stage: spec
date: 2026-08-03
surface: agent
model: claude-opus
feature: instagram-adapter
branch: 002-instagram-adapter
user: nauman_sajjad
command: /sp.specify
labels: ["instagram", "facebook", "meta", "adapter", "spec"]
links:
  spec: specs/002-instagram-adapter/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - specs/002-instagram-adapter/spec.md
  - specs/002-instagram-adapter/checklists/requirements.md
  - history/prompts/002-instagram-adapter/0001-instagram-adapter-spec.spec.prompt.md
tests:
  - No code tests this stage (spec-only); existing suite baseline 182 passed
---

## Prompt

Add an Instagram Content Publishing adapter to the RavalAI Social Distribution Engine, plus the wiring to connect a Facebook Page live. Feature: "instagram-adapter". Requirements: (1) Instagram adapter implementing the Graph API two-step flow — POST /{ig-user-id}/media (image_url|caption or video_url|media_type) then POST /{ig-user-id}/media_publish with creation_id; supports images and videos, caption text, IG user-id lookup from the linked Facebook Page (GET /{page-id}?fields=instagram_business_account); mirrors the existing BaseAdapter interface (validate_content, publish, get_capabilities, error taxonomy via app/adapters/errors.py). (2) Facebook wiring: FACEBOOK_CLIENT_ID/SECRET creds in .env, a seed script to register a live facebook Account row (page_id|access_token) encrypted like scripts/seed_linkedin_account.py, and a live end-to-end test via /publish. Permissions required: pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish. API version Graph v18.0.

## Response snapshot

Ran /sp.specify. Verified no existing instagram branches; highest feature number was 001, so created branch 002-instagram-adapter via create-new-feature.sh. Wrote specs/002-instagram-adapter/spec.md with 4 prioritized user stories (P1 Facebook connect+publish, P1 Instagram image publish via two-stage media-then-publish flow, P2 video publish, P3 delivery visibility), 10 functional requirements (FR-001..FR-010), key entities (Account/Post/PostTarget/DeliveryLog), 5 measurable success criteria, and assumptions (Meta app prerequisite, IG-to-Page linkage prerequisite, shared app for FB+IG). Created checklists/requirements.md — all items pass first pass, no [NEEDS CLARIFICATION] markers. Also grounded the work: probed the live system (stack currently down; docker-compose present, 182 tests passing) and noted the Twitter 402 credits-depleted blocker from the prior session. Earlier in session: refreshed expired Twitter tokens live (OAuth refresh works, users/me OK, write blocked by credits).

## Outcome

- ✅ Impact: New feature spec defining Instagram Content Publishing adapter + Facebook Page wiring, following existing 001-social-sde patterns and the Meta two-stage content publishing flow.
- 🧪 Tests: No tests this stage; baseline suite = 182 passed, 9 warnings.
- 📁 Files: spec.md, checklists/requirements.md, PHR 0001 (all under specs/002-instagram-adapter and history/prompts/002-instagram-adapter).
- 🔁 Next prompts: /sp.plan for the instagram-adapter feature, then /sp.tasks, then implementation.
- 🧠 Reflection: Instagram is a genuine new adapter (spec.md:122 had deferred it); Facebook adapter exists and is registered but needs creds+seed. Dependency order FB→IG is inherent to Meta (IG linked to Page).

## Evaluation notes (flywheel)

- Failure modes observed: None at spec stage.
- Graders run and results (PASS/FAIL): Spec quality checklist PASS (all items).
- Prompt variant (if applicable): /sp.specify
- Next experiment (smallest change to try): /sp.plan
