# Mellox AI Master Context

This document is the working technical bible for the repository as it exists today. It is intentionally architecture-first: it explains how Mellox AI actually works, which contracts are active, what is legacy, and what a future AI coding agent must know before changing behavior.

## 1) Product summary

Mellox AI is a workspace-scoped marketing operating system for brands and agencies. The app blends:

- workspace and brand identity management
- AI chat grounded in a brand and its client context
- Brand DNA capture and persistence
- Studio content generation and approvals
- UGC video ad generation
- GEO/AEO/SEO scan and fix workflows
- GitHub repository connector and repo-scoped agent work
- social publishing and distribution
- backlink / link-shopping flows with credits and payment logic
- analytics, usage, and plan controls

The canonical implementation is a Next.js App Router application backed by Supabase/PostgreSQL and server-side AI + provider gateways. The system is designed so the browser is an orchestration surface, while the server owns validation, auth, budgets, provider access, and persistence.

The repo also contains a lot of product/design/ADR history. Some historical material (RavalAI naming, old SDR assumptions, legacy document sets) is still present, but the active codebase uses the current Mellox AI + workspace conventions.

## 2) Architectural reality in one map

### Runtime model

- Frontend: Next.js 16 App Router + React 19 + TypeScript
- Server boundary: App Router route handlers, server functions, server-only modules
- Auth and tenancy: Supabase session JWTs + workspace membership checks + RLS-bound clients
- Database: PostgreSQL via Supabase
- AI stack: OpenRouter for chat/extraction, Anthropic for Claude-based strategy branches, KIE for media generation
- Background jobs: cron hooks and lease-based workers; no generic queue service in the app
- External integrations: GitHub, Google Analytics/Search Console, Webflow, SocialAPI, SDR, KIE, Firecrawl, Tavily, Stripe, Rixot

### Active code anchors

- App shell and page routes: [src/app](src/app)
- Server transport for authenticated routes: [src/server/route.ts](src/server/route.ts)
- Server-function registry: [src/server/fns/index.ts](src/server/fns/index.ts)
- RPC transport: [src/app/api/rpc/[...fn]/route.ts](src/app/api/rpc/[...fn]/route.ts)
- Auth + workspace checks: [src/server/api-auth.ts](src/server/api-auth.ts)
- Environment validation: [src/server/env.ts](src/server/env.ts)
- AI gateway: [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts)
- Anthropic gateway: [src/lib/anthropic-gateway.server.ts](src/lib/anthropic-gateway.server.ts)
- Studio runner: [src/server/studio/runner.server.ts](src/server/studio/runner.server.ts)
- Brand DNA server: [src/server/workspaces/brand-dna.server.ts](src/server/workspaces/brand-dna.server.ts)
- UGC engine: [src/server/ugc/service.server.ts](src/server/ugc/service.server.ts)
- Link marketplace: [src/server/links/service.server.ts](src/server/links/service.server.ts)
- Schedule executor: [src/lib/schedules.server.ts](src/lib/schedules.server.ts)
- Cron route kernel: [src/server/cron.ts](src/server/cron.ts)

## 3) Request and auth flow: the canonical security model

The default server boundary is strict and repeated across the app:

1. Browser calls page or API.
2. Request hits route or server function.
3. Identity is validated using bearer token and Supabase claims.
4. Workspace membership is checked with the explicit workspace id.
5. Role gates are applied for side effects (editor etc.).
6. Rate limits and budgets are enforced.
7. Server calls DB / provider / worker / gateway through server-only modules.
8. Response is returned without leaking service-role secrets.

This behavior is implemented in:

- [src/server/api-auth.ts](src/server/api-auth.ts)
- [src/server/route.ts](src/server/route.ts)
- [src/integrations/supabase/auth-middleware.ts](src/integrations/supabase/auth-middleware.ts)
- [src/server/rate-limit.ts](src/server/rate-limit.ts)
- [src/server/ai/budget.ts](src/server/ai/budget.ts)

The key invariant is: the workspace comes from a verified route or request-scoped value, not from a browser-selected or cached fallback. This is encoded in the “workspace identity” conventions and is central to the app’s correctness.

## 4) Workspaces and Brand DNA: the root identity layer

### What a workspace is

The workspace is the tenant boundary. It owns:

- the users and roles in the workspace
- Brand DNA
- content, approvals, jobs, assets, schedules
- GEO scans and audit artifacts
- integrator state
- provider settings

### What Brand DNA is

Brand DNA is the canonical brand context for each workspace and is stored in the database table `workspace_brand_dna`. It is not a browser-only state blob.

Key files:

- [src/server/workspaces/brand-dna.server.ts](src/server/workspaces/brand-dna.server.ts)
- [src/server/fns/brand-dna.ts](src/server/fns/brand-dna.ts)
- [src/hooks/use-brand-dna.ts](src/hooks/use-brand-dna.ts)
- [src/lib/ai/brand-context.ts](src/lib/ai/brand-context.ts)

Behavior:

- Brand DNA is stored per workspace, not globally.
- Browser hook uses a workspace-scoped local cache, but the authoritative server state is in the database.
- Saves mutate `workspace_brand_dna` and invalidate Studio context caches.
- Brand context is compacted for AI prompts, then trimmed/selectively ranked to keep token usage bounded.

Important design point: the app deliberately keeps the brand identity server-side and rehydrates the exact workspace’s data before a model call.

## 5) AI architecture: how intelligence flows through Mellox

The active AI gateway is OpenRouter, with a shared gateway wrapper that handles:

- budget checks
- cache and in-flight dedupe
- timeout/retry handling
- usage metering
- token trimming and truncation handling
- provider-swappable model selection

Active gateway files:

- [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts)
- [src/server/ai/budget.ts](src/server/ai/budget.ts)
- [src/server/ai/metering.ts](src/server/ai/metering.ts)
- [src/server/cache/store.ts](src/server/cache/store.ts)

### Chat flow

Canonical direct app flow is:

- Browser chat UI sends messages and workspace id to [src/app/api/chat/route.ts](src/app/api/chat/route.ts)
- Route validates workspace membership
- It reads the verified workspace and its website identity
- It sanitizes user provided text and summarises older history with [src/lib/ai/history-summary.server.ts](src/lib/ai/history-summary.server.ts)
- System prompt + brand context + history are assembled
- Calls `chatCompletionStream` through the OpenRouter gateway

The system prompt and context assembly are built from:

- [src/lib/ai/prompts/index.ts](src/lib/ai/prompts/index.ts)
- [src/lib/ai/prompts/library.ts](src/lib/ai/prompts/library.ts)
- [src/lib/ai/brand-context.ts](src/lib/ai/brand-context.ts)
- [src/lib/ai/context-select.ts](src/lib/ai/context-select.ts)

The important AI design is not just “Brand DNA gets passed in.” It is:

- only the verified workspace’s Brand DNA is used
- message history is compacted and summarized before expensive tokens are spent
- context is ranked and budgeted, not dumped wholesale
- non-system user inputs are sanitized before reaching a model
- outputs are metered and checked against workspace/user AI budgets

### Claude / Anthropic paths

Claude is used for strategy and structured prompt tasks. It uses a dedicated Anthropic gateway:

- [src/lib/anthropic-gateway.server.ts](src/lib/anthropic-gateway.server.ts)

It includes:

- model selection by kind (`brand-dna`, `marketing-coach`, deep strategy, default)
- budget degradations
- structured output support
- safe error mapping for key expiry, billing, and invalid provider responses

This is separate from the openrouter chat gateway and is used for logic-heavy tasks, not the general chat path.

## 6) Studio and content generation architecture

Studio is the primary generation surface. It is a multi-step job system rather than a simple “one request, one result” UI.

### Job contract

- Shared contract: [src/lib/studio/jobs.ts](src/lib/studio/jobs.ts)
- Worker: [src/server/studio/runner.server.ts](src/server/studio/runner.server.ts)
- Session and UI state: [src/lib/studio/session-store.ts](src/lib/studio/session-store.ts)
- Prompt generation: [src/lib/studio/prompts.ts](src/lib/studio/prompts.ts)

### How a Studio job works

1. User selects type (social, image, video, ad, carousel, etc.)
2. UI creates a `studio_jobs` row via the API boundary
3. Server loads workspace snapshot and Brand DNA
4. Model builds variant ideas, text, images, and/or videos
5. Long-running media work gets started at the provider and advanced by polling or callback
6. Result is persisted into the job and any content items created downstream
7. UI tracks status through the job lifecycle and realtime content updates

This is one of the app’s highest-value architectural patterns: long-running media is separate from the request itself, so a page refresh or navigation does not lose the job.

### Studio context loading

The server-side context used by Studio is constructed in:

- [src/server/studio/context.server.ts](src/server/studio/context.server.ts)

It brings in:

- Brand DNA
- recent content
- scheduled content
- competitor alerts
- memory insights
- market intelligence

This is intentionally richer than just brand text so the generation is grounded in the workspace’s recent activity and strategic state.

## 7) UGC / video ads: ad-generation service

UGC ads are a separate generation engine with its own project/render lifecycle.

Core files:

- [src/server/ugc/service.server.ts](src/server/ugc/service.server.ts)
- [src/server/ugc/engine.server.ts](src/server/ugc/engine.server.ts)
- [src/server/ugc/models.server.ts](src/server/ugc/models.server.ts)
- [src/server/ugc/providers/kie.server.ts](src/server/ugc/providers/kie.server.ts)
- [src/server/ugc/store.supabase.server.ts](src/server/ugc/store.supabase.server.ts)

Behavior:

- projects hold product brief, concepts, script, reference assets
- a render reservation is made before provider work is started
- model routing chooses provider model and cost tier
- callbacks and polling advance render status
- render results can become draft social posts or downloadable outputs

This system is supply-aware, budget-aware, and explicitly server-controlled. It is one of the major areas where spending and concurrency are actively managed.

## 8) Social publishing and distribution

The project has multiple distribution layers and provider abstraction paths. The current active architecture has a provider-selection layer plus provider-specific handlers.

### Distribution design

- Feature provider selection: [src/lib/feature-flags.ts](src/lib/feature-flags.ts)
- Social API handlers: [src/lib/socialapi/handlers.ts](src/lib/socialapi/handlers.ts)
- SDR implementation and handlers: [src/lib/sdr.handlers.ts](src/lib/sdr.handlers.ts), [src/lib/sdr.webhook.ts](src/lib/sdr.webhook.ts)
- App routes: [src/app/api/sdr](src/app/api/sdr)

### Publishers and scheduling

- Schedule execution: [src/lib/schedules.server.ts](src/lib/schedules.server.ts)
- Cron route: [src/app/api/public/hooks/run-schedules/route.ts](src/app/api/public/hooks/run-schedules/route.ts)

The app treats “generate content on a schedule” and “publish scheduled content” as distinct concerns. There are dedicated scheduled jobs, content states, and distribution execution paths.

### Publishing behavior

The app does not simply push from browser to provider. It validates workspace access, checks required roles, enforces plan limits, and uses server-side provider adapters. It also records operational status into content items and related distribution tables.

## 9) Link marketplace: buying backlinks and credits

This is a high-risk, finance-related subsystem with a strict invariant model.

Core files:

- [src/server/links/service.server.ts](src/server/links/service.server.ts)
- [src/server/links/order-runner.server.ts](src/server/links/order-runner.server.ts)
- [src/server/links/credits.server.ts](src/server/links/credits.server.ts)
- [src/server/links/rixot/client.server.ts](src/server/links/rixot/client.server.ts)
- [src/server/links/links-poller.server.ts](src/server/links/links-poller.server.ts)
- [src/lib/links/pricing.ts](src/lib/links/pricing.ts)

### Core rules

- Rixot is the only file that reads the provider API key and calls the fulfilment provider
- checkout holds credits before a provider submission is finalized
- provider operations are not blindly retried because the provider has no idempotency key guarantees
- verification of live placements is conservative and time-based
- payout / debit / refund logic is treated as a ledger problem, not a UI glitch

This subsystem is especially important because it is one of the few places where real money, verification, and credit accounting all meet.

## 10) GEO / AI visibility: scan, rank, fix, verify

This is a major product area with a specific engine and fix workflow.

Key files:

- [src/server/geo/service.server.ts](src/server/geo/service.server.ts)
- [src/server/fns/geo.ts](src/server/fns/geo.ts)
- [src/server/fns/geo-fixes.ts](src/server/fns/geo-fixes.ts)
- [src/server/geo/agents](src/server/geo/agents)
- [src/lib/geo](src/lib/geo)
- [src/components/app/GeoAeoPanel.tsx](src/components/app/GeoAeoPanel.tsx)

### Design intent

- scan pages and rank results
- detect findings using deterministic rule ids and fingerprints
- propose fixes from the repository / source model where applicable
- verify findings through separate scans and explicit verification workflow
- avoid allowing a browser to set “resolved” state directly

This subsystem is a good example of the repo’s “server-owned state + deterministic workflow” pattern. It is also a likely place for complex bugs due to scanning, patching, and datasource ownership.

## 11) GitHub connectors and repo ownership

The repo includes a real GitHub App source connector and repo ownership logic.

Relevant files:

- [src/server/connectors](src/server/connectors)
- [src/server/fns/connectors.ts](src/server/fns/connectors.ts)
- [src/server/connectors/github](src/server/connectors/github)
- [src/server/audit.server.ts](src/server/audit.server.ts)

Practical behavior:

- GitHub installation is handled via OAuth / app flow
- repos and ownership are validated before agent actions run
- writes must occur through controlled git paths and PR / audit logic
- server-side secrets are never exposed to the browser

This is likely the strongest “future AI coding agent” safety layer in the app.

## 12) Database architecture and data model patterns

The database is PostgreSQL through Supabase. The repo includes generated types in:

- [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts)

The dominant pattern is:

- table per entity: workspaces, workspace_members, content_items, studio_jobs, geo_scans, workflow state, agent runs, scheduled_jobs, etc.
- RLS by default: browser clients operate with user-scoped JWTs and are prevented from overreaching
- service-role operations are explicit and used only where the code has a justified bypass
- cron + lease patterns are used for background work, not a universal queue service

Important tenant and record boundaries:

- workspace-scoped records are keyed by `workspace_id`
- many tables have a membership or role relationship
- high-value state like Brand DNA and usage are not browser-local only
- schedule and scan state often uses explicit lifecycle columns like status, lease, error, timestamps, and relation ids

## 13) Data entity lifecycle map

### User

- Authenticated through Supabase JWT
- Stored identity is within Supabase auth and workspace membership tables
- Access verified by [src/server/api-auth.ts](src/server/api-auth.ts)

### Workspace

- Created and listed via workspace services
- The workspace is the principal tenancy and brand container
- Routing and access are based on verified workspace ids

### Brand DNA

- Origin: onboarding / extraction / manual edits
- Validation: server-side schema and size limits
- Storage: `workspace_brand_dna`
- Retrieval: server lookup by workspace id
- Consumers: chat, Studio, UGC, GEO, campaigns, coaching
- Lifecycle: saved, invalidated, reloaded, summarized, pruned

### Chat / message

- Origin: user prompt / response stream
- Validation: request and content sanitization
- Storage: transient in conversation state; older history is summarized rather than stored wholesale in a giant transcript
- Retrieval: model context assembly from current turns + summary
- Consumers: model generates reply or tool action

### Studio job

- Origin: creation from UI and prompt selection
- Validation: type, controls, workspace membership
- Storage: `studio_jobs`
- Retrieval: API + polling
- Consumers: Studio UI, job progress, result export
- Lifecycle: queued → running → media tasks → done / failed / cancelled

### Social post / content item

- Origin: generated or imported content
- Validation: type and state rules
- Storage: `content_items`
- Retrieval: workspace-scoped queries and realtime subscriptions
- Consumers: Studio, calendar, approval and publication flows

### Scheduled job

- Origin: schedule or monitor creation
- Validation: cadence, workspace ownership
- Storage: `scheduled_jobs`
- Retrieval: cron claimers and UI listing
- Consumers: schedulers and generation handlers

### UGC project / render

- Origin: product brief and concept generation
- Storage: `ugc_projects`, `ugc_renders`
- Retrieval: project and render endpoints
- Consumers: UI panels and provider polling

### Credits / billing

- Origin: plan limits, usage events, top-ups
- Validation: server-side pricing and budget logic
- Storage: usage + billing tables, ledger patterns
- Consumers: route auth, budget decisions, checkout and refund flows

## 14) Background jobs and operational model

The app does not use a generic queue service. It uses cron hooks and row-lease patterns.

### Cron kernel

- [src/server/cron.ts](src/server/cron.ts)
- Routes under [src/app/api/public/hooks](src/app/api/public/hooks)

### Key jobs

- scheduled jobs runner: [src/app/api/public/hooks/run-schedules/route.ts](src/app/api/public/hooks/run-schedules/route.ts)
- UGC renders: [src/app/api/public/hooks/ugc-renders/route.ts](src/app/api/public/hooks/ugc-renders/route.ts)
- KIE callback hooks: [src/app/api/public/hooks/kie/route.ts](src/app/api/public/hooks/kie/route.ts)
- outside the app, providers and public webhooks call back into the app for live status reconciliation

### Job design invariant

The repo strongly prefers:

- lease claim for due items
- deterministic idempotency and conflict handling
- operations that can be retried without double-being-applied
- callback + reconciliation below the primary user request path

This matters because production failures are usually not “the request failed”; they are “the background state never advanced.”

## 15) Security and governance review

### Security strengths

- all auth requests validated via verified bearer tokens
- workspace membership checks are explicit and central
- role checks protect mutating routes
- server-only env variables are not exposed as `NEXT_PUBLIC_*`
- provider credentials are isolated behind server modules
- SSRF boundary is enforced for public URL fetching
- route-level rate limiting and spend budgets are enforced

### Important guards found in code

- [src/server/route.ts](src/server/route.ts): route validation and auth ordering
- [src/server/api-auth.ts](src/server/api-auth.ts): workspace role checks and 401/403 handling
- [src/server/env.ts](src/server/env.ts): rejects accidental browser-exposed secret patterns
- [src/server/safe-fetch.ts](src/server/safe-fetch.ts): public URL allow-list / SSRF checks
- [src/server/cron.ts](src/server/cron.ts): CRON_SECRET protection and heartbeat tracking

### Security concerns / risk areas

1. The repository contains local `.env` files and secret-bearing values in active developer workspace state. These must never be committed or pasted into chat. This repo’s danger surface is not code logic alone; it includes secret leakage during local dev and deployment.
2. Dual provider patterns exist (`SocialAPI`, `SDR`, multiple route families). This is a correct abstraction but means misconfiguration can silently route work to the wrong provider without the browser noticing.
3. Several subsystems have very strong control logic but no easy manual “one-click” production diagnosis. This is the usual danger in complex AI + scheduling systems: the fix is often in runtime state rather than route code.
4. Large API / migration drift is possible because the repo contains old documents and logs from historical RavalAI / SDR efforts. The active system should be validated against current code, not historical docs alone.

## 16) Cost controls and variable spend

This system is built around spend ceilings and quota management.

Key files:

- [src/server/plans.ts](src/server/plans.ts)
- [src/server/ai/budget.ts](src/server/ai/budget.ts)
- [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts)
- [src/lib/kie-gateway.server.ts](src/lib/kie-gateway.server.ts)

### Cost drivers

- chat text generation
- extraction and research calls
- Brand DNA or market analysis prompts
- image rendering and video rendering
- social post generation
- link marketplace / verification
- external crawlers and provider APIs

### Cost controls observed

- plan ceilings by workspace and user
- soft cap and warn states before hard block
- model degradation from premium to lower-cost model when ceiling is reached
- per-provider operation budgets
- output caps on generation
- cache and in-flight dedupe to avoid duplicate spend
- explicit provider rate-limit handling

This is a real product property, not only a dev implementation detail.

## 17) Frontend structure and product surfaces

The UI is split across several major areas:

- [src/app](src/app)
- [src/components/app](src/components/app)
- [src/components/studio](src/components/studio)
- [src/components/workspace](src/components/workspace)
- [src/components/onboarding](src/components/onboarding)

Main product surfaces:

- projects and workspace shell
- onboarding and Brand DNA capture
- chat assistant panels
- Studio content generation edition
- library / content review
- GEO / AI visibility
- social connection and publishing surfaces
- UGC studio and render panels
- links / backlink marketplace
- integrations and OAuth screens

The frontend uses app events and state management abstractions, but the actual product logic remains server-owned. This reduces trust in browser state and is a deliberate design choice to make AI prompts and side effects safer.

## 18) Active vs legacy vs unused systems

This repo contains multiple historical layers. The document uses the following classifications.

### Active / primary

- workspace-scoped auth + Brand DNA
- chat AI gateway and summary logic
- Studio job system
- UGC engine and render state machine
- cron-driven schedules
- GEO scan + fix workflow
- GitHub connectors
- links marketplace and credit logic
- Supabase-backed persistence with RLS

### Partially active / conditional

- SDR distribution path
- SocialAPI distribution path
- Google Analytics / Search Console integration
- Webflow integration
- UGC video feature toggles and KIE route selection

### Legacy / historical

- older RavalAI naming and docs
- older architecture references in specifications that do not match the current runtime exactly
- a few legacy route/logic names carried for compatibility

### Unknown

- exact final production topology for all provider deployments
- which provider is currently dominating live end-user traffic in the present deployment
- whether every experimental or spec path is actually active in the deployment that is using `.env`

The codebase should always win over historical docs when there is a mismatch.

## 19) Documentation conflicts to watch

This repository contains important historical documents and live code that do not always align perfectly. Examples:

- older product naming may say Raval AI while the app uses Mellox AI
- distribution implementation may be documented as SDR while the current environment chooses SocialAPI or both depending on feature flags
- route names and folder names may refer to legacy design choices even though the active runtime has moved on

The correct interpretation is: use live code and migrations as the truth source; treat ADR/spec docs as implementation intent or historical context, not the runtime source of truth.

## 20) Future AI coding agent playbook

If a future AI agent is asked to modify the system, here is the minimum knowledge it must have.

### Must know before touching code

- Authentication verifies sessions and workspace membership; never trust the browser as the source of tenant identity.
- Brand DNA is a per-workspace canonical object and is used by chat, Studio, UGC, and more.
- Requests that spend AI or mutate workspace data must carry an explicit workspace id and verify access.
- The AI gateway is centralized; provider-specific behavior should not be duplicated in route handlers.
- The app uses server-side budget and rate controls as a first-class boundary.
- Cron jobs are a real operational architecture, not optional background tasks.
- The fastest way to break the app is to bypass workspace ids, mutate state from the browser, or short-circuit server-side validation.

### Key files to understand before changing a subsystem

- Auth and permission: [src/server/api-auth.ts](src/server/api-auth.ts)
- Route entry points: [src/server/route.ts](src/server/route.ts)
- AI gateway: [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts)
- Brand DNA: [src/server/workspaces/brand-dna.server.ts](src/server/workspaces/brand-dna.server.ts)
- Studio generation: [src/server/studio/runner.server.ts](src/server/studio/runner.server.ts)
- UGC generation: [src/server/ugc/service.server.ts](src/server/ugc/service.server.ts)
- Scheduling: [src/lib/schedules.server.ts](src/lib/schedules.server.ts)
- Distribution: [src/lib/socialapi/handlers.ts](src/lib/socialapi/handlers.ts), [src/lib/sdr.handlers.ts](src/lib/sdr.handlers.ts)
- GEO: [src/server/geo/service.server.ts](src/server/geo/service.server.ts)
- Billing and credits: [src/server/links/credits.server.ts](src/server/links/credits.server.ts)

### Things that must not break

- workspace boundaries
- Brand DNA integrity
- role gating for editors and owners
- provider-credential isolation
- rate-limit and budget behavior
- functionally correct cron/lease semantics
- safe handling of provider failures and timeouts

## 21) Production operational notes

The app expects a real operational environment rather than a single-process local run. The repository includes enough evidence to know that production concerns are real and intentional:

- app environment validation in [src/server/env.ts](src/server/env.ts)
- cron secret validation in [src/server/cron.ts](src/server/cron.ts)
- workforce monitoring and heuristics for missed jobs in the repo’s operational docs and `src/server/observability` modules
- webhook-driven status and reconciliation patterns in provider integrations

### Important local secret requirement

A local `.env` file containing secrets exists on this machine and is not safe to share. It should be treated as confidential and should never be committed to Git or pasted into chat or issue trackers.

## 22) Final verdict

Mellox AI is a mature, workspace-centric marketing automation platform with a strong server boundary and a real AI + operational architecture. The most important design choice is not “what framework” but “who owns the tenant, brand identity, and side effects.” That boundary is the system’s real center of gravity.

The repo is feature-rich and includes multiple active subsystems, but the safest way to reason about it is:

- read the code paths that touch workspace verification and Brand DNA first
- follow the server boundary before trusting any browser action
- treat provider adapters and cron workers as operational systems, not incidental code
- validate against current code instead of historical docs when the two diverge

That is the architecture as implemented today.
