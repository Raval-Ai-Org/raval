# Mellox AI - Railway Deployment & Operations

Snapshot: 2026-10-21 | commit 055c90977c2ccf15237e985b8a333e4b146e30be

## How to use this volume

This is volume 05 of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.


**Evidence labels:** Implemented means source exists and is mapped here; it does not prove that a production migration, credential, permission or feature switch is enabled. Owner-confirmed identifies facts supplied by the owner. External-verified identifies official web information checked on the snapshot date. Recommended identifies a rebuild or operating procedure. Unverified identifies missing deployment or commercial evidence.


Runtime code, migrations and current configuration outrank older guides. Model and price tables describe defaults unless explicitly stated otherwise. They are a dated reference, not a promise that vendors will retain them. No credentials or customer records are included.


| Volume | Read it for |

| --- | --- |

| 01 Product & workflows | Feature behavior, journeys, approvals and module ownership |

| 02 Architecture & engineering | Frontend, backend, integrations, APIs and implementation patterns |

| 03 AI models & generation | Every task-model route, images, video, context and evaluations |

| 04 Pricing & billing | Plans, feature gates, all action prices, wallets and economics |

| 05 Railway & operations | Deployment, configuration, jobs, security, recovery and diagnostics |

| 06 Rebuild & data reference | Build order, acceptance criteria, full typed schema and migration index |

### Contents

## Confirmed hosting and deployment boundary

Railway is owner-confirmed as the current host. The repository's root Dockerfile builds the main Next.js app; it does not by itself provision Supabase, R2, third-party OAuth apps, payment webhooks, schedules or optional Python/SDR services. Exact Railway project IDs, services, regions, replicas, resource sizes and deployed commit were not available to this audit.


Use this volume as a source-based operating recipe, not a claim that all steps are already applied to production. Existing Amplify configuration and older deployment ADRs remain repository artifacts, but are not adopted here as the production runbook. Do not redeploy to those platforms just because an old guide names them.


A deployable release is a compatible application build, database migration state, environment configuration, provider permissions, callback configuration, worker/scheduler availability and a recoverable previous release. Record all of those together. A green container build is not sufficient evidence that generation, payment, media access or scheduled delivery works.


Implementation sources: Dockerfile; next.config.ts; src/server/env.ts; docs/deployment-guide.md


## Container build and runtime requirements

The Dockerfile uses Node 22 on Debian bookworm-slim in dependency, builder and runner stages. It installs dependencies from package-lock, builds Next.js, verifies the Clarity build, then copies standalone output, public assets, static chunks and vendor resources into the runtime image. The runtime uses a non-root nextjs user.


The final image includes Chromium and fonts for visual capture/render fallback, Python and ExifTool for image metadata, and FFmpeg for video assembly. GEO_RENDER_EXECUTABLE and VISUAL_CAPTURE_BROWSER_PATH point to the installed Chromium. If using a different Railway build strategy, reproduce those native runtime dependencies; package.json alone does not install them.


The process binds to HOSTNAME=0.0.0.0 and Railway's injected PORT. The Docker health command checks /health on that port. /api/health exposes safe capability and build identity; /api/health/ready is a deeper readiness surface. /health is the simple process endpoint and must not be mistaken for provider or database readiness.


Public NEXT_PUBLIC values are build inputs and can be embedded in client bundles. Provider and service-role secrets are runtime server values. Never place secret keys in build-public variables merely to make a browser feature connect. Changing a build-public URL generally requires rebuilding the client artifact.


Implementation sources: Dockerfile; src/app/health/route.ts; src/app/api/health/route.ts; src/app/api/health/ready/route.ts; scripts/start-production.mjs


## Recommended fresh-environment deployment sequence

| Step | Action | Exit evidence |

| --- | --- | --- |

| 1. Freeze release | Record commit, lockfile, migration list and provider policy. | Release manifest with approved environment target. |

| 2. Provision state | Create isolated Supabase project, private R2 bucket and optional Redis. | Correct project IDs and access boundaries, without exposing secrets. |

| 3. Apply schema | Verify and apply the canonical migration sequence to the new target. | Recorded migration history and regenerated/checked types. |

| 4. Configure secrets | Set required core runtime values, encryption roots, provider keys and callback origins. | Production env validation and deliberate optional-feature readiness. |

| 5. Build on Railway | Use root Dockerfile or equivalent dependency-complete build. | Build succeeds; standalone assets and native tools present. |

| 6. Verify process | Bind PORT; configure Railway health path and custom HTTPS origin. | /health responds, deployed identity matches expected commit. |

| 7. Wire providers | Set exact OAuth redirects, signed webhook endpoints and intended scopes. | Test account connection and webhook validation. |

| 8. Enable schedules | Verify database/network cron target and secret; check heartbeat. | Due job advances exactly once without opening public writes. |

| 9. Smoke test | Use a controlled workspace and permitted provider operations. | Auth isolation, content, media, balance and delivery evidence. |

| 10. Release gates | Enable features deliberately, observe errors/cost and retain rollback. | Stable key paths plus recoverable previous release. |

Implementation sources: Dockerfile; src/instrumentation.ts; src/server/env.ts; src/server/cron.ts; supabase/migrations; docs/storage.md


### Repository validation commands

npm ci
npm run db:verify
npm run typecheck
npm run lint
npm test
npm run build


These are recommended release checks, not checks run during this read-only documentation review. Live suites need an isolated test workspace and explicit control over real provider calls and writes. npm run db:types regenerates checked-in types after an intentional schema change; migration application is a separate operation with the correct target credentials.


[Railway healthchecks](https://docs.railway.com/deployments/healthchecks) - Official documentation checked 21 October 2026. Use the current platform setting and injected port; confirm actual project configuration.

[Railway variables](https://docs.railway.com/variables) - Official documentation checked 21 October 2026. Keep environment-specific variables and secret scopes deliberate.

## Required configuration and encryption continuity

Core server validation requires APP_URL, Supabase URL/publishable/service-role values, matching browser-safe Supabase values, OPENROUTER_API_KEY and CRON_SECRET. In production APP_URL must be the intended HTTPS origin rather than localhost. The catalog, callbacks, consent metadata and generated links depend on it. Refer to src/server/env.ts for current validation; some feature-specific modules validate additional variables outside that central schema.


R2 needs account ID, access key ID, secret access key and bucket name. An endpoint override is optional. A partially configured set fails explicitly rather than silently moving production media into another backend. The production storage path requires R2, while development can use legacy Supabase fallback.


Google, GitHub, WordPress, Webflow, Canva, Notion and Slack each have their own OAuth/app configuration. Google sign-in credentials are distinct from Google Analytics/Search Console authorization. Register exact callback origins and paths. Preserve connector encryption roots across releases; a rotated key without a migration can strand saved grants.


For distribution select Post for Me when intended and configure its key/webhook secret. SocialAPI is retired. SDR is optional and needs its own endpoint, tenant provisioning, secrets and workspace flag if selected. For billing, production defaults to enforcement on; payment keys, webhook secret, price mappings and schema readiness still need verification.


Implementation sources: src/server/env.ts; src/server/assets/storage.server.ts; src/server/connectors; src/server/billing/readiness.server.ts; src/lib/feature-flags.ts


## Feature switches and readiness

| Feature | Source default / prerequisite | Operational consequence |

| --- | --- | --- |

| Autopilot | On unless false; plan and program setup still apply | Full automatic mode has its own flag; AGENTS_DISABLED/workspace pause can stop execution. |

| Audience | On unless false; separate auto-score flag | Worker reads existing shared scheduler; disabled mode hides/blocks feature paths. |

| Memory / chat tools | On unless false; workspace memory switch separately | Do not bypass editor/admin write rules. |

| MCP | Global gate on unless false; per-workspace access starts off | Admin enables access and separately permits changes. |

| Stories | On unless false, with workspace override | Requires Story schema plus account permissions; preserve frame recovery. |

| GEO scan probes | Explicit opt-in | Paid multi-engine checks; not the same switch as tracked-prompt allowances. |

| GEO rendering | Explicit configured fallback | Chromium and safe resource fetching required. |

| Proof Engine | Explicit opt-in | Plan and eligibility checks still apply. |

| Slack | Explicit opt-in | Provider installation and verified inbound binding required. |

| UGC | KIE prerequisite in current legacy helper plus feature gate | Runtime health/provider readiness is not identical to this helper; verify OpenRouter-only deployments carefully. |

| Canva Magic Layers | Preview flag should be false for public integration review | Flat-image fallback is a separate supported path. |

| Platform DB flags | Env override, then database rule, otherwise off | Fifteen-second cache; does not replace all older env gates. |

Do not assume one universal flag system. Current code includes legacy environment gates, workspace overrides, account entitlements and newer database rollout flags. Platform flags, model-route overrides, spend caps and operational switches have separate services and caches. Confirm the gate used by the exact feature path.


Implementation sources: src/lib/feature-flags.ts; src/server/platform/flags.server.ts; src/server/platform/switches.server.ts; src/server/platform/spend-caps.server.ts; src/server/platform/routing-overrides.server.ts


## Scheduled jobs and public hook map

These routes exist in current source. A cron hook is not enabled merely because its file exists: verify the scheduling migration, configured APP_URL/target origin, CRON_SECRET and heartbeat. Provider webhook routes require their signature protocol instead of the cron secret. Extracted interval values are code expectations, not a live scheduler inspection.


| Hook | Job / expected interval seconds | Trigger source |

| --- | --- | --- |

| /api/public/hooks/agents-tick | agents-tick / 15 | Authenticated scheduler |

| /api/public/hooks/analytics-sync | analytics-sync / 600 | Authenticated scheduler |

| /api/public/hooks/billing | billing / 300 | Authenticated scheduler |

| /api/public/hooks/competitor-watch | competitor-watch / 30 | Authenticated scheduler |

| /api/public/hooks/experiments | experiments / 300 | Authenticated scheduler |

| /api/public/hooks/geo-agents | geo-agents / 60 | Authenticated scheduler |

| /api/public/hooks/geo-scans | geo-scans / 60 | Authenticated scheduler |

| /api/public/hooks/kie | provider/custom / see source | Provider webhook |

| /api/public/hooks/link-catalog | link-catalog / 86_400 | Authenticated scheduler |

| /api/public/hooks/link-orders | link-orders / 60 | Authenticated scheduler |

| /api/public/hooks/openrouter-video | provider/custom / see source | Provider webhook |

| /api/public/hooks/ops-watch | ops-watch / 300 | Authenticated scheduler |

| /api/public/hooks/postforme | provider/custom / see source | Provider webhook |

| /api/public/hooks/run-schedules | run-schedules / 60 | Authenticated scheduler |

| /api/public/hooks/sdr | provider/custom / see source | Provider webhook |

| /api/public/hooks/sdr-reconcile | sdr-reconcile / 300 | Authenticated scheduler |

| /api/public/hooks/slack | slack / 60 | Authenticated scheduler |

| /api/public/hooks/socialapi | provider/custom / see source | Provider webhook |

| /api/public/hooks/stripe | provider/custom / see source | Provider webhook |

| /api/public/hooks/ugc-renders | ugc-renders / 60 | Authenticated scheduler |

Implementation sources: src/app/api/public/hooks; src/server/cron.ts


### Shared minute scheduler

run-schedules expects a sixty-second cadence. It runs up to twenty-five due scheduled jobs and twenty-five due Market Brain collections, Autopilot with a forty-five-second/max-twelve sweep, and Audience with a forty-second/max-six sweep. after() continuations refresh trends if due, collect audience outcomes, run bounded visual captures and purge expired memories. These continuations still require process time; deployments/restarts make durable recovery important.


Implementation sources: src/app/api/public/hooks/run-schedules/route.ts


## Security boundaries and control matrix

| Boundary | Implemented control | Verification to preserve |

| --- | --- | --- |

| User identity | Supabase verified bearer/cookie session flows | Invalid recovery link cannot use an unrelated session. |

| Tenant access | Explicit workspace membership/role plus RLS | Outsider IDs and stale workspace context are rejected. |

| Service role | Server-only explicit privileged clients | Every privileged query is scoped and audited. |

| External fetch | DNS/private-address protection, redirect validation, size/time bounds | Block metadata/private hosts and redirect pivots. |

| Media | Workspace paths, signatures, prompt/image/video safety | Uploads and edits cannot bypass publish-time review. |

| OAuth | Bound one-use state, expiry, PKCE/cookie where implemented | Wrong browser/user/workspace and replay fail. |

| Webhooks | Raw-body signature/secret checks and replay-safe transitions | Invalid/stale messages cannot advance state. |

| Payment | Server pricing, holds, signed events, idempotent grants | Browser amount and success-page visit are not authority. |

| Repository writes | Verified source host, reviewed base and patch approval | No direct push/merge to protected base by a generator. |

| External assistants | Workspace gate, caller role, own app checks and audit | Unapproved content cannot be published via MCP. |

| Staff tools | Permissions, production MFA, recent MFA for sensitive actions | A customer admin is not automatically platform staff. |

Implementation sources: src/server/route.ts; src/server/safe-fetch.ts; src/server/guardrails; src/server/mcp; src/server/admin/route.ts


## Headers, browser sessions and privacy

next.config.ts sets CSP and security headers, API no-store behavior, frame restrictions, MIME-sniff prevention, referrer policy and production HSTS. The CSP retains unsafe-inline for required framework bootstrapping and JSON-LD; do not describe it as a strict per-request nonce policy. Allowed connect/frame hosts are deliberate integration requirements.


The Supabase browser client manages the current session flow, including legacy-session migration and explicit callback handling. Do not generalize an older localStorage description over the current cookie/SSR behavior. Client storage and UI guards do not replace server session verification.


Sensitive credential data belongs in server-only tables with encryption and minimal safe metadata exposed to clients. Helicone prompt-body logging is opt-in; telemetry configuration can affect data exposure. The repository does not establish a universal retention period, data residency guarantee, certified compliance status, signed data-processing contract or backup erasure guarantee. Those remain documented owner decisions, not assumptions.


Implementation sources: next.config.ts; src/integrations/supabase/client.ts; docs/security.md; docs/privacy.md; docs/self-hosted-integrations.md


## Monitoring, readiness and incident triage

Start with /health for process liveness, /api/health for safe build/capability information and /api/health/ready for configured readiness. The health version uses Railway/Git commit metadata and process start time. A configured key is not proof that the vendor account is funded or an API request succeeds.


Useful durable signals include AI usage/reservations, billing holds and financial events, cron heartbeats, job status/lease age, webhook events, audit logs, provider failures, missing connections and queue lag. Optional Sentry, Helicone, Redis and alert sinks improve observability when configured. Track pending-job age and capture/release failures as well as HTTP error rate.


During an incident identify the affected release and workspace safely, check recent configuration/migration changes, isolate provider outage versus auth/credit/rate/safety failure, and disable the smallest affected feature path if necessary. Reconcile uncertain side effects from stored provider IDs and event history before retrying. Never repair a dashboard by manually marking an unknown post delivered or a GEO finding verified.


Implementation sources: src/app/api/health/route.ts; src/app/api/health/ready/route.ts; src/server/observability; src/server/cron.ts; docs/operations.md


| Symptom | First checks | Safe recovery |

| --- | --- | --- |

| App fails at boot | Required env validation, public build args, schema readiness | Restore correct config/release; keep encryption roots stable. |

| Jobs never advance | Heartbeat, scheduler target/secret, lease expiry, flags | Repair scheduler then bounded idempotent sweep. |

| Video stuck after deploy | Stored provider task, composition row, FFmpeg, poll route | Resume accepted tasks; do not submit blindly. |

| Media 403/404 | Workspace path, storage backend marker, expired URL, R2 config | Re-sign through authorized route; preserve old objects. |

| Unexpected charge/balance | Hold/capture/event key, webhook history, allowance window | Reconcile ledger; use audited adjustment rather than duplicate grant. |

| Published twice | Provider IDs, retries, uncertain timeout and callback ordering | Stop repeated submit; reconcile each accepted publication. |

| OAuth needs attention | Callback exact origin, encrypted grant, scope and revocation | Reconnect only after configuration/key issue understood. |

| Scan fails or is empty | SSRF block, robots, crawl stage, rendering gate and limits | Explain the blocked target; do not weaken safe-fetch globally. |

## Backups, rollback and storage migration

Recommended backup scope is PostgreSQL schema/data and migration history, private media and its mapping identities, environment/encryption-key escrow, provider installation metadata and release artifacts. The actual backup provider, region, schedule, retention, restore test, RPO and RTO were not supplied. Set those explicitly before claiming disaster recovery readiness.


Application rollback on Railway should restore the last known healthy deployment or a reviewed revert. Database changes may not be backward compatible; prefer additive migrations and verify the old application can read the new schema before relying on deploy rollback. Never run an improvised reverse migration against a production ledger.


Keep R2 credentials available during rollback so assets created after cutover remain readable. Legacy Supabase objects and migration aliases may still be referenced. Storage migration uses checkpoints, checksums, reference cutover and rollback controls; do not delete old objects merely because copying finished. Retirement requires separate verification and authorization.


A recovery drill should restore into an isolated environment, validate memberships/RLS, reopen representative old and new assets, advance a paused durable job, check financial replay behavior and verify callback URLs cannot reach production accidentally. Record evidence and elapsed time rather than a guessed availability promise.


Implementation sources: docs/storage-migration.md; docs/storage.md; supabase/migrations; docs/operations.md


## Environment name inventory

Names only. No secret values were read from private .env files. The list combines literal process.env references in non-test TypeScript with keys in .env.example. Template-only entries may be old, optional or read indirectly; they are not proof of active use or required production settings. Dynamic families such as AI_MODEL_<ROUTE>, AI_PRICE_<MODEL> and workspace flag overrides require the family rules in the relevant module.


| Variable name | Classification | Evidence |

| --- | --- | --- |

| ADMIN_REQUIRE_MFA | Server/integration/runtime configuration | Source: src/server/admin/config.server.ts |

| AGENTS_DISABLED | Server/integration/runtime configuration | Source: src/server/agents/policy.ts |

| AI_USER_DAILY_USD | AI/media/routing control | .env.example name only |

| ALERT_WEBHOOK_URL | Server/integration/runtime configuration | Source: src/server/observability/alerts.ts |

| APP_DOMAIN | Server/integration/runtime configuration | .env.example name only |

| APP_URL | Server/integration/runtime configuration | Source: src/server/assets/persist.server.ts |

| ASSET_METADATA_EXIFTOOL_DIR | Server/integration/runtime configuration | Source: src/server/assets/image-metadata.server.ts |

| ASSET_METADATA_PYTHON_BIN | Server/integration/runtime configuration | Source: src/server/assets/image-metadata.server.ts |

| BILLING_ADMIN_EMAILS | Financial/entitlement configuration | Source: src/server/billing/notify.server.ts |

| BILLING_ADMIN_USER_IDS | Financial/entitlement configuration | Source: src/server/billing/admin.server.ts |

| BILLING_EMAIL_FROM | Financial/entitlement configuration | Source: src/server/notify/email.server.ts |

| BILLING_LIVE | Financial/entitlement configuration | .env.example name only |

| BILLING_PROVIDER | Financial/entitlement configuration | .env.example name only |

| CANVA_CLIENT_ID | Server/integration/runtime configuration | Source: src/server/connectors/canva/config.server.ts |

| CANVA_CLIENT_SECRET | Sensitive server configuration | Source: src/server/connectors/canva/config.server.ts |

| CANVA_TOKEN_ENCRYPTION_KEY | Sensitive server configuration | .env.example name only |

| CONTACT_FROM_EMAIL | Server/integration/runtime configuration | Source: src/app/(marketing)/api/contact/route.ts |

| CONTACT_TO_EMAIL | Server/integration/runtime configuration | Source: src/app/(marketing)/api/contact/route.ts |

| CRON_SECRET | Sensitive server configuration | Source: src/server/cron.ts |

| DISTRIBUTION_PROVIDER | Server/integration/runtime configuration | Source: src/lib/feature-flags.ts |

| E2E_TEST_EMAIL | Server/integration/runtime configuration | .env.example name only |

| E2E_TEST_PASSWORD | Sensitive server configuration | .env.example name only |

| ENV_VALIDATION | Server/integration/runtime configuration | Source: src/instrumentation.ts |

| FEATURE_FLAG_ASSET_METADATA_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_AUDIENCE_AUTO_SCORE_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_AUDIENCE_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_AUTOPILOT_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_AUTOPILOT_FULL_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_CANVA_MAGIC_LAYERS_ENABLED | Feature gate; inspect owning helper | Source: src/server/connectors/canva/config.server.ts |

| FEATURE_FLAG_CHAT_TOOLS_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_ENTITLEMENT_OVERRIDES_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_GEO_AGENT_ENABLED | Feature gate; inspect owning helper | Source: src/server/geo/agents/flags.ts |

| FEATURE_FLAG_GEO_AI_PROBES_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_GEO_RENDERING_ENABLED | Feature gate; inspect owning helper | Source: src/server/geo/render.server.ts |

| FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_MARKETING_COACH_WORKFLOW_ENABLED | Feature gate; inspect owning helper | Source: src/server/workflows/marketing-coach-flags.server.ts |

| FEATURE_FLAG_MCP_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_MEMORY_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_PROOF_ENGINE_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_SLACK_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_SOCIALAPI_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_SOCIAL_TRENDS_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_STORIES_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FEATURE_FLAG_UGC_VIDEO_ENABLED | Feature gate; inspect owning helper | Source: src/lib/feature-flags.ts |

| FFMPEG_PATH | Server/integration/runtime configuration | Source: src/server/guardrails/video-safety.server.ts |

| FIRECRAWL_API_KEY | Sensitive server configuration | Source: src/lib/firecrawl-gateway.server.ts |

| FIRECRAWL_BASE_URL | Server/integration/runtime configuration | Source: src/lib/firecrawl-flags.server.ts |

| FIRECRAWL_MAX_RETRIES | Server/integration/runtime configuration | .env.example name only |

| FIRECRAWL_NUM_WORKERS_PER_QUEUE | Server/integration/runtime configuration | .env.example name only |

| FIRECRAWL_TIMEOUT_MS | Server/integration/runtime configuration | .env.example name only |

| GEO_AGENT_DAILY_RUNS | AI/media/routing control | Source: src/server/geo/agents/service.server.ts |

| GEO_AGENT_LIVE_PR | AI/media/routing control | .env.example name only |

| GEO_AGENT_LIVE_REPO | AI/media/routing control | .env.example name only |

| GEO_AGENT_LIVE_SITE | AI/media/routing control | .env.example name only |

| GEO_AGENT_MAX_COST_USD | AI/media/routing control | Source: src/server/geo/agents/geo-coding-agent.ts |

| GEO_CITATION_PROBE_MAX_QUERIES | AI/media/routing control | Source: src/server/geo/citation-probes.server.ts |

| GEO_FIX_VERIFY_DELAYS | AI/media/routing control | Source: src/server/geo/fixes/verify.server.ts |

| GEO_PROBE_MAX_QUERIES | AI/media/routing control | Source: src/server/geo/probes.server.ts |

| GEO_PROBE_MODELS | AI/media/routing control | Source: src/server/ai/task-models.ts |

| GEO_PROBE_WEB_SEARCH | AI/media/routing control | Source: src/server/geo/tracked-prompts.server.ts |

| GEO_RENDER_EXECUTABLE | AI/media/routing control | Source: src/server/geo/render.server.ts |

| GEO_RENDER_NO_SANDBOX | AI/media/routing control | Source: src/server/geo/render.server.ts |

| GEO_RENDER_WS_ENDPOINT | AI/media/routing control | Source: src/server/geo/render.server.ts |

| GITHUB_ALLOWED_RETURN_ORIGINS | Server/integration/runtime configuration | Source: src/server/connectors/webflow/config.server.ts |

| GITHUB_API_BASE_OVERRIDE | Server/integration/runtime configuration | Source: src/server/connectors/github/api.server.ts |

| GITHUB_APP_ID | Server/integration/runtime configuration | .env.example name only |

| GITHUB_APP_NAME | Server/integration/runtime configuration | .env.example name only |

| GITHUB_APP_PRIVATE_KEY | Sensitive server configuration | .env.example name only |

| GITHUB_APP_SLUG | Server/integration/runtime configuration | .env.example name only |

| GITHUB_CLIENT_ID | Server/integration/runtime configuration | .env.example name only |

| GITHUB_CLIENT_SECRET | Sensitive server configuration | .env.example name only |

| GITHUB_INSTALL_VERIFICATION | Server/integration/runtime configuration | .env.example name only |

| GITHUB_LIVE_REPO | Server/integration/runtime configuration | .env.example name only |

| GITHUB_WEBHOOK_SECRET | Sensitive server configuration | Source: src/app/api/integrations/github/webhook/route.ts |

| GIT_COMMIT_SHA | Server/integration/runtime configuration | Source: src/app/api/health/route.ts |

| GOOGLE_ANALYTICS_CLIENT_ID | Server/integration/runtime configuration | Source: src/lib/feature-flags.ts |

| GOOGLE_CLIENT_ID | Server/integration/runtime configuration | .env.example name only |

| GOOGLE_CLIENT_SECRET | Sensitive server configuration | .env.example name only |

| HELICONE_API_KEY | Sensitive server configuration | Source: src/server/observability/helicone.server.ts |

| HELICONE_BASE_URL | Server/integration/runtime configuration | Source: src/server/observability/helicone-flags.server.ts |

| HELICONE_CLICKHOUSE_PASSWORD | Sensitive server configuration | .env.example name only |

| HELICONE_LOG_PROMPTS | Server/integration/runtime configuration | Source: src/server/observability/helicone-flags.server.ts |

| HELICONE_MINIO_ROOT_PASSWORD | Sensitive server configuration | .env.example name only |

| HELICONE_MINIO_ROOT_USER | Server/integration/runtime configuration | .env.example name only |

| HELICONE_POSTGRES_PASSWORD | Sensitive server configuration | .env.example name only |

| IMAGE_MODEL_DEFAULT | AI/media/routing control | Source: src/lib/model-router.server.ts |

| IMAGE_MODEL_EDIT | AI/media/routing control | Source: src/lib/model-router.server.ts |

| IMAGE_MODEL_PREMIUM | AI/media/routing control | Source: src/lib/model-router.server.ts |

| IMAGE_MODEL_PREMIUM_EDIT | AI/media/routing control | Source: src/lib/model-router.server.ts |

| KIE_API_KEY | Sensitive server configuration | Source: src/app/api/health/route.ts |

| KIE_WEBHOOK_HMAC_KEY | Server/integration/runtime configuration | Source: src/app/api/public/hooks/kie/route.ts |

| LOG_LEVEL | Server/integration/runtime configuration | Source: src/server/observability/logger.ts |

| MELLOX_ADMIN_USER_IDS | Server/integration/runtime configuration | Source: src/server/billing/admin.server.ts |

| MELLOX_CREDITS_PER_USD | Financial/entitlement configuration | Source: src/server/links/credits.server.ts |

| MELLOX_LINK_MARGIN | Financial/entitlement configuration | Source: src/server/links/credits.server.ts |

| MELLOX_LINK_MAX_ORDER_USD | Financial/entitlement configuration | Source: src/server/links/credits.server.ts |

| NEXT_PUBLIC_APP_URL | Public build/browser value | Source: src/lib/seo.ts |

| NEXT_PUBLIC_BING_SITE_VERIFICATION | Public build/browser value | Source: src/app/(marketing)/layout.tsx |

| NEXT_PUBLIC_BOOKING_URL | Public build/browser value | Source: src/app/(marketing)/demo/page.tsx |

| NEXT_PUBLIC_CLARITY_ID | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_GA_MEASUREMENT_ID | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_GOOGLE_CLIENT_ID | Public build/browser value | .env.example name only |

| NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION | Public build/browser value | Source: src/app/(marketing)/layout.tsx |

| NEXT_PUBLIC_LINKEDIN_PARTNER_ID | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_META_PIXEL_ID | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_PLAUSIBLE_DOMAIN | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_SITE_URL | Public build/browser value | Source: src/app/(marketing)/blog/[slug]/page.tsx |

| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public build/browser value | Source: src/integrations/supabase/client.ts |

| NEXT_PUBLIC_SUPABASE_URL | Public build/browser value | Source: src/integrations/supabase/client.ts |

| NEXT_PUBLIC_TURNSTILE_SITE_KEY | Public build/browser value | Source: src/components/auth/AuthCaptcha.tsx |

| NEXT_PUBLIC_VERCEL_ANALYTICS | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_PUBLIC_VERCEL_ENV | Public build/browser value | Source: src/marketing/lib/analytics.ts |

| NEXT_RUNTIME | Server/integration/runtime configuration | Source: src/instrumentation.ts |

| NODE_ENV | Server/integration/runtime configuration | Source: src/app/admin-lab/page.tsx |

| NOTION_CLIENT_ID | Server/integration/runtime configuration | Source: src/server/connectors/notion/config.server.ts |

| NOTION_CLIENT_SECRET | Sensitive server configuration | Source: src/server/connectors/notion/config.server.ts |

| NOTION_REDIRECT_URI | Server/integration/runtime configuration | Source: src/server/connectors/notion/config.server.ts |

| NOTION_TOKEN_ENCRYPTION_KEY | Sensitive server configuration | .env.example name only |

| OPENROUTER_API_KEY | Sensitive server configuration | Source: src/app/api/health/route.ts |

| OPENROUTER_WEBHOOK_SECRET | Sensitive server configuration | Source: src/app/api/public/hooks/openrouter-video/route.ts |

| PATH | Server/integration/runtime configuration | Source: src/server/assets/image-metadata.server.ts |

| PEXELS_API_KEY | Sensitive server configuration | Source: src/app/api/pexels/video/route.ts |

| PLAN_AGENCY_GEO_MAX_PAGES | Server/integration/runtime configuration | .env.example name only |

| PLAN_GROWTH_GEO_MAX_PAGES | Server/integration/runtime configuration | .env.example name only |

| PLAN_STARTER_DAILY_USD | Server/integration/runtime configuration | .env.example name only |

| PLAN_STARTER_GEO_MAX_PAGES | Server/integration/runtime configuration | .env.example name only |

| PLAN_STARTER_MONTHLY_POSTS | Server/integration/runtime configuration | .env.example name only |

| PLAN_STARTER_MONTHLY_USD | Server/integration/runtime configuration | .env.example name only |

| POST_FOR_ME_API_KEY | Sensitive server configuration | Source: src/lib/feature-flags.ts |

| POST_FOR_ME_WEBHOOK_SECRET | Sensitive server configuration | Source: src/app/api/public/hooks/postforme/route.ts |

| R2_ACCESS_KEY_ID | Server/integration/runtime configuration | Source: src/server/assets/storage.server.ts |

| R2_ACCOUNT_ID | Server/integration/runtime configuration | Source: src/server/assets/storage.server.ts |

| R2_BUCKET_NAME | Server/integration/runtime configuration | Source: src/server/assets/storage.server.ts |

| R2_ENDPOINT | Server/integration/runtime configuration | Source: src/server/assets/storage.server.ts |

| R2_SECRET_ACCESS_KEY | Sensitive server configuration | Source: src/server/assets/storage.server.ts |

| RAILWAY_GIT_BRANCH | Server/integration/runtime configuration | Source: src/app/api/health/route.ts |

| RAILWAY_GIT_COMMIT_SHA | Server/integration/runtime configuration | Source: src/app/api/health/route.ts |

| REDIS_URL | Server/integration/runtime configuration | Source: src/app/api/health/ready/route.ts |

| RESEND_API_KEY | Sensitive server configuration | Source: src/app/(marketing)/api/contact/route.ts |

| RIXOT_API_KEY | Sensitive server configuration | Source: src/server/links/rixot/client.server.ts |

| RIXOT_BASE_URL | Server/integration/runtime configuration | Source: src/server/links/rixot/client.server.ts |

| SDR_ADMIN_TOKEN | Sensitive server configuration | Source: src/app/api/public/hooks/sdr-reconcile/route.ts |

| SDR_BASE_URL | Server/integration/runtime configuration | Source: src/app/api/public/hooks/sdr-reconcile/route.ts |

| SDR_WEBHOOK_BASE_URL | Server/integration/runtime configuration | Source: src/lib/sdr-provisioning.server.ts |

| SDR_WEBHOOK_TOLERANCE_SECONDS | Server/integration/runtime configuration | Source: src/app/api/public/hooks/sdr/route.ts |

| SENTRY_DSN | Server/integration/runtime configuration | Source: src/server/observability/errors.ts |

| SHARE_LINK_ENCRYPTION_KEY | Server/integration/runtime configuration | .env.example name only |

| SLACK_CLIENT_ID | Server/integration/runtime configuration | Source: src/server/slack/security.server.ts |

| SLACK_CLIENT_SECRET | Sensitive server configuration | Source: src/server/slack/security.server.ts |

| SLACK_SIGNING_SECRET | Sensitive server configuration | Source: src/server/slack/security.server.ts |

| SLACK_TOKEN_ENCRYPTION_KEY | Sensitive server configuration | .env.example name only |

| SOCIALAPI_API_KEY | Sensitive server configuration | Source: src/lib/feature-flags.ts |

| SOCIALAPI_BASE_URL | Server/integration/runtime configuration | Source: src/lib/socialapi/workspace.server.ts |

| STRIPE_SECRET_KEY | Sensitive server configuration | Source: src/server/billing/stripe-account.server.ts |

| STRIPE_WEBHOOK_SECRET | Sensitive server configuration | Source: src/server/billing/stripe-account.server.ts |

| SUPABASE_PUBLISHABLE_KEY | Server/integration/runtime configuration | Source: src/integrations/supabase/client.ts |

| SUPABASE_SERVICE_ROLE_KEY | Server/integration/runtime configuration | Source: src/integrations/supabase/client.server.ts |

| SUPABASE_URL | Server/integration/runtime configuration | Source: src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts |

| TAVILY_API_KEY | Sensitive server configuration | Source: src/lib/tavily-flags.server.ts |

| TAVILY_BASE_URL | Server/integration/runtime configuration | Source: src/lib/tavily-gateway.server.ts |

| TAVILY_MAX_RETRIES | Server/integration/runtime configuration | .env.example name only |

| TAVILY_TIMEOUT_MS | Server/integration/runtime configuration | .env.example name only |

| TRIGGER_API_URL | Server/integration/runtime configuration | Source: src/server/trigger/flags.server.ts |

| TRIGGER_PROJECT_REF | Server/integration/runtime configuration | .env.example name only |

| TRIGGER_SECRET_KEY | Sensitive server configuration | Source: src/server/trigger/flags.server.ts |

| UGC_DEFAULT_MODEL | AI/media/routing control | Source: src/server/ugc/models.server.ts |

| UGC_MAX_CONCURRENT_RENDERS | AI/media/routing control | Source: src/server/ugc/service.server.ts |

| UNSPLASH_ACCESS_KEY | Server/integration/runtime configuration | Source: src/app/api/unsplash/random/route.ts |

| VIDEO_PROVIDER | AI/media/routing control | Source: src/server/ugc/models.server.ts |

| VIDEO_PROVIDER_CINEMATIC | AI/media/routing control | .env.example name only |

| VIDEO_PROVIDER_DRAFT | AI/media/routing control | .env.example name only |

| VIDEO_PROVIDER_FALLBACK | AI/media/routing control | Source: src/server/ugc/models.server.ts |

| VIDEO_PROVIDER_LONG | AI/media/routing control | .env.example name only |

| VIDEO_PROVIDER_PREMIUM | AI/media/routing control | .env.example name only |

| VIDEO_PROVIDER_STANDARD | AI/media/routing control | .env.example name only |

| VIDEO_PROVIDER_VARIATION | AI/media/routing control | .env.example name only |

| VISUAL_CAPTURE_BROWSER_CHANNEL | Server/integration/runtime configuration | Source: src/server/brand-visuals/browser.server.ts |

| VISUAL_CAPTURE_BROWSER_PATH | Server/integration/runtime configuration | Source: src/server/brand-visuals/browser.server.ts |

| WEBFLOW_CLIENT_ID | Server/integration/runtime configuration | .env.example name only |

| WEBFLOW_CLIENT_SECRET | Sensitive server configuration | .env.example name only |

| WEBFLOW_REDIRECT_URI | Server/integration/runtime configuration | .env.example name only |

| WEBFLOW_TOKEN_ENCRYPTION_KEY | Sensitive server configuration | .env.example name only |

| WORDPRESS_CLIENT_ID | Server/integration/runtime configuration | .env.example name only |

| WORDPRESS_CLIENT_SECRET | Sensitive server configuration | .env.example name only |

| WORDPRESS_REDIRECT_URI | Server/integration/runtime configuration | .env.example name only |

| WORDPRESS_TOKEN_ENCRYPTION_KEY | Sensitive server configuration | Source: src/server/fns/connectors.ts |

Implementation sources: .env.example; src/server/env.ts


## Operating records still needed

- Railway service inventory, regions, replicas, resource budgets and owner/escalation contacts.

- Applied database migrations, scheduled cron jobs and release-to-schema compatibility record.

- Configured provider/model overrides, app approvals, scopes and funded vendor accounts.

- Invoice-backed cost report, operational spend caps and alert thresholds.

- Backup/restore evidence, retention/export/deletion policy, RPO/RTO and contractual SLA.

- Documented production smoke results for auth, R2, payments, generation, social delivery and website writes.

## Source ledger and verification limits

Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.


The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.


| Source | SHA-256 prefix |

| --- | --- |

| Dockerfile | 430225c9b5bc79c7 |

| next.config.ts | bc5ebc3b26f710f9 |

| src/server/env.ts | a814c54a60a11cb0 |

| docs/deployment-guide.md | a607a06aa6bf0a3e |

| src/app/health/route.ts | a748db71cb16ffa1 |

| src/app/api/health/route.ts | 4b8000f7cc687574 |

| src/app/api/health/ready/route.ts | 6b771bafa6db6ca5 |

| scripts/start-production.mjs | 29457c96d4aa912a |

| src/instrumentation.ts | 5e3caad36277cc50 |

| src/server/cron.ts | a6ba76d8d76537e4 |

| supabase/migrations | directory reference |

| docs/storage.md | a019ec513b248c76 |

| src/server/assets/storage.server.ts | 5f20083ebbddc447 |

| src/server/connectors | directory reference |

| src/server/billing/readiness.server.ts | 21fce896eb96ab56 |

| src/lib/feature-flags.ts | e56ac35e17629593 |

| src/server/platform/flags.server.ts | 30ef38a324aada31 |

| src/server/platform/switches.server.ts | dcd79c367132d502 |

| src/server/platform/spend-caps.server.ts | c5e4e866004d91f2 |

| src/server/platform/routing-overrides.server.ts | 64efb98109da4141 |

| src/app/api/public/hooks | directory reference |

| src/app/api/public/hooks/run-schedules/route.ts | 8f479418bbf8ff6e |

| src/server/route.ts | 391e0eb6fa6c43a7 |

| src/server/safe-fetch.ts | 9f217ee77851db86 |

| src/server/guardrails | directory reference |

| src/server/mcp | directory reference |

| src/server/admin/route.ts | e04b317035a7a470 |

| src/integrations/supabase/client.ts | 3d76962d05c21248 |

| docs/security.md | 5fda9dc384550f40 |

| docs/privacy.md | 2ce0e7e923584f31 |

| docs/self-hosted-integrations.md | 20fc25ab6c39c75d |

| src/server/observability | directory reference |

| docs/operations.md | f48e2d659373decf |

| docs/storage-migration.md | 890c6f55243cb487 |

| .env.example | 00e8b119b49057d4 |