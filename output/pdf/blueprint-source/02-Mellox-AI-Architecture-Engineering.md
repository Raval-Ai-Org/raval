# Mellox AI - Architecture & Engineering

Snapshot: 2026-10-21 | commit 055c90977c2ccf15237e985b8a333e4b146e30be

## How to use this volume

This is volume 02 of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.


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

## System topology and source ownership

The confirmed hosting platform is Railway. The main deployable is a Next.js App Router application with browser components, route handlers and server-domain modules. Supabase supplies identity and PostgreSQL persistence; private Cloudflare R2 is the production media path. External providers supply AI, web research, social delivery, website integrations and payment processing.


The repository also contains Python intelligence packages and a separate FastAPI/Celery Social Distribution Engine. Their presence does not prove they run in the current Railway environment. The active TypeScript GEO scanner can run through the web runtime and database-driven hooks. Build the separate services only for selected execution paths. Older Amplify, Oracle tunnel, Lightsail or research deployment notes are not the owner's confirmed current hosting topology.


Implementation sources: Dockerfile; next.config.ts; src/app; src/server; backend; Social-Distribtion-Engine-MelloxAI-SDE; docs/repository-layout.md


Flow: Browser: React pages + editorial UI -> Next.js routes / RPC / protected callbacks -> Auth + workspace role + validation + rate limit -> Domain services + billing + durable job records -> Supabase / private R2 / external providers -> Webhooks + cron workers reconcile final state

| Layer | Owns | Must not own |

| --- | --- | --- |

| src/app + components | Navigation, forms, loading and review UI | Service credentials or authoritative delivery state |

| src/lib | Shared contracts, pure rules, helpers; explicitly named server modules also exist here | Assume every lib file is browser-safe |

| src/server + route handlers | Trust checks, external operations, job execution, metering | Trust client role/workspace/price assertions |

| Supabase | Identity, state, RLS, atomic claims, ledger durability | Infer business completion from a browser view |

| R2 | Private generated and uploaded media | Public uncontrolled access to all client assets |

| Python / SDR | Separate optional runtime boundaries | Assume main Next gateway rules apply automatically |

## Frontend composition and navigation

Route entry points live in src/app. Product surfaces live mainly in src/components/app, with shared UI, workspace and brand components. Workspace paths are generated through src/lib/workspace rather than assembled ad hoc. Public pages can avoid loading the full authenticated provider tree; providers.tsx distinguishes public paths and dynamically loads AppProviders.


TanStack Query handles server data and cache invalidation. Query keys include workspace identity, and workspace switching clears the affected cache. Local component state owns transient editing, not canonical publication status. Mutation completion invalidates the matching scoped reads. Async work retains the ID captured when the request started.


The UI stack is React 19, Tailwind 4, Radix primitives, Framer Motion, Lucide, Recharts and Sonner. Existing EmptyState, ErrorState, Skeleton and AppModalShell patterns should be reused. Every async feature needs loading, empty, failed, unavailable/disabled and successful states. A pending edit must not be lost when an older fetch resolves.


Next.js behavior must be read from the installed node_modules/next/dist/docs version. The current config enables standalone output and names external server packages for parsing and rendering. New features should preserve the server/client import boundary and current routing conventions rather than importing a server module into a client component.


Implementation sources: src/app/providers.tsx; src/app/AppProviders.tsx; src/lib/workspace; src/components/app; next.config.ts; node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md


## Authenticated route kernel and RPC

defineRoute centralizes authenticated HTTP handling. Its order is authentication, schema parsing, workspace membership/minimum role, rate limiting and handler. User-authenticated routes can attribute a workspace header only after membership checks; workspace routes resolve an explicit ID from validated input. The handler receives the caller's RLS-bound Supabase client, request context and abort signal.


The RPC route /api/rpc/[...fn] dispatches through src/server/fns/index.ts. Client stubs call registered server functions rather than importing server implementation. A server function combines authentication middleware, Zod input validation, role checks and a domain service. The route name, not a client-selected implementation name, decides what executes.


The main kernel maps BillingError to HTTP 402, budget exhaustion to 429, malformed input or blocked URLs to 400, oversized bodies to 413, auth failures to 401, role denials to the owning 403 path, and stale editorial conflicts to 409. Provider errors are normalized; internal stack traces, balances, keys and raw provider messages are not the response contract. Streaming endpoints also need correct cancellation and settlement behavior.


Implementation sources: src/server/route.ts; src/server/server-fn.ts; src/server/fns/index.ts; src/app/api/rpc; src/server/request-context.ts


### Recommended contract for a new workspace mutation

- Accept a workspace UUID and only feature-owned input fields; validate lengths, formats and allowed enum values.

- Authenticate and require the operation-specific role before any paid provider call or privileged read.

- Load each referenced row inside that workspace, even when the supplied item ID is a valid UUID.

- Check feature availability, quota, balance, safety and idempotency before producing a side effect.

- Write using the read revision or an atomic state transition, and return a stable domain result.

- Map failure without leaking raw upstream bodies; preserve retryable and ambiguous outcomes in durable state.

## Persistence, ownership and transactions

Supabase PostgreSQL is the durable source of truth for workspace, brand, content, approval, job, usage, account and connector state. Generated TypeScript Row/Insert/Update types help clients use that schema; they are not a replacement for migrations, SQL constraints, grants or RLS.


Most customer records carry workspace_id, and their policies check membership or role helpers. The user client carries the caller's JWT and uses RLS. Service-role clients bypass RLS, so every privileged service path must validate the workspace and row relationship explicitly. Ownership columns are protected in important domains to stop records being moved across tenants.


Concurrent workflows use atomic claims, database functions, leases and revision checks. Lease duration is not proof the worker is alive; another worker may reclaim expired work. Idempotency must surround the external operation and its stored provider ID, not just the first HTTP request. Financial holds, capture, release and grants require transaction-safe functions and stable replay keys.


Volume 06 contains the full checked-in table/column dictionary, foreign-key relationships, database function names and migration chronology. It intentionally avoids pretending generated types encode every runtime policy. Start a clean database from the canonical migration sequence and verify it, rather than create approximate tables by hand from this PDF.


Implementation sources: supabase/migrations; src/integrations/supabase/types.ts; src/integrations/supabase/client.user.server.ts; src/integrations/supabase/client.server.ts


## Long-running jobs and reconciliation

Generation, scans, analytics synchronization, competitor research, audience runs, Autopilot steps and media completion outlive an ordinary click. The request stores a job and may start a bounded after() continuation. Cron hooks reclaim or advance work that timed out or survived a process restart.


The run-schedules hook is a shared coordinator: scheduled jobs and due Market Brain collections each have bounded batch reads, while Autopilot and Audience have bounded execution budgets. It also schedules refresh of social trends, audience outcome collection, visual capture and expired-memory cleanup. Dedicated hooks advance GEO, UGC, distribution reconciliation, experiments, billing and operational checks.


Separate concerns: generation produces a reviewed artifact, publishing sends approved content, and reconciliation determines delivery truth. A timeout after submitting to a provider is an ambiguous side effect. Record and investigate the task rather than charging or posting again blindly. Terminal states must win over stale callbacks, and retries must not invalidate a newer user's edit.


Implementation sources: src/app/api/public/hooks/run-schedules/route.ts; src/server/cron.ts; src/server/studio/runner.server.ts; src/server/ugc/providers/routed.server.ts; src/lib/postforme


## Media data flow and storage contracts

The canonical storage adapter writes new production assets to R2 when configured. Keys include workspace/<workspaceId>/assets/r2/<assetId>/...; older keys without the r2 marker can remain in Supabase Storage. Reader and deletion logic chooses the correct backend from canonical identity, with server-only aliases for migrations.


Media persistence validates supported formats, size, ownership and idempotency. A persistence lease prevents concurrent overwrites; an expired process's lease can be reclaimed atomically. Replaying an old persistence request must not restore an intentionally deleted asset. User uploads and report logos also use the canonical storage layer.


The browser asks authenticated routes for short-lived access. The download route obtains a fresh five-minute attachment URL after membership and workspace-path checks, letting the browser navigate directly without buffering a large video. Private buckets stay private. Canvas or fetch use of signed URLs still requires approved GET/HEAD CORS origins. A signed URL is a temporary access artifact, never the permanent database identity of media.


Implementation sources: src/server/assets/storage.server.ts; src/server/assets; src/app/api/assets/download/route.ts; docs/storage.md; docs/storage-migration.md


## Integration boundary map

| Integration | Current code responsibility | Readiness / restriction |

| --- | --- | --- |

| OpenRouter | Text, vision, tools, images; selected video paths | Key, model availability, budget and route configuration |

| KIE | Selected UGC video model paths and fallback interplay | Key and per-option provider capabilities; do not assume retired |

| Post for Me | Account connection, publish/schedule, feed/metrics, callbacks | Preferred when configured; seven Mellox networks |

| Self-hosted SDR | Optional separate distribution runtime | Explicit provider selection and workspace enablement |

| SocialAPI | Compatibility code and old records | Retired as active distribution provider |

| Tavily / Firecrawl | Search, extract, crawl and evidence gathering | Optional configured capabilities; distinct charges |

| Google | Sign-in separately from GA4/GSC OAuth and data sync | Exact callback, selected property/site, encrypted grants |

| GitHub | Repository ownership, source reads, reviewable PR writes | App installation, host ownership and reviewed revisions |

| WordPress / Webflow | Site integration, articles and supported fixes | Check connected provider capability for each operation |

| Canva | Design creation, editing round trip and versioned export | OAuth scopes; preview conversion flag; safe export download |

| Notion | Manual calendar exchange with preview/conflicts | No automatic delivery authority |

| Slack | Opt-in workspace connector and inbound processing | Disabled unless enabled; signed and bound input |

| Stripe | Owner-account plans/packs and separate link purchasing | Signed webhooks; price mapping; idempotent grants |

| Resend | Approval, billing and summary emails | Configured sender; skipped notices do not imply approval |

| Helicone / Trigger.dev / Mastra / Promptfoo | Optional telemetry/orchestration/evaluation paths | Installed library or config does not prove live service activation |

| Pexels / Unsplash | Stock media paths | Provider configuration, rights and attribution still matter |

Implementation sources: src/server/env.ts; src/lib/feature-flags.ts; src/server/connectors; src/server/analytics; src/server/billing; docs/self-hosted-integrations.md


## OAuth, callbacks and connector state

Connector installation starts in an authenticated workspace context and binds provider authorization to the initiating user and workspace. One-use state, expiration, safe internal return paths and membership rechecks protect callbacks. Provider tokens stay in encrypted server-only credential storage; browser responses contain status and validated destinations rather than raw credentials.


Canva uses PKCE and serialized installation/refresh/withdrawal. Notion adds callback browser binding and an atomic operation lease around imports/exports. Keep the service-role-derived encryption root stable across deploys, or preserve a configured legacy dedicated key until grants are replaced. Rotating a key without a migration can make existing grants unreadable.


Readiness is capability-specific. A valid OAuth grant does not prove sufficient scopes, selected data source, provider app verification or usable write permissions. Disconnection removes local grants and attempts provider invalidation where supported; a provider without revocation may require user action in that provider. Imported content has its own retained lifecycle.


Implementation sources: src/server/connectors/canva; src/server/connectors/notion; src/server/analytics/google; docs/canva-integration.md; docs/notion-integration.md


## AI Visibility engineering

The main app's pure GEO engine separates fetching from deterministic evaluation. analyze-page builds structured evidence; rules consume page/site context; score calculates points; fix recipes and proposal services translate findings into actions. Stable rule IDs and fingerprints preserve finding state across scans.


Current scoring gives pass 1, warning 0.5, failure 0, and excludes not-applicable rules. Category scores are weighted means of applicable rule credit, then the six category shares create the overall score. Shares are AI access 20%, technical 20%, structured data 15%, content 20%, authority 20% and rendering/performance 5%. SCORE_VERSION is 2; different versions must not be presented as ordinary score movement.


Priority combines impact, confidence and effort: 0.5 x impact + 0.25 x confidence + 0.25 x (1 - effortValue). Effort values are low .25, medium .5 and high .75. Thresholds are .8 critical, .6 high, .4 medium. Rule confidence and an emerging convention do not become proof of causal search ranking influence.


Full scans persist a frontier and checkpoint under leases; browser rendering is a separately controlled fallback for empty client shells. All page requests and redirects go through safe fetching. A fix applies only within the connected source's verified ownership boundary and requires post-change verification.


Implementation sources: src/lib/geo/analyze-page.ts; src/lib/geo/rules.ts; src/lib/geo/score.ts; src/lib/geo/types.ts; src/server/geo; src/server/safe-fetch.ts


## Separate Python intelligence and SDR runtimes

The backend package is a Python/FastAPI analysis and persistence runtime with crawler, connector, content/entity/fix/opportunity/validation packages. It has its own adapter and configuration surface. Its provider adapters must not be described as active main-app model routes. Some Python model defaults and historical documents reference older generations; their production use and provider availability were not confirmed, so they are excluded from the current main-app model recommendation.


The Social Distribution Engine has its own Docker/Compose and Railway API, worker and beat configuration files. It is an independently tested service with provider OAuth, delivery and multi-tenant concerns. The main app's default Post for Me path does not require deploying this service solely because its files are present.


For a rebuild, retain a separate service only if the selected feature path needs it. Otherwise duplicate queues, provider credentials and databases create extra operational state without improving the editorial product. Any consolidation requires a migration plan for existing records and callbacks; file location alone is not permission to remove a runtime.


Implementation sources: backend; crawler; connectors; Social-Distribtion-Engine-MelloxAI-SDE/README.md; Social-Distribtion-Engine-MelloxAI-SDE/railway.toml


## Dependencies and resolved versions

The requested ranges come from package.json; resolved versions come from package-lock.json, not a claim that the local install was built or that these are the latest upstream releases. A rebuild should reproduce the lockfile first. Dependencies below are the complete main application dependency list; development tooling is in package.json.


| Dependency | Requested | Lockfile |

| --- | --- | --- |

| @aws-sdk/client-s3 | ^3.1149.0 | 3.1149.0 |

| @aws-sdk/s3-request-presigner | ^3.1149.0 | 3.1149.0 |

| @hookform/resolvers | ^5.2.2 | 5.9.1 |

| @mastra/core | ^1.67.0 | 1.75.0 |

| @mdx-js/loader | ^3.1.1 | 3.1.1 |

| @mdx-js/react | ^3.1.1 | 3.1.1 |

| @mendable/firecrawl-js | ^4.40.0 | 4.45.0 |

| @modelcontextprotocol/sdk | ^1.31.0 | 1.32.1 |

| @next/mdx | ^16.4.0 | 16.4.0 |

| @radix-ui/react-alert-dialog | ^1.1.15 | 1.1.23 |

| @radix-ui/react-avatar | ^1.1.11 | 1.2.6 |

| @radix-ui/react-dialog | ^1.1.15 | 1.1.23 |

| @radix-ui/react-dropdown-menu | ^2.1.16 | 2.1.24 |

| @radix-ui/react-label | ^2.1.8 | 2.1.15 |

| @radix-ui/react-popover | ^1.1.15 | 1.1.23 |

| @radix-ui/react-progress | ^1.1.8 | 1.1.16 |

| @radix-ui/react-select | ^2.2.6 | 2.3.7 |

| @radix-ui/react-slot | ^1.2.4 | 1.3.3 |

| @radix-ui/react-switch | ^1.2.6 | 1.3.7 |

| @radix-ui/react-tabs | ^1.1.13 | 1.1.21 |

| @radix-ui/react-tooltip | ^1.2.8 | 1.2.16 |

| @radix-ui/react-visually-hidden | ^1.2.6 | 1.2.11 |

| @supabase/ssr | ^0.12.7 | 0.12.7 |

| @supabase/supabase-js | ^2.110.0 | 2.114.0 |

| @tailwindcss/postcss | ^4.2.1 | 4.3.3 |

| @tanstack/react-query | ^5.83.0 | 5.102.8 |

| @trigger.dev/sdk | ^4.6.2 | 4.7.3 |

| @types/mdx | ^2.0.14 | 2.0.14 |

| @vercel/analytics | ^2.0.1 | 2.0.1 |

| @vercel/speed-insights | ^2.0.0 | 2.0.0 |

| class-variance-authority | ^0.7.1 | 0.7.1 |

| clsx | ^2.1.1 | 2.1.1 |

| cmdk | ^1.1.1 | 1.1.1 |

| date-fns | ^4.1.0 | 4.4.0 |

| diff | ^8.0.4 | 8.0.4 |

| eventsource-parser | ^3.1.0 | 3.1.1 |

| framer-motion | ^12.38.0 | 12.43.0 |

| jspdf | ^4.2.1 | 4.2.1 |

| lenis | ^1.3.26 | 1.3.26 |

| lucide-react | ^0.575.0 | 0.575.0 |

| mammoth | ^1.12.0 | 1.13.0 |

| next | ^16.3.8 | 16.4.0 |

| pdfjs-dist | ^6.1.200 | 6.3.289 |

| playwright-core | ^1.56.0 | 1.56.0 |

| post-for-me | ^2.9.1 | 2.9.1 |

| postcss | ^8.5.6 | 8.5.27 |

| pptxgenjs | ^3.12.0 | 3.12.0 |

| react | ^19.2.0 | 19.2.8 |

| react-dom | ^19.2.0 | 19.2.8 |

| react-hook-form | ^7.71.2 | 7.87.0 |

| react-markdown | ^10.1.0 | 10.1.0 |

| recharts | ^2.15.4 | 2.15.4 |

| redis | ^5.12.1 | 5.12.1 |

| rehype-sanitize | ^6.0.0 | 6.0.0 |

| rehype-stringify | ^10.0.1 | 10.0.1 |

| remark-gfm | ^4.0.1 | 4.0.1 |

| sharp | ^0.35.5 | 0.35.5 |

| sonner | ^2.0.7 | 2.0.8 |

| stripe | ^22.6.2 | 22.6.2 |

| tailwind-merge | ^3.5.0 | 3.6.0 |

| tailwindcss | ^4.2.1 | 4.3.3 |

| tw-animate-css | ^1.3.4 | 1.4.0 |

| typescript | ^5.9.3 | 5.9.3 |

| undici | ^8.10.2 | 8.11.2 |

| ws | ^8.21.0 | 8.21.3 |

| xlsx | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz | 0.20.3 |

| zod | ^3.25.76 | 3.25.76 |

Implementation sources: package.json; package-lock.json


## HTTP API route index

All 159 current API route files are listed. Methods and minimum roles are statically extracted from direct export/option syntax; a blank or "see source" is not permission to call anonymously. Re-exports, custom authentication, RPC middleware and public signed hooks require reading the named route. Input schema names are an index, not a JSON Schema specification.


| Route | Methods | Role / source |

| --- | --- | --- |

| /api/admin/abuse | GET | see source; src/app/api/admin/abuse/route.ts |

| /api/admin/ai/caps | POST | see source; src/app/api/admin/ai/caps/route.ts |

| /api/admin/ai | GET | see source; src/app/api/admin/ai/route.ts |

| /api/admin/ai/routing | POST | see source; src/app/api/admin/ai/routing/route.ts |

| /api/admin/analytics | GET | see source; src/app/api/admin/analytics/route.ts |

| /api/admin/announcements | GET, POST | see source; src/app/api/admin/announcements/route.ts |

| /api/admin/audit/export | POST | see source; src/app/api/admin/audit/export/route.ts |

| /api/admin/audit | GET | see source; src/app/api/admin/audit/route.ts |

| /api/admin/billing/accounts | GET | see source; src/app/api/admin/billing/accounts/route.ts |

| /api/admin/billing/enforcement | POST | see source; src/app/api/admin/billing/enforcement/route.ts |

| /api/admin/billing/manage | POST | see source; src/app/api/admin/billing/manage/route.ts |

| /api/admin/billing/requests | GET | see source; src/app/api/admin/billing/requests/route.ts |

| /api/admin/billing | GET, POST | see source; src/app/api/admin/billing/route.ts |

| /api/admin/credits | POST | see source; src/app/api/admin/credits/route.ts |

| /api/admin/entitlements/overrides/revoke | POST | see source; src/app/api/admin/entitlements/overrides/revoke/route.ts |

| /api/admin/entitlements/overrides | POST | see source; src/app/api/admin/entitlements/overrides/route.ts |

| /api/admin/entitlements | GET | see source; src/app/api/admin/entitlements/route.ts |

| /api/admin/flags | GET, POST | see source; src/app/api/admin/flags/route.ts |

| /api/admin/health | GET | see source; src/app/api/admin/health/route.ts |

| /api/admin/integrations | GET | see source; src/app/api/admin/integrations/route.ts |

| /api/admin/jobs/cancel | POST | see source; src/app/api/admin/jobs/cancel/route.ts |

| /api/admin/jobs/nudge | POST | see source; src/app/api/admin/jobs/nudge/route.ts |

| /api/admin/jobs | GET | see source; src/app/api/admin/jobs/route.ts |

| /api/admin/lookup | GET | see source; src/app/api/admin/lookup/route.ts |

| /api/admin/me | GET | see source; src/app/api/admin/me/route.ts |

| /api/admin/overview | GET | see source; src/app/api/admin/overview/route.ts |

| /api/admin/security | GET | see source; src/app/api/admin/security/route.ts |

| /api/admin/switches | GET, POST | see source; src/app/api/admin/switches/route.ts |

| /api/admin/team | GET, POST | see source; src/app/api/admin/team/route.ts |

| /api/admin/usage | GET | see source; src/app/api/admin/usage/route.ts |

| /api/admin/users/detail | GET | see source; src/app/api/admin/users/detail/route.ts |

| /api/admin/users/notes | POST | see source; src/app/api/admin/users/notes/route.ts |

| /api/admin/users | GET | see source; src/app/api/admin/users/route.ts |

| /api/admin/users/sessions | POST | see source; src/app/api/admin/users/sessions/route.ts |

| /api/admin/users/suspend | POST | see source; src/app/api/admin/users/suspend/route.ts |

| /api/admin/view/end | POST | see source; src/app/api/admin/view/end/route.ts |

| /api/admin/view | GET | see source; src/app/api/admin/view/route.ts |

| /api/admin/view/start | POST | see source; src/app/api/admin/view/start/route.ts |

| /api/admin/workspaces/access | POST | see source; src/app/api/admin/workspaces/access/route.ts |

| /api/admin/workspaces/detail | GET | see source; src/app/api/admin/workspaces/detail/route.ts |

| /api/admin/workspaces | GET | see source; src/app/api/admin/workspaces/route.ts |

| /api/agent-tasks | POST | see source; src/app/api/agent-tasks/route.ts |

| /api/agents/actions | GET, POST | editor; src/app/api/agents/actions/route.ts |

| /api/agents/findings | GET, POST | editor; src/app/api/agents/findings/route.ts |

| /api/agents/run | POST, GET | editor; src/app/api/agents/run/route.ts |

| /api/agents/runs | GET | see source; src/app/api/agents/runs/route.ts |

| /api/agents/settings | GET, POST | admin; src/app/api/agents/settings/route.ts |

| /api/ai-generate | POST | system, user; src/app/api/ai-generate/route.ts |

| /api/assets/download | POST | see source; src/app/api/assets/download/route.ts |

| /api/assets/library | GET | see source; src/app/api/assets/library/route.ts |

| /api/assets/persist | POST | editor; src/app/api/assets/persist/route.ts |

| /api/assets/sign | POST | see source; src/app/api/assets/sign/route.ts |

| /api/assets/upload | POST | editor; src/app/api/assets/upload/route.ts |

| /api/auth/google/config | GET | see source; src/app/api/auth/google/config/route.ts |

| /api/billing/addons/change | POST | see source; src/app/api/billing/addons/change/route.ts |

| /api/billing/addons/preview | POST | see source; src/app/api/billing/addons/preview/route.ts |

| /api/billing/brands | GET, POST | see source; src/app/api/billing/brands/route.ts |

| /api/billing/checkout | POST | see source; src/app/api/billing/checkout/route.ts |

| /api/billing/entitlements | GET | owner; src/app/api/billing/entitlements/route.ts |

| /api/billing/history | GET | see source; src/app/api/billing/history/route.ts |

| /api/billing/portal | POST | see source; src/app/api/billing/portal/route.ts |

| /api/billing/requests | GET, POST, DELETE | see source; src/app/api/billing/requests/route.ts |

| /api/billing/subscription/cancel | POST | see source; src/app/api/billing/subscription/cancel/route.ts |

| /api/billing/subscription/change | POST | see source; src/app/api/billing/subscription/change/route.ts |

| /api/billing/subscription/pause | POST | see source; src/app/api/billing/subscription/pause/route.ts |

| /api/billing/subscription/preview | POST | see source; src/app/api/billing/subscription/preview/route.ts |

| /api/billing/subscription/resume | POST | see source; src/app/api/billing/subscription/resume/route.ts |

| /api/billing/upgrade-requests | POST, GET, PATCH | see source; src/app/api/billing/upgrade-requests/route.ts |

| /api/billing/wallet | GET | owner; src/app/api/billing/wallet/route.ts |

| /api/brand-extract | POST | see source; src/app/api/brand-extract/route.ts |

| /api/brand-visuals/upload | POST | editor; src/app/api/brand-visuals/upload/route.ts |

| /api/chat | POST | system; src/app/api/chat/route.ts |

| /api/clarify | POST | see source; src/app/api/clarify/route.ts |

| /api/client-errors | POST | see source; src/app/api/client-errors/route.ts |

| /api/file-extract | POST | see source; src/app/api/file-extract/route.ts |

| /api/generate-image | POST | see source; src/app/api/generate-image/route.ts |

| /api/generate-video | POST | see source; src/app/api/generate-video/route.ts |

| /api/geo/scans | POST | editor; src/app/api/geo/scans/route.ts |

| /api/geo/scans/[id]/cancel | POST | editor; src/app/api/geo/scans/[id]/cancel/route.ts |

| /api/geo/scans/[id] | GET | see source; src/app/api/geo/scans/[id]/route.ts |

| /api/health/ready | GET | see source; src/app/api/health/ready/route.ts |

| /api/health | GET | see source; src/app/api/health/route.ts |

| /api/integrations/canva/callback | GET | see source; src/app/api/integrations/canva/callback/route.ts |

| /api/integrations/canva/connect | GET | editor; src/app/api/integrations/canva/connect/route.ts |

| /api/integrations/github/callback | GET | see source; src/app/api/integrations/github/callback/route.ts |

| /api/integrations/github/webhook | POST, GET | see source; src/app/api/integrations/github/webhook/route.ts |

| /api/integrations/google/callback | GET | see source; src/app/api/integrations/google/callback/route.ts |

| /api/integrations/notion/callback | GET | see source; src/app/api/integrations/notion/callback/route.ts |

| /api/integrations/notion/connect | GET | editor; src/app/api/integrations/notion/connect/route.ts |

| /api/integrations/slack/events | POST | see source; src/app/api/integrations/slack/events/route.ts |

| /api/integrations/slack/interactivity | POST | see source; src/app/api/integrations/slack/interactivity/route.ts |

| /api/integrations/slack/oauth/callback | GET | see source; src/app/api/integrations/slack/oauth/callback/route.ts |

| /api/integrations/webflow/callback | GET | see source; src/app/api/integrations/webflow/callback/route.ts |

| /api/integrations/wordpress/callback | GET | see source; src/app/api/integrations/wordpress/callback/route.ts |

| /api/market/intelligence | POST | see source; src/app/api/market/intelligence/route.ts |

| /api/market/latest | GET | see source; src/app/api/market/latest/route.ts |

| /api/market/trends | POST, GET | see source; src/app/api/market/trends/route.ts |

| /api/mcp | OPTIONS, POST, GET, DELETE | see source; src/app/api/mcp/route.ts |

| /api/memory-extract | POST | system, user; src/app/api/memory-extract/route.ts |

| /api/pexels/video | GET | see source; src/app/api/pexels/video/route.ts |

| /api/public/hooks/agents-tick | POST | see source; src/app/api/public/hooks/agents-tick/route.ts |

| /api/public/hooks/analytics-sync | POST, GET | see source; src/app/api/public/hooks/analytics-sync/route.ts |

| /api/public/hooks/billing | POST | see source; src/app/api/public/hooks/billing/route.ts |

| /api/public/hooks/competitor-watch | POST, GET | see source; src/app/api/public/hooks/competitor-watch/route.ts |

| /api/public/hooks/experiments | POST, GET | see source; src/app/api/public/hooks/experiments/route.ts |

| /api/public/hooks/geo-agents | POST, GET | see source; src/app/api/public/hooks/geo-agents/route.ts |

| /api/public/hooks/geo-scans | POST, GET | see source; src/app/api/public/hooks/geo-scans/route.ts |

| /api/public/hooks/kie | POST | see source; src/app/api/public/hooks/kie/route.ts |

| /api/public/hooks/link-catalog | POST, GET | see source; src/app/api/public/hooks/link-catalog/route.ts |

| /api/public/hooks/link-orders | POST, GET | see source; src/app/api/public/hooks/link-orders/route.ts |

| /api/public/hooks/openrouter-video | POST | see source; src/app/api/public/hooks/openrouter-video/route.ts |

| /api/public/hooks/ops-watch | POST | see source; src/app/api/public/hooks/ops-watch/route.ts |

| /api/public/hooks/postforme | POST | see source; src/app/api/public/hooks/postforme/route.ts |

| /api/public/hooks/run-schedules | POST, GET | see source; src/app/api/public/hooks/run-schedules/route.ts |

| /api/public/hooks/sdr | POST | see source; src/app/api/public/hooks/sdr/route.ts |

| /api/public/hooks/sdr-reconcile | POST | see source; src/app/api/public/hooks/sdr-reconcile/route.ts |

| /api/public/hooks/slack | POST | see source; src/app/api/public/hooks/slack/route.ts |

| /api/public/hooks/socialapi | POST | see source; src/app/api/public/hooks/socialapi/route.ts |

| /api/public/hooks/stripe | POST, GET | see source; src/app/api/public/hooks/stripe/route.ts |

| /api/public/hooks/ugc-renders | POST, GET | see source; src/app/api/public/hooks/ugc-renders/route.ts |

| /api/public/share/[slug] | GET, POST | see source; src/app/api/public/share/[slug]/route.ts |

| /api/rpc/[...fn] | POST | see source; src/app/api/rpc/[...fn]/route.ts |

| /api/sdr/accounts | GET | see source; src/app/api/sdr/accounts/route.ts |

| /api/sdr/cancel | POST | editor; src/app/api/sdr/cancel/route.ts |

| /api/sdr/disconnect | POST | editor; src/app/api/sdr/disconnect/route.ts |

| /api/sdr/oauth/start | POST | editor; src/app/api/sdr/oauth/start/route.ts |

| /api/sdr/publications | GET | see source; src/app/api/sdr/publications/route.ts |

| /api/sdr/publish | POST | editor; src/app/api/sdr/publish/route.ts |

| /api/sdr/schedule | POST | editor; src/app/api/sdr/schedule/route.ts |

| /api/sdr/status | GET | see source; src/app/api/sdr/status/route.ts |

| /api/shares | POST | editor; src/app/api/shares/route.ts |

| /api/social/analytics | GET | see source; src/app/api/social/analytics/route.ts |

| /api/social/connect/complete | POST | editor; src/app/api/social/connect/complete/route.ts |

| /api/social/connect/postforme/complete | POST | editor; src/app/api/social/connect/postforme/complete/route.ts |

| /api/social/connect/select | GET, POST | editor; src/app/api/social/connect/select/route.ts |

| /api/social/creator-info | GET | editor; src/app/api/social/creator-info/route.ts |

| /api/social/metrics/sync | POST | editor; src/app/api/social/metrics/sync/route.ts |

| /api/social/retry | POST | editor; src/app/api/social/retry/route.ts |

| /api/social-multi | POST | see source; src/app/api/social-multi/route.ts |

| /api/studio/ideas | POST | editor; src/app/api/studio/ideas/route.ts |

| /api/studio/jobs | POST, GET | editor; src/app/api/studio/jobs/route.ts |

| /api/studio/jobs/[id]/cancel | POST | editor; src/app/api/studio/jobs/[id]/cancel/route.ts |

| /api/studio/jobs/[id] | GET | see source; src/app/api/studio/jobs/[id]/route.ts |

| /api/studio/prompt | POST | editor; src/app/api/studio/prompt/route.ts |

| /api/studio/upload-captions | POST | editor; src/app/api/studio/upload-captions/route.ts |

| /api/ugc/models | GET | see source; src/app/api/ugc/models/route.ts |

| /api/ugc/products/extract | POST | editor; src/app/api/ugc/products/extract/route.ts |

| /api/ugc/projects | GET, POST | editor; src/app/api/ugc/projects/route.ts |

| /api/ugc/projects/[id]/concepts | POST | editor; src/app/api/ugc/projects/[id]/concepts/route.ts |

| /api/ugc/projects/[id]/notes | POST | editor; src/app/api/ugc/projects/[id]/notes/route.ts |

| /api/ugc/projects/[id] | GET, PATCH, DELETE | editor; src/app/api/ugc/projects/[id]/route.ts |

| /api/ugc/references/import | POST | editor; src/app/api/ugc/references/import/route.ts |

| /api/ugc/references/upload | POST | editor; src/app/api/ugc/references/upload/route.ts |

| /api/ugc/renders | POST | editor; src/app/api/ugc/renders/route.ts |

| /api/ugc/renders/[id]/cancel | POST | editor; src/app/api/ugc/renders/[id]/cancel/route.ts |

| /api/ugc/renders/[id]/download | GET | see source; src/app/api/ugc/renders/[id]/download/route.ts |

| /api/ugc/renders/[id]/post-draft | POST | editor; src/app/api/ugc/renders/[id]/post-draft/route.ts |

| /api/ugc/renders/[id] | GET | see source; src/app/api/ugc/renders/[id]/route.ts |

| /api/unsplash/random | GET | see source; src/app/api/unsplash/random/route.ts |

Implementation sources: src/app/api


## Server function registry index

The transport is /api/rpc/<module>/<export>. Only modules in fns/index.ts are reachable through the generic resolver, and only exports marked as actual server functions resolve. The list below statically finds createServerFn exports in source files; inspect index.ts before treating any file as registered. Schemas and role checks are in the cited source.


### src/server/fns/analytics.ts

getAnalyticsSummary, getAnalyticsDrilldown, getAnalyticsReport, getAnalyticsInsights, refreshAnalyticsInsights, getAnalyticsChatContext


### src/server/fns/audience.ts

getAudienceStatus, getAudience, buildAudience, saveAudienceGroup, removeAudienceGroup, getAudienceScores, getContentAudience, predictContent, startAudienceCheck, startAudienceComparison, startAudienceRanking, getAudienceRun, cancelAudienceRun, listAudiencePredictions


### src/server/fns/autopilot.ts

getAutopilotStatus, getAutopilot, suggestAutopilotStrategy, startAutopilot, updateAutopilot, setAutopilotPaused, stopAutopilot, approveAutopilotPlan, decideAutopilotAction, retryAutopilotAction, decideOpportunity, getAgencyAutopilot


### src/server/fns/brain.ts

getBrainOverview


### src/server/fns/brand-dna.ts

getBrandDna, saveBrandDna


### src/server/fns/brand-visuals.ts

restoreManualVisualLook, editVisualArtwork, learnVisualReferences, getVisualTaste, scanVisualWebsite, addVisualReference, updateVisualReference, saveVisualDirection, giveVisualFeedback, cancelVisualScan


### src/server/fns/campaign-generation.ts

generateCampaignBrief


### src/server/fns/canva.ts

getCanvaConnection, startCanvaConnect, completeCanvaConnect, removeCanvaConnection, createCanvaEdit, getCanvaEditState, importCanvaVersion, selectCanvaVersionAction, restoreCanvaOriginalAction


### src/server/fns/chat-actions.ts

getChatActions, runChatAction


### src/server/fns/coach.ts

getCoachBriefing


### src/server/fns/competitor-intel.ts

startCompetitorIntel, getCompetitorIntelRun, listCompetitorIntelRuns


### src/server/fns/competitor-watch.ts

listCompetitorWatches, addCompetitorWatch, removeCompetitorWatch, toggleCompetitorWatch, runCompetitorWatchNow, listCompetitorAlerts, markCompetitorAlertsRead


### src/server/fns/competitors.ts

getCompetitorOverview, discoverCompetitors, bootstrapCompetitors, addCompetitor, setCompetitorStatus, trackCompetitors, refreshCompetitor, markCompetitorUpdatesRead, removeCompetitor


### src/server/fns/connectors.ts

getConnectors, startGithubInstall, completeGithubInstall, verifyConnection, disconnectConnection, listGithubRepositories, selectGithubRepository, updateSource, removeSource, inspectSource, verifySourceOwnership, attestSourceOwnership, setAgentConsent, getSiteSource


### src/server/fns/content.ts

listContentItems, createContentItem, updateContentItem, deleteContentItem, rescheduleContentItem, regenerateContentItem, generateContentBatch, planContentCalendar, setContentPlanDate, setContentItemStatus, listAgencyFeed, suggestNextSteps, generateNextPost


### src/server/fns/experiments.ts

getProofEngineStatus, getExperimentsOverview, getExperiment, getDelivery, detectPageGroups, checkGroupEligibility, prepareGroupSetup, approveGroupSetup, discardDelivery, suggestHypotheses, createExperiment, retryPrepare, editExperimentValue, refreshShip, approveExperiment, discardExperiment, cancelExperiment, stopExperiment, prepareDecision, approveDecision, keepExperiment, closeExperiment, setReportBranding, getExperimentReport


### src/server/fns/geo-aeo-audit.ts

runGeoAeoAudit


### src/server/fns/geo-agent.ts

startAgentRun, getAgentRun, getAgentRunForFinding, listAgentRuns, approveAgentPlan, reviseAgentPlan, submitAgentInputs, cancelAgentRun, retryAgentRun


### src/server/fns/geo-fixes.ts

getFixAvailability, listFixBranches, previewFix, createFixProposal, getFixProposal, approveFixProposal, undoCmsFix, getSiteConnections, getCmsFixAll, startCmsFixAll, applyCmsFixAll, discardFixProposal, requestVerification, getVerification, getFixAllPreflight, createFixBatch, getFixBatch, approveFixBatch, mergeFixBatch, mergeFixProposal, discardFixBatch, getFixImpact, listFixActivity


### src/server/fns/geo.ts

listScans, getScanFindings, getScanPages, getScanPage, compareScans, setFindingState, bulkSetFindingStates, markFindingsReviewed, listMonitors, saveMonitor, deleteMonitor, getGeoSettings


### src/server/fns/google-analytics.ts

getGoogleConnection, startGoogleConnect, completeGoogleConnect, listGa4Properties, listGscSites, selectGa4Property, selectGscSite, removeAnalyticsSource, disconnectGoogle, syncAnalyticsNow, getSyncStatus


### src/server/fns/insights.ts

getGeoTrend, refreshSuggestions, upsertMemoryInsights, listMemoryInsights


### src/server/fns/links.ts

getOverview, findPlacements, suggestLinkText, writeBrief, saveSelection, getOrder, confirmOrder, discardDraft, recheckPlacement, getCreditHistory


### src/server/fns/mcp.ts

getMcpSettings, updateMcpSettings, listMcpActivity


### src/server/fns/memory.ts

getMemoryStatus, getMemory, addMemory, editMemory, removeMemory, restoreMemory, clearMemory, setMemoryEnabled, proposeMemories


### src/server/fns/notion.ts

getNotionConnection, startNotionConnect, disconnectNotion, listNotionDestinations, selectNotionDestination, createNotionDestination, exportToNotion, previewNotionImport, importFromNotion, syncNotionNow, listNotionConflicts, resolveNotionConflict


### src/server/fns/publish.ts

getPublishQueue


### src/server/fns/schedules.ts

listScheduledJobs, createScheduledJob, updateScheduledJob, deleteScheduledJob, runScheduledJobNow


### src/server/fns/site-publishing.ts

previewArticlePublish, publishArticle, getArticlePublication, cancelArticlePublication, recheckArticlePublication, setupSiteBlog


### src/server/fns/slack.ts

getSlackConnection, startSlackConnect, listSlackChannels, setSlackChannel, setSlackPreferences, createSlackLinkCode, sendSlackTest, disconnectSlack


### src/server/fns/stories.ts

getStoriesStatus, shareVideoAsStory, shareStoryAsReel, getStoryAnalytics


### src/server/fns/strategy.ts

getStrategy, generateStrategy, saveStrategy


### src/server/fns/tracked-prompts.ts

getTrackedPrompts, suggestTrackedPrompts, addTrackedPrompt, setTrackedPromptPaused, deleteTrackedPrompt, checkTrackedPromptNow


### src/server/fns/webflow.ts

getWebflowConnection, startWebflowConnect, completeWebflowConnect, refreshWebflowSites, selectWebflowSite, disconnectWebflow, getWebflowData


### src/server/fns/wordpress.ts

getWordPressConnection, connectWordPress, startWordPressOAuth, completeWordPressOAuth, refreshWordPress, selectWordPressSite, disconnectWordPress, getWordPressData, publishWordPress


### src/server/fns/workspaces.ts

renameWorkspace, getWorkspaceDetails, listApprovals, decideApproval, createWorkspace, listWorkspaces, deleteWorkspace, ensureAuthWorkspace, acceptWorkspaceInvite, getWorkspaceMemberProfiles, createWorkspaceInvite, revokeWorkspaceInvite, updateWorkspaceMemberRole, removeWorkspaceMember


Implementation sources: src/server/fns/index.ts; src/server/fns


## Page and route surface index

These are file-system page entry points, including public/auth, workspace, staff and development labs. Route groups in parentheses are source structure and do not appear in the public URL. Dynamic parameters need real IDs. A lab page is not a commercial feature merely because it exists.


| Route expression | Owning source |

| --- | --- |

| /(marketing)/about | src/app/(marketing)/about/page.tsx |

| /(marketing)/about/[slug] | src/app/(marketing)/about/[slug]/page.tsx |

| /(marketing)/blog | src/app/(marketing)/blog/page.tsx |

| /(marketing)/blog/[slug] | src/app/(marketing)/blog/[slug]/page.tsx |

| /(marketing)/changelog | src/app/(marketing)/changelog/page.tsx |

| /(marketing)/compare | src/app/(marketing)/compare/page.tsx |

| /(marketing)/contact | src/app/(marketing)/contact/page.tsx |

| /(marketing)/contact/partner | src/app/(marketing)/contact/partner/page.tsx |

| /(marketing)/contact/press | src/app/(marketing)/contact/press/page.tsx |

| /(marketing)/cookies | src/app/(marketing)/cookies/page.tsx |

| /(marketing)/demo | src/app/(marketing)/demo/page.tsx |

| /(marketing)/docs | src/app/(marketing)/docs/page.tsx |

| /(marketing)/faq | src/app/(marketing)/faq/page.tsx |

| /(marketing)/features/[slug] | src/app/(marketing)/features/[slug]/page.tsx |

| /(marketing)/integrations | src/app/(marketing)/integrations/page.tsx |

| /(marketing) | src/app/(marketing)/page.tsx |

| /(marketing)/pricing | src/app/(marketing)/pricing/page.tsx |

| /(marketing)/privacy | src/app/(marketing)/privacy/page.tsx |

| /(marketing)/safety | src/app/(marketing)/safety/page.tsx |

| /(marketing)/security | src/app/(marketing)/security/page.tsx |

| /(marketing)/terms | src/app/(marketing)/terms/page.tsx |

| /(marketing)/use-cases/[slug] | src/app/(marketing)/use-cases/[slug]/page.tsx |

| /admin/(console)/abuse | src/app/admin/(console)/abuse/page.tsx |

| /admin/(console)/ai | src/app/admin/(console)/ai/page.tsx |

| /admin/(console)/analytics | src/app/admin/(console)/analytics/page.tsx |

| /admin/(console)/announcements | src/app/admin/(console)/announcements/page.tsx |

| /admin/(console)/audit | src/app/admin/(console)/audit/page.tsx |

| /admin/(console)/emergency | src/app/admin/(console)/emergency/page.tsx |

| /admin/(console)/flags | src/app/admin/(console)/flags/page.tsx |

| /admin/(console)/health | src/app/admin/(console)/health/page.tsx |

| /admin/(console)/integrations | src/app/admin/(console)/integrations/page.tsx |

| /admin/(console)/jobs | src/app/admin/(console)/jobs/page.tsx |

| /admin/(console) | src/app/admin/(console)/page.tsx |

| /admin/(console)/plans | src/app/admin/(console)/plans/page.tsx |

| /admin/(console)/security | src/app/admin/(console)/security/page.tsx |

| /admin/(console)/support | src/app/admin/(console)/support/page.tsx |

| /admin/(console)/team | src/app/admin/(console)/team/page.tsx |

| /admin/(console)/usage | src/app/admin/(console)/usage/page.tsx |

| /admin/(console)/users | src/app/admin/(console)/users/page.tsx |

| /admin/(console)/users/[id] | src/app/admin/(console)/users/[id]/page.tsx |

| /admin/(console)/view/[id] | src/app/admin/(console)/view/[id]/page.tsx |

| /admin/(console)/workspaces | src/app/admin/(console)/workspaces/page.tsx |

| /admin/(console)/workspaces/[id] | src/app/admin/(console)/workspaces/[id]/page.tsx |

| /admin/billing | src/app/admin/billing/page.tsx |

| /admin-lab | src/app/admin-lab/page.tsx |

| /agency | src/app/agency/page.tsx |

| /analytics | src/app/analytics/page.tsx |

| /analytics-lab | src/app/analytics-lab/page.tsx |

| /app/analytics | src/app/app/analytics/page.tsx |

| /app/chat/[conversationId] | src/app/app/chat/[conversationId]/page.tsx |

| /app/content | src/app/app/content/page.tsx |

| /app/library | src/app/app/library/page.tsx |

| /app | src/app/app/page.tsx |

| /app/seo | src/app/app/seo/page.tsx |

| /app/social/connected | src/app/app/social/connected/page.tsx |

| /app/social | src/app/app/social/page.tsx |

| /audience-lab | src/app/audience-lab/page.tsx |

| /auth/callback | src/app/auth/callback/page.tsx |

| /auth/confirm | src/app/auth/confirm/page.tsx |

| /autopilot-lab | src/app/autopilot-lab/page.tsx |

| /brain-lab | src/app/brain-lab/page.tsx |

| /calendar | src/app/calendar/page.tsx |

| /calendar-lab | src/app/calendar-lab/page.tsx |

| /canva-lab | src/app/canva-lab/page.tsx |

| /chat-lab | src/app/chat-lab/page.tsx |

| /command-center-lab | src/app/command-center-lab/page.tsx |

| /connections-lab | src/app/connections-lab/page.tsx |

| /content | src/app/content/page.tsx |

| /integrations/canva/callback | src/app/integrations/canva/callback/page.tsx |

| /integrations/github/callback | src/app/integrations/github/callback/page.tsx |

| /integrations/google/callback | src/app/integrations/google/callback/page.tsx |

| /integrations/notion/result | src/app/integrations/notion/result/page.tsx |

| /integrations/webflow/callback | src/app/integrations/webflow/callback/page.tsx |

| /integrations/wordpress/callback | src/app/integrations/wordpress/callback/page.tsx |

| /layout-lab | src/app/layout-lab/page.tsx |

| /library | src/app/library/page.tsx |

| /links-lab | src/app/links-lab/page.tsx |

| /login | src/app/login/page.tsx |

| /memory-lab | src/app/memory-lab/page.tsx |

| /oauth/consent | src/app/oauth/consent/page.tsx |

| /onboarding | src/app/onboarding/page.tsx |

| /projects | src/app/projects/page.tsx |

| /projects-lab | src/app/projects-lab/page.tsx |

| /promo-lab | src/app/promo-lab/page.tsx |

| /reset-password | src/app/reset-password/page.tsx |

| /share/[slug] | src/app/share/[slug]/page.tsx |

| /signup | src/app/signup/page.tsx |

| /start | src/app/start/page.tsx |

| /studio | src/app/studio/page.tsx |

| /studio-lab | src/app/studio-lab/page.tsx |

| /tour-lab | src/app/tour-lab/page.tsx |

| /upgrade-lab | src/app/upgrade-lab/page.tsx |

| /visual-taste-lab | src/app/visual-taste-lab/page.tsx |

| /w/[workspaceId]/app/audience | src/app/w/[workspaceId]/app/audience/page.tsx |

| /w/[workspaceId]/app/autopilot | src/app/w/[workspaceId]/app/autopilot/page.tsx |

| /w/[workspaceId]/app/backlinks | src/app/w/[workspaceId]/app/backlinks/page.tsx |

| /w/[workspaceId]/app/brain | src/app/w/[workspaceId]/app/brain/page.tsx |

| /w/[workspaceId]/app/brand-kit | src/app/w/[workspaceId]/app/brand-kit/page.tsx |

| /w/[workspaceId]/app/chat/[conversationId] | src/app/w/[workspaceId]/app/chat/[conversationId]/page.tsx |

| /w/[workspaceId]/app/competitors | src/app/w/[workspaceId]/app/competitors/page.tsx |

| /w/[workspaceId]/app/experiments | src/app/w/[workspaceId]/app/experiments/page.tsx |

| /w/[workspaceId]/app | src/app/w/[workspaceId]/app/page.tsx |

| /w/[workspaceId]/onboarding | src/app/w/[workspaceId]/onboarding/page.tsx |

| /w/[workspaceId] | src/app/w/[workspaceId]/page.tsx |

| /workspace | src/app/workspace/page.tsx |

| /workspace-lab | src/app/workspace-lab/page.tsx |

| /workspaces | src/app/workspaces/page.tsx |

Implementation sources: src/app


## Source ledger and verification limits

Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.


The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.


| Source | SHA-256 prefix |

| --- | --- |

| Dockerfile | 430225c9b5bc79c7 |

| next.config.ts | bc5ebc3b26f710f9 |

| src/app | directory reference |

| src/server | directory reference |

| backend | directory reference |

| Social-Distribtion-Engine-MelloxAI-SDE | directory reference |

| docs/repository-layout.md | 6ed2189f680847bc |

| src/app/providers.tsx | d39037cc3b594d83 |

| src/app/AppProviders.tsx | 7ad97f4926e8adaa |

| src/lib/workspace | directory reference |

| src/components/app | directory reference |

| node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md | c08524a1483abbda |

| src/server/route.ts | 391e0eb6fa6c43a7 |

| src/server/server-fn.ts | 8547a5c5ce5d83b9 |

| src/server/fns/index.ts | 84639cd2980d7fce |

| src/app/api/rpc | directory reference |

| src/server/request-context.ts | 3926d1867f4e6ee4 |

| supabase/migrations | directory reference |

| src/integrations/supabase/types.ts | 2c6c5e758669115b |

| src/integrations/supabase/client.user.server.ts | 6eeedbfe236a5e14 |

| src/integrations/supabase/client.server.ts | 367dae237158b834 |

| src/app/api/public/hooks/run-schedules/route.ts | 8f479418bbf8ff6e |

| src/server/cron.ts | a6ba76d8d76537e4 |

| src/server/studio/runner.server.ts | cbee09d7f87b6aa2 |

| src/server/ugc/providers/routed.server.ts | 042c0785447c2538 |

| src/lib/postforme | directory reference |

| src/server/assets/storage.server.ts | 5f20083ebbddc447 |

| src/server/assets | directory reference |

| src/app/api/assets/download/route.ts | 3faa81c7157ca0f9 |

| docs/storage.md | a019ec513b248c76 |

| docs/storage-migration.md | 890c6f55243cb487 |

| src/server/env.ts | a814c54a60a11cb0 |

| src/lib/feature-flags.ts | e56ac35e17629593 |

| src/server/connectors | directory reference |

| src/server/analytics | directory reference |

| src/server/billing | directory reference |

| docs/self-hosted-integrations.md | 20fc25ab6c39c75d |

| src/server/connectors/canva | directory reference |

| src/server/connectors/notion | directory reference |

| src/server/analytics/google | directory reference |

| docs/canva-integration.md | 3a4e314a5a82741a |

| docs/notion-integration.md | d34c7c9352c3f010 |

| src/lib/geo/analyze-page.ts | c67fb52a512c5a79 |

| src/lib/geo/rules.ts | 7b3c2594c6f5bf4a |

| src/lib/geo/score.ts | fb15eea103344041 |

| src/lib/geo/types.ts | d6d7268da86425d6 |

| src/server/geo | directory reference |

| src/server/safe-fetch.ts | 9f217ee77851db86 |

| crawler | directory reference |

| connectors | directory reference |

| Social-Distribtion-Engine-MelloxAI-SDE/README.md | 2ac5e3a6d2740330 |

| Social-Distribtion-Engine-MelloxAI-SDE/railway.toml | 025c5c2363a1b635 |

| package.json | c6995b00a40c90b8 |

| package-lock.json | 3128315607b265d7 |

| src/app/api | directory reference |

| src/server/fns | directory reference |