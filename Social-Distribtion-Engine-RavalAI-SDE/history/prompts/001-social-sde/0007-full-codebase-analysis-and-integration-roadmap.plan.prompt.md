---
id: 0007
title: Full codebase analysis and integration roadmap
stage: plan
date: 2026-07-31
surface: agent
model: claude-code-auto
feature: 001-social-sde
branch: 001-social-sde
user: nauman_sajjad
command: (conversational request — continue prior session)
labels: ["read-only-review", "multi-tenant", "integration", "roadmap", "social-sde"]
links:
  spec: specs/001-social-sde/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - (none changed — read-only analysis only)
tests:
 - (none — read-only review, no tests run)
---

## Prompt

User reported (verbatim, lightly normalized): Twitter/X setup done — authorization successful but posting errored because X free-tier API credits depleted (HTTP 402). LinkedIn done and fully successful (100%) — first real post published. Asked me to look at
history/prompts/001-social-sde/0006-multi-tenant-readiness-review.plan.prompt.md, read the whole codebase (read-only, no testing) "especially these all files", and give a full analysis of the project/prompt and what the reply should be, answered from the industry-expert persona, plus how to move forward for the integration. Also noted that earlier today Claude Code was not running so OpenCode was used in this project, and an AGENTS.md file was created pointing at CLAUDE.md. Full verbatim prompt:

"ultrathink well i need to tel you a few things now okayu , i have done the twiter set it was set up aithorization al successful but the posting ws got into error due to my X-free api credti depleted okay and as for the linkednit go successfully okay anbd i had gien it al the things in it okay asn asn for the last stuff i did some of theseowrks now : history/prompts/001-social-sde/0006-multi-tenant-readiness-review.plan.prompt.md   do see these all okaya and go for runing th ecode bases as i told you previousy tody at noon my claude coe was not runniign so i used open code in this project okay and also made an agents.md fiel thatwa srequired by the opencode and in it i pointed the claude.md okay  so inthis way i wen tup and complete dmy projhect and alhamdulliha all got done both linked 1005 successfuly now and as for thge twitter ti also almost done aurthoriationwas succesfuly bu the posting was not succesful as api credit got deplted as the free tier only has the limnited ones okay , now as all is done for now no need to test any thign just read only the whole ocde bas especal these al fiels first for me okay and also read thi sabove given path of file and ansser thing or think it throrugh onitu and giv em efull analyssis of mypropt and hat cshodl be the reply that yousay do answer this form the industry expoert persona okay abns also tell me how to mocve forward fo rht integration okay ;"

## Response snapshot

Confirmed project state: LinkedIn live posting succeeded (urn:li:share:7488998692532768768) via scripts/linkedin_oauth_and_post.py with OAuth scopes openid/profile/email + w_member_social and NO PKCE (confidential client). Twitter auth + token refresh validated end-to-end; posting blocked only by X free-tier credit gate (402). The 6 multi-tenant gaps recorded in 0006 remain OPEN (no code changed since). Additional runtime defects found on read (not previously recorded): (1) Celery beat task-name mismatch — beat_schedule references app.services.scheduler_tasks.tick_due_jobs but tasks are registered as scheduler.tick_due_jobs → scheduled pipeline will not fire; (2) process_target calls async adapter.publish without await → coroutine never awaited → AttributeError → every scheduled publish fails transient then exhausts retries; (3) worker/immediate paths pass account.platform_account_id as the Bearer token — encrypted_access_token is never decrypted, so real platform tokens never reach adapters; (4) accounts.py Twitter OAuth sends code_verifier "challenge" with no corresponding code_challenge in the authorize URL → engine Twitter OAuth broken; (5) LinkedIn scope in accounts.py still r_liteprofile (deprecated) — contradicts the verified working scope; (6) WebhookService is defined but never invoked — FR-011 webhooks are not wired to publish/schedule events; (7) jobs/publisher responses hardcode platform="dryrun"; (8) .env was destructively rewritten by the OAuth scripts and now contains only LINKEDIN_* keys — all app-required settings (POSTGRES_PASSWORD, SDE_API_TOKEN, SDE_SIGNING_SECRET, FERNET_KEY, TWITTER_*) are missing from .env; (9) entire codebase is uncommitted — single git commit, everything untracked (no VCS safety net; venv/, htmlcov/, celerybeat-schedule, egg-info not ignored); (10) plan.md is still the raw template ([FEATURE], NEEDS CLARIFICATION) — real planning lives in PHR 0002 + COMPLETION_REPORT; (11) idempotency check-then-insert race → 500 instead of 409 on concurrent duplicate; (12) account lookups not workspace-scoped in publisher/worker paths.

Verdict (industry-expert persona): Architecture shape is right (modular monolith, adapter pattern, queue-first, idempotency, HMAC webhooks, Fernet at rest) and one-RavalAI-dev-app-per-platform is the correct multi-tenant model. But the engine has NEVER yet published through its own pipeline — both live posts were made by the standalone scripts, not via POST /api/v1/publish or /schedule + worker. Blockers are runtime wiring, not design. Recommended order: (1) commit everything + restore a complete .env; (2) fix beat task names + await in process_target + decrypt-and-pass token (dogfood a real LinkedIn publish through the engine); (3) fix LinkedIn scope + Twitter PKCE in accounts.py; (4) wire webhooks; (5) per-workspace API keys (gap 4); (6) real token refresh + Redis state (gaps 2+3); (7) Meta/Facebook live; (8) HTTPS deploy + hosted Postgres/Redis + pilot brand. Suggested ADRs: multi-tenant auth model, LinkedIn posting persona (person vs Page), token refresh strategy.

## Outcome

- ✅ Impact: Delivered full read-only codebase analysis; verified the two live integrations; confirmed 0006's 6 gaps still open and surfaced ~10 additional runtime defects; gave prioritized integration roadmap. No code changed (analysis only).
- 🧪 Tests: none run (user asked for read-only).
- 📁 Files: inspected app/, scripts/, specs/, history/, docker-compose.yml, .env.example; wrote history/prompts/001-social-sde/0007-full-codebase-analysis-and-integration-roadmap.plan.prompt.md.
- 🔁 Next prompts: implement gap 1+5+15+16 (engine dogfooding on LinkedIn through its own pipeline); then gaps 2/3/4/9 (refresh, Redis state, per-workspace auth, webhook wiring); then Meta + deploy.
- 🧠 Reflection: The scripts proved OAuth mechanics but bypassed the engine's own pipeline; the true gaps are runtime wiring defects (beat task names, missing await, token decryption, scope/PKCE mismatch, unwired webhooks) plus the lack of any git commit and a clobbered .env — those must be fixed before any real client account is onboarded.

## Evaluation notes (flywheel)

- Failure modes observed: async adapter called without await in sync Celery task; beat schedule task-name mismatch; token decryption skipped in worker path; hardcoded PKCE verifier with no challenge; deprecated LinkedIn scope in engine vs verified working scope; webhook service never called; destructive .env rewrite by OAuth scripts; uncommitted codebase; hardcoded "dryrun" platform in job responses; idempotency race; non-workspace-scoped account lookups.
- Graders run and results (PASS/FAIL): PASS — analysis grounded in file references (scheduler_tasks.py, celery_app.py, accounts.py, publisher.py, jobs.py, webhook_out.py, .env, git status).
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): fix scheduler_tasks.py beat names + await + token decrypt, then publish a real LinkedIn post via POST /api/v1/publish (dogfood).
