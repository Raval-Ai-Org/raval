---
id: 0006
title: Multi-tenant readiness review
stage: plan
date: 2026-07-31
surface: agent
model: opencode-deepseek-v4-flash-free
feature: 001-social-sde
branch: 001-social-sde
user: nauman_sajjad
command: (conversational request — continue prior session)
labels: ["multi-tenant", "architecture", "oauth", "roadmap", "social-sde"]
links:
  spec: /home/nauman_sajjad/Desktop/Raval-AI/specs/001-social-sde/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - (none — architecture review only; no code changed)
tests:
 - (none — design discussion)
---

## Prompt

User asked whether the SDE pipeline is "good to go" for its real purpose: integration into the
RavalAI platform where many clients (brands) authorize their own social media accounts through
the platform (one developer account / module system), and RavalAI posts on their behalf from
content generated from their brand data. Asked what is needed next to go forward with this.
Verbatim excerpt: "since this module will be integrated into the RavalAI platform... not this
LinkedIn only but many platforms... is this pipeline good to go for this? As the platform needs
only 1 developer account or such backend/module system that will ask the client to authorize
their social media platform so we will post on their behalf from the posts they generated based
on their brand stuff etc through our platform. What is needed next to me do tell me please how
do we go forward with this."

## Response snapshot

Verdict: the architecture shape is right (multi-tenant data model, adapter pattern, queue-first
durability, idempotency, HMAC webhooks) and one RavalAI dev app per platform is the correct
model (Buffer/Omni-style); each client authorizes through it and gets their own encrypted token
pair stored per account. BUT the module is not yet operationally ready for real clients.

Identified 6 gaps:
1. Worker-to-adapter token wiring broken — process_target passes platform_account_id, adapters
   expect the OAuth bearer token; worker must decrypt encrypted_access_token (Fernet) and pass
   the real token (scheduler_tasks.py:233, linkedin.py:122, twitter.py:136).
2. Token refresh is a stub/TODO (scheduler_tasks.py:356-364) — clients silently stop posting.
3. OAuth state store is in-memory (accounts.py:27) — breaks on restart/multi-instance.
4. Auth is one global SDE_API_TOKEN mapping everyone to workspace_001 (deps.py:73-85); data is
   workspace-scoped but auth is not — Client A could touch Client B.
5. LinkedIn OAuth scope in engine uses r_liteprofile (accounts.py:213) — the same
   openid_insufficient_scope_error already hit; must be openid profile email w_member_social.
   Also need person-vs-Page decision (w_organization_social).
6. Deployment: OAuth callbacks must be public HTTPS; needs hosted Postgres + Redis.

Recommended order: (1) close gaps 1+5 by publishing a real LinkedIn post through the engine's
own pipeline (dogfooding); (2) close gap 4 with per-workspace API keys; (3) close gaps 2+3 with
real per-platform token refresh + Redis-backed state; (4) Meta/Facebook live; (5) deploy and
onboard a real brand. Suggested ADRs: multi-tenant auth model (API keys vs JWT) and LinkedIn
posting persona (person vs Page).

## Outcome

- ✅ Impact: Clear multi-tenant readiness assessment; confirmed one-dev-app-per-platform model;
  ranked the 6 gaps and a 5-step forward plan. No code changed (design discussion only).
- 🧪 Tests: none run.
- 📁 Files: history/prompts/001-social-sde/0006-multi-tenant-readiness-review.plan.prompt.md.
- 🔁 Next prompts: implement gap 1+5 (engine dogfooding on LinkedIn); implement gap 4
  (per-workspace auth); then gaps 2+3.
- 🧠 Reflection: The engine's data model already anticipates multi-tenancy; the true blockers are
  runtime concerns (token decryption path, real refresh, state store, auth resolution) — these
  must be fixed before any real client account is onboarded.

## Evaluation notes (flywheel)

- Failure modes observed: worker passes identity ID where token expected (contract mismatch
  between scheduler and adapters); global auth token masks tenant boundaries; in-memory OAuth
  state is not horizontally scalable; LinkedIn scope string in engine contradicts verified
  working scope from scripts.
- Graders run and results (PASS/FAIL): PASS — assessment grounded in file references.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): fix gap 1 — decrypt token in process_target and
  pass real bearer token to adapter.publish; verify with real LinkedIn publish via /api/v1/publish.

## Follow-up prompt (2026-07-31)

User asked: (1) Is this module good to go for the full RavalAI platform, or do we also need to
build RavalAI from scratch too — only this one module or more? (2) Will this module, built inside
the Ubuntu system, work inside a Windows-based project or a RavalAI codebase made with Lovable?
(3) Think multidimensionally — answer all 7 W + 1 H questions (who/what/when/where/why/which/
whom/how) about the pipeline readiness, then add all these answers + the analysis into this
multi-tenant readiness review file.

## Addendum — Full-platform readiness: answers + 7W/1H analysis

### Q1 — Is this module good to go, or does RavalAI also need to be built from scratch?

The module is the "last mile" of RavalAI — the Social Media distribution & scheduling gateway
(accept approved posts → schedule → queue → retry → publish to X/LinkedIn/Facebook/Instagram via
client-authorized accounts). It is good to go as ONE bounded service inside the platform and must
NOT be rebuilt or ported. It is, however, not the whole platform. The rest of RavalAI — per-tenant
auth/user management, brand-data ingestion, LLM content orchestration, ChatGPT-like UI, analytics,
billing — is greenfield; it does not yet exist as code in this repo (only CLAUDE.md + specs describe
it). Plan: keep the SDE as the distribution service, expose it via REST + HMAC webhooks, and build
the remaining platform surfaces around it. In short: build the platform, reuse the SDE.

### Q2 — Will the Ubuntu-built module work in a Windows-based / Lovable-based project?

Yes. The SDE is a self-contained Python service (FastAPI + Celery + PostgreSQL + Redis) behind
REST + webhooks. Python and Docker abstract the host OS, so it is fully cross-platform. If the
rest of the project runs on Windows or is a Lovable (React) frontend, integration happens over
HTTP — the frontend stack is irrelevant. Practical rules:
(a) never migrate the Ubuntu venv itself — recreate it via pip/Docker;
(b) on Windows use Docker Desktop/WSL2 to run the stack;
(c) deploy all services to Linux servers in production (standard anyway);
(d) minor gotchas: asyncpg/psycopg have Windows wheels, avoid shell-specific scripts, use
relative paths;
(e) if RavalAI's backend is Node, keep the Python SDE as a sidecar service rather than porting —
matches CLAUDE.md 3.1 (modular-monolith/extraction doctrine) and 3.2 (queue-first).

### 7 W + 1 H analysis

| Q | Answer |
|---|--------|
| **WHO** | Actors: RavalAI clients (brands) authorize their own social accounts via OAuth and approve every publish (approval gate = brand's human); RavalAI engineering owns/operates the module; the system posts on the brand's behalf; platform AI agents interact via a capability layer. |
| **WHAT** | The module = last-mile distribution engine (schedule → queue → retry → publish; adapters for X/LinkedIn/Facebook/Instagram; idempotency; HMAC webhooks; encrypted token storage). Still needed around it: tenancy/auth, brand ingestion, LLM content orchestration, UI, analytics, billing. NOT needed: a rebuilt SDE. |
| **WHEN** | Integrate now as the Phase-1 distribution service; first close gaps 1–6; deploy to public HTTPS; then onboard a pilot brand. Clients connect accounts at onboarding; posts fire at scheduled time after approval. |
| **WHERE** | Runs today on local Ubuntu (venv + Docker Compose). Production = Docker on Linux servers; host OS irrelevant (Docker/WSL2 on Windows is fine). In-platform position: a backend service behind the platform API, reached by the frontend via REST + webhooks. |
| **WHY** | One RavalAI dev app per platform: platform OAuth rules require a single registered app; centralizes cost/quota; per-account tokens isolate consent, quotas, and revocations per client. Queue-first durability prevents lost posts when platforms fail (CLAUDE.md 2.1/2.2/3.2). |
| **WHICH** | Phase-1 platforms: X, LinkedIn, Facebook, Instagram (Instagram shares the Meta app). Reusable from this module: adapters, scheduler, webhooks, idempotency, models, security. To build: tenancy, frontend, analytics, content/LLM layer, billing. |
| **WHOM** | Serves brand clients and their audiences; answers to RavalAI leadership (Zain) and the platform's AI agents via a capability layer; final approval authority = the brand's human (approval boundary, CLAUDE.md 4.3). |
| **HOW** | (1) Close gap 1+5 — dogfood a real LinkedIn publish through POST /api/v1/publish; (2) close gap 4 — per-workspace API keys; (3) close gaps 2+3 — real per-platform token refresh + Redis-backed OAuth state; (4) Meta live publish; (5) HTTPS deploy + hosted Postgres/Redis; (6) pilot brand onboarding. Integrate as REST service + HMAC webhooks; add MCP wrapper later (CLAUDE.md 4.5). |

### Bottom line

- The SDE is production-grade as an independent service and must be reused, not rebuilt.
- It is NOT the entire RavalAI platform; the surrounding product surfaces are greenfield.
- Cross-platform (Ubuntu/Windows/Lovable/Node) is a non-issue: Docker + HTTP + sidecar service.
- The 6 gaps in this file are the only real blockers between "tested on my own account" and
  "client-facing multi-tenant module".
