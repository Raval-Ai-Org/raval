# Mellox AI - Rebuild Plan & Data Reference

Snapshot: 2026-10-21 | commit 055c90977c2ccf15237e985b8a333e4b146e30be

## How to use this volume

This is volume 06 of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.


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

## How to rebuild from scratch

Rebuild Mellox around its invariants before copying its screens. Identity must be explicit, workspace data must stay isolated, paid work must be metered exactly once, generated work must remain reviewable, and long-lived side effects must survive process restarts. The order below is a recommended dependency plan inferred from current implementation, not a committed delivery schedule or team estimate.


Keep the six volumes and the source snapshot together. Volume 01 defines behavior, volume 02 maps architecture/contracts, volume 03 defines AI execution, volume 04 defines billing, volume 05 defines operations, and this volume provides implementation order plus the exact checked-in table/column and migration indexes.


PDFs cannot encode private vendor accounts, production environment values, invoices or future product decisions that were not supplied. A clean rebuild also needs a source repository and the owning provider accounts. Recreate the public contracts and invariants; do not assume an older audit, deprecated adapter or proposed feature is required merely because a historical file remains.


Implementation sources: docs/documentation-maintenance.md; src/server/route.ts; src/lib/billing/catalog.ts; supabase/migrations


## Phase 1 - repository and deployable skeleton

Deliver the Next.js/React/TypeScript skeleton, current styling primitives, app/public route split, server-only boundary, Supabase clients, environment validation and a Railway-compatible container. Use the checked-in lockfile versions as the reproducibility baseline. Read the installed Next.js documentation before changing framework configuration or routing.


Create development, isolated test and production environments with separate data and credentials. Establish a migration mechanism, release manifest and health identity before paid features. Install native tools for the selected runtime: Chromium, FFmpeg and the image-metadata dependencies when those capabilities are enabled. Optional Redis is valuable for shared cache/rate behavior across replicas, but durable truth stays in PostgreSQL.


Acceptance: fresh build starts with the intended port; missing required production variables fail clearly; /health is live; safe health/readiness paths report the release identity and unavailable capabilities honestly; a browser bundle contains no server credentials.


Implementation sources: package.json; package-lock.json; Dockerfile; src/server/env.ts; src/instrumentation.ts; next.config.ts


## Phase 2 - auth, workspaces, roles and account ownership

Implement signup/login, confirmation, password recovery, logout and workspace creation/listing. Wire canonical workspace routes, provider context and query-key isolation. Implement membership, invitation and role transitions with owner protection and operation-specific checks. Introduce the owner's billing account relationship before users create multiple brands.


Persist profiles, workspaces, members, invites, sources and connections through the canonical schema. Enable RLS, prohibit unsafe workspace reassignment, and reserve service-role queries for explicit server paths. A supplied workspace or item ID must be authorized every time; a remembered browser selection is only UI state.


Acceptance: outsider reads/writes fail even with real UUIDs; an editor cannot act as owner; a viewer cannot spend; a delayed response cannot replace another workspace's content; password-recovery replay and sign-out failure do not present false success; owner/account mapping remains stable across workspace changes.


Implementation sources: src/server/workspaces; src/server/fns/workspaces.ts; src/lib/workspace; src/integrations/supabase; supabase/migrations


## Phase 3 - billing, AI gateway and durable accounting

Build the pure commercial catalog and entitlement resolver, then account allowances, restricted grants, holds, capture/release, replay keys, expiry and monthly windows. Keep general credits, video units and message counters separate. Add availability gates for later features. Integrate Stripe through server-created prices/checkouts and verified replay-safe events; do not let the browser set money amounts.


Add the AI task registry, provider gateway, spend controls, usage events, normalized errors, cache and rate limiting. Route call sites by task label, not arbitrary model names. Add provider-reported cost handling and safe estimate fallback. Model overrides must remain deliberate and auditable.


Acceptance: identical idempotency keys cannot charge twice; streaming cancellation releases only safely releasable funds; ambiguous capture is replayed safely; provider outages are visible; missing billing schema does not make production unlimited; fallback records the model actually used; an unknown test task fails registry coverage.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing; src/server/ai; src/lib/ai-gateway.server.ts; src/server/platform


## Phase 4 - Brain, memory and assistant

Build Brand DNA extraction/editing and current Brand Look, then competitor/market source stores, audience groups and strategy confirmation. Implement memory rules, provenance, removal markers, temporary expiry and the workspace use-memory switch. Retrieval of stored knowledge is the persistent-context mechanism; no custom foundation-model training is required by this architecture.


Add chat streaming, research and read tools. Store offered write actions server-side with explicit role recheck and single-run transition. Persist reply metadata for reload. Memory changes use the dedicated decision rules; retrieved untrusted data cannot authorize arbitrary writes.


Acceptance: an unconfirmed strategy never reaches a generator; a hallucinated competitor/source is rejected; changed memory invalidates context caches; removed memories stay removed; a read tool cannot mutate; duplicate action-button clicks run once; messages and tool data remain workspace-scoped.


Implementation sources: src/server/brain; src/server/strategy; src/server/memory; src/server/chat; src/lib/memory; src/lib/strategy


## Phase 5 - Studio, assets and editorial workflow

Build content_items and asset persistence before individual generators. Implement durable studio_jobs with leases and recovery, then social text, scripts, ads, articles, carousels, Stories and image generation. Reuse shared context and brand rules, deterministic renderers, review stages and metadata.


Add the library, calendar, versioned edits, approval statuses, conflict detection and cancel-before-edit behavior for in-flight delivery. Persist media in private R2 through canonical workspace keys, while supporting existing legacy storage identities. Canva round trips produce new versioned assets, never overwrite originals. Notion is optional manual planning exchange with preview and conflict handling.


Acceptance: successful text/image work becomes a saved draft; a partial job settles its own billing; restart recovery does not lose accepted provider tasks; asset URLs cannot cross tenants; changing kind invalidates approval; stale saves return 409; pending local edits block approval until saved; scheduled work cannot be rewritten behind the provider's back.


Implementation sources: src/server/studio; src/server/assets; src/server/fns/content.ts; src/server/connectors/canva; src/server/connectors/notion; supabase/migrations/20261018090000_content_kind_approval.sql


## Phase 6 - social, website publishing and measurement

Choose Post for Me or deliberately provision the separate SDR path. Implement account connection, current network metadata, media validation, schedule/publish/cancel, signature-verified callbacks, frame-level Story results, idempotent delivery and polling/reconciliation. Do not build the retired SocialAPI provider as a new default.


Implement website connection, source ownership and article publishing as distinct flows. GitHub changes produce reviewed PRs; CMS actions respect actual connector capabilities. Then connect GA4/GSC and social feed metrics with durable sync runs, attribution metadata and failure states.


Acceptance: unapproved content is refused; a duplicate webhook cannot regress a terminal publication; partial Story retry sends only unresolved frames with unchanged source identity; missing network metrics stay unavailable; website-source failure marks an incomplete queue; a social post does not deduct general AI credits.


Implementation sources: src/lib/postforme; src/lib/feature-flags.ts; src/server/social; src/server/articles; src/server/analytics; src/server/fns/publish.ts


## Phase 7 - video and composition

Add product extraction, concepts, notes and plan-aware model routing. Share the capability registry with validation and UI; native duration, aspect ratio, resolution, audio and references depend on the selected provider. Quote and reserve video allowance using routed cost, not a hard-coded generic price.


Persist accepted provider/model/task identity before polling. Use provider fallback only after definite compatible refusal. Add the composition table, revision leases, segmented prompts, clip safety checks and FFmpeg assembly for longer outputs. Store and settle the final asset once. Keep cancellation behavior consistent with provider acceptance and financial state.


Acceptance: long output survives an application restart; uncertain submit cannot double-spend on another provider; a plan-locked model is not selected; preview and held quote agree; accepted clips are not recreated after polling; unsupported references fail explicitly; partial/unsafe output does not become a publishable asset.


Implementation sources: src/lib/ugc; src/server/ugc; src/server/billing/ugc-async.server.ts; src/server/ugc/providers/composition.server.ts; supabase/migrations/20261021090000_video_compositions.sql


## Phase 8 - visibility, fixes and controlled experiments

Implement the public-URL-safe crawler, structured evidence, stable deterministic GEO rules, weighted scoring, finding fingerprints, monitors and verification. Add optional rendering and AI probes behind explicit gates. Keep tracked prompt observation history separate from deterministic technical site scores.


Add source ownership, proposal grounding, exact reviewed patches, PR creation and post-change checks before allowing an engineer to modify a site. Build Proof Engine only after source writes and Google page-level data are reliable. Current eligibility includes at least thirty pages, fifty-six complete pre-period days, concentration and power checks, balanced assignment, and final checkpoints from day twenty-one through forty-two. These source constants should not be weakened to obtain an attractive result.


Acceptance: all-pass applicable site reaches the expected score; N/A never deducts; score versions are not compared as ordinary deltas; blocked training crawlers alone do not count as blocked search access; provider failure is not a visibility gap; approval cannot resolve a finding; missing/incomplete experiment data remains inconclusive.


Implementation sources: src/lib/geo; src/server/geo; src/lib/experiments/constants.ts; src/lib/experiments/evaluate.ts; src/server/experiments


## Phase 9 - learning, Autopilot, agencies and assistants

Add audience outcome calibration and controlled reuse of measured content. Current calibration requires at least one hundred views, eight comparator posts, eight prediction/outcome pairs and bounded shrinkage before corrections. Pure scoring numbers remain separate from model-generated rationale.


Build Autopilot on the same Studio, content, publication and billing services. Plan slots around existing calendar work, ground picks to stored sources, obey weekly spend limits and approval mode, expire missed pieces, then measure and learn. The agency view aggregates allowed workspaces without weakening tenant boundaries.


Expose the existing operations through MCP with OAuth, per-workspace access and change gates, rate limits, cleaned outputs and append-only call history. Add staff controls with explicit permissions, MFA and audited overrides. A commercial SSO/API product remains separate future work until implemented.


Acceptance: automatic-mode policy never broadens itself; new opportunities wait for review; existing posts prevent duplicate slots; article delivery still requires approval; stopping a program blocks future work; assistant tools cannot invoke excluded administration or unapproved publication; staff support access is narrow and audited.


Implementation sources: src/lib/audience/calibration.ts; src/server/autopilot; src/lib/autopilot; src/server/mcp; src/server/admin


## End-to-end acceptance matrix

| Scenario | Required observable result | Owning layer |

| --- | --- | --- |

| Brand A user requests Brand B row | Denied before privileged provider or data operation | Route/RPC + RLS |

| Same Generate click submitted twice | One durable job and one financial settlement | Job + meter replay keys |

| Process dies after provider accepted render | Stored task can resume; no blind second submit | Provider + composition store |

| Caption save races approval | Revision conflict or serialized correct approval | Content service + database |

| Post type changes after approval | Approval invalidated | Database trigger |

| Publish callback arrives out of order | Newer terminal truth survives | Webhook/reconciler |

| Story frame fails after other frames succeeded | Only unresolved unchanged frames retried | Post for Me adapter |

| Expired media URL opened | Authorized route can issue fresh short-lived URL | Asset storage |

| GEO fix approved but not visible live | Finding remains unresolved/inconclusive | Verification engine |

| Audience content changed | Old prediction no longer shown as matching | Exact fingerprint cache |

| Experiment lacks sufficient complete days | No final positive verdict manufactured | Pure experiment evaluation |

| Plan falls to Free | Preserved content, constrained excess brands/spend | Entitlements and account lifecycle |

| Admin without required permission/MFA | Denied and refusal audited | Admin route kernel |

| MCP workspace changes disabled | Read works only where enabled; write/spend denied | MCP gate + app services |

Implementation sources: tests; src/server; supabase/migrations


## Concrete request contracts and continuation behavior

### Start an AI Visibility scan

POST /api/geo/scans
Authorization: Bearer <member access token>
Content-Type: application/json

{"workspaceId":"<UUID>","url":"https://example.com",
 "mode":"full","trigger":"manual",
 "probes":false,"idempotencyKey":"<8-100 characters>"}


Editor required. URL text is 1-2000 characters and safe-fetch validates the real destination. Mode defaults full; trigger defaults manual and allows manual/chat/rescan. Probes and idempotencyKey are optional. Full non-rescan work checks monthly scan limits. Success is 201 {scan}; an active-scan conflict is 409 with activeScanId. Full work continues in a durable scan and is polled through its ID; quick work gets a bounded inline drive.


### Studio and UGC contract ownership

POST /api/studio/jobs uses CreateJobSchema in src/lib/studio/jobs.ts, editor role and media-dependent rate limits. It returns {job}, with X-Billing-Balance when available. GET on the same route reads recent jobs for a workspace so UI can resume after reload. UGC POST /api/ugc/renders uses StartRenderBody in src/lib/ugc/schemas.ts; choices and a per-click replay key are client inputs, but price, allowance, model capability and activation remain server decisions. These richer schemas should be reused directly instead of approximating them from a static example.


Implementation sources: src/app/api/geo/scans/route.ts; src/app/api/studio/jobs/route.ts; src/lib/studio/jobs.ts; src/app/api/ugc/renders/route.ts; src/lib/ugc/schemas.ts


## Current-state corrections and decision backlog

| Older / ambiguous claim | Current blueprint treatment |

| --- | --- |

| SocialAPI as active social provider | Retired by provider selector; Post for Me configured first, optional SDR. |

| Social publication uses general credits | No general-credit charge; current monthly fair-use controls apply. |

| Brand Styles as parallel style library | Current Brain/Brand Look replaces that earlier design. |

| Video is always an eight-second single task | Current output defaults ten seconds; supports composition up to sixty. |

| Variation falls back to OpenRouter Grok | Current fallback is six-second Veo Lite. |

| Every feature waits for every post approval | Current explicit fully automatic mode can send qualifying plain/image content. |

| Scale SSO/API is implemented because of tagline | Catalog explicitly marks commercial SSO/API later. |

| Python adapter names define the main app models | Separate runtime; main task registry owns main-app defaults. |

| Amplify/Lightsail/tunnel docs prove current host | Owner confirms Railway; exact service details remain unverified. |

| Old forecasts are actual margins | Use current catalog estimates and measured invoices separately. |

| Model default is necessarily production model | Environment/admin overrides and actual returned model may differ. |

| A file or catalog entry proves production ready | Requires applied migration, credentials, flags, permissions and validation. |

Implementation sources: src/lib/feature-flags.ts; src/lib/billing/catalog.ts; src/lib/ugc/models.ts; src/lib/ugc/duration.ts; src/server/ai/task-models.ts


Recommended backlog: fill production inventory and restore policy first; verify provider readiness and remaining schema deployment; align stale canonical guides with current code; validate quote/capability boundaries; maintain generated contract/schema references in CI; only then schedule catalog later features. These are recommendations, not owner-approved launch commitments.


## Data dictionary conventions

The following is the complete 179-table Row-type dictionary extracted from the checked-in Supabase TypeScript schema. It includes field names, TypeScript scalar/union types and declared relationships. string can represent SQL text, UUID or timestamp; number can represent several SQL numeric types. Json is a schema-less TypeScript JSON value, whose business shape must be read from feature contracts and migrations. Nullability appears as | null. SQL defaults, check constraints, indexes, triggers, grants and exact RLS policies are not encoded by this Row dictionary.


Treat this as a navigation and reconstruction reference with the migration history, not runnable replacement DDL. It may include compatibility objects still represented in generated types. No table contents, customer rows or secret credential values are included. Service-only credential tables are named so their separation can be rebuilt, but must never become browser-readable just because they appear here.


Implementation sources: src/integrations/supabase/types.ts; supabase/migrations


### account_notifications

account_id: string; created_at: string; id: string; kind: string; payload: Json; read_at: string | null; user_id: string; window_key: string | null


FK account_notifications_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### admin_audit_log

action: string; actor_role: string | null; actor_user_id: string | null; after_state: Json | null; before_state: Json | null; created_at: string; error: string | null; id: string; impersonating: string | null; ip: string | null; reason: string | null; request_id: string | null; success: boolean; target_id: string | null; target_type: string | null; user_agent: string | null; workspace_id: string | null


### admin_user_notes

author_id: string; body: string; created_at: string; id: string; user_id: string


### admin_users

created_at: string; created_by: string | null; denied_permissions: string[]; disabled_at: string | null; extra_permissions: string[]; last_seen_at: string | null; note: string | null; role: string; status: string; updated_at: string; user_id: string


### admin_view_sessions

admin_user_id: string; ended_at: string | null; expires_at: string; id: string; reason: string; started_at: string; workspace_id: string


FK admin_view_sessions_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### agent_action_requests

affected_records: Json; args: Json; created_at: string; decided_at: string | null; decided_by: string | null; decision_reason: string | null; error: string | null; executed_at: string | null; expires_at: string; id: string; idempotency_key: string; preview: Json; requested_by: string | null; result: Json | null; run_id: string | null; source: string; status: string; title: string; tool: string; updated_at: string; workspace_id: string


FK agent_action_requests_run_id_fkey: (run_id) -> agent_runs (id); one-to-one false


FK agent_action_requests_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### agent_findings

affected: Json; confidence: number; created_at: string; evidence: Json; fingerprint: string; hypotheses: Json; id: string; last_seen_at: string; occurrences: number; recommended_action: string; requires_human_approval: boolean; resolved_at: string | null; resolved_by: string | null; run_id: string | null; severity: string; status: string; summary: string; title: string; updated_at: string; worker: string; workspace_id: string


FK agent_findings_run_id_fkey: (run_id) -> agent_runs (id); one-to-one false


FK agent_findings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### agent_run_steps

cost_usd: number; created_at: string; id: string; kind: string; latency_ms: number | null; policy_decision: string | null; redacted_args: Json; result_summary: Json; run_id: string; seq: number; status: string; tool: string | null; tool_call_id: string | null; workspace_id: string


FK agent_run_steps_run_id_fkey: (run_id) -> agent_runs (id); one-to-one false


FK agent_run_steps_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### agent_runs

agent: string; budget: Json; content_item_id: string | null; cost_usd: number; created_at: string; created_by: string | null; duration_ms: number | null; error: string | null; finished_at: string | null; id: string; input_tokens: number; model: string | null; output: Json | null; output_tokens: number; parent_run_id: string | null; prompt: string; started_at: string | null; status: string; summary: string | null; trigger: string; updated_at: string; worker: string | null; workspace_id: string


FK agent_runs_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK agent_runs_parent_run_id_fkey: (parent_run_id) -> agent_runs (id); one-to-one false


FK agent_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### ai_usage_daily

cached_calls: number; calls: number; cost_usd: number; day: string; error_calls: number; images: number; input_tokens: number; output_tokens: number; saved_usd: number; scope_key: string; truncated_calls: number; updated_at: string; user_id: string | null; videos: number; workspace_id: string | null


FK ai_usage_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### ai_usage_events

billing_account_id: string | null; cached: boolean; charge_id: string | null; created_at: string; est_cost_usd: number; id: number; input_tokens: number; kind: string; latency_ms: number | null; model: string; output_tokens: number; provider: string; request_id: string | null; route: string; run_id: string | null; saved_usd: number; status: string; truncated: boolean; units: number; user_id: string | null; workspace_id: string | null


FK ai_usage_events_billing_account_id_fkey: (billing_account_id) -> billing_accounts (id); one-to-one false


FK ai_usage_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### ai_usage_reservations

captured_at: string | null; captured_cost_usd: number | null; created_at: string; est_cost_usd: number; expires_at: string; id: string; kind: string; model: string; provider: string; release_reason: string | null; released_at: string | null; route: string; scope_key: string; source: string; source_id: string; state: string; units: number; user_id: string | null; workspace_id: string | null


FK ai_usage_reservations_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### allowance_usage

account_id: string; extra_pages_scanned: number; scans_used: number; window_start: string


FK allowance_usage_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### analytics_ga4_daily

bounced_sessions: number; date: string; engaged_sessions: number; key_events: number; new_users: number; screen_page_views: number; session_duration_seconds: number; sessions: number; source_id: string; synced_at: string; total_users: number; workspace_id: string


FK analytics_ga4_daily_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_ga4_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_ga4_dimension_daily

date: string; dimension: string; key_events: number; screen_page_views: number; sessions: number; source_id: string; synced_at: string; total_users: number; value: string; workspace_id: string


FK analytics_ga4_dimension_daily_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_ga4_dimension_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_ga4_period_totals

date_from: string; date_to: string; fetched_at: string; source_id: string; total_users: number; workspace_id: string


FK analytics_ga4_period_totals_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_ga4_period_totals_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_gsc_daily

clicks: number; date: string; impressions: number; position_weighted: number; source_id: string; synced_at: string; workspace_id: string


FK analytics_gsc_daily_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_gsc_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_gsc_dimension_daily

clicks: number; date: string; dimension: string; impressions: number; position_weighted: number; source_id: string; synced_at: string; value: string; workspace_id: string


FK analytics_gsc_dimension_daily_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_gsc_dimension_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_insights

created_at: string; fingerprint: string; id: string; insights: Json; model: string | null; range_key: string; signals: Json; workspace_id: string


FK analytics_insights_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_sources

account_name: string | null; backfill_completed_at: string | null; connection_id: string; created_at: string; currency: string | null; display_name: string; external_id: string; id: string; kind: string; last_error: string | null; last_synced_at: string | null; last_synced_date: string | null; selected_by: string | null; site_host: string | null; status: string; time_zone: string | null; updated_at: string; workspace_id: string


FK analytics_sources_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK analytics_sources_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### analytics_sync_runs

attempts: number; completed_at: string | null; created_at: string; cursor_date: string; cursor_step: number; error_code: string | null; error_message: string | null; failures: number; id: string; lease_until: string | null; locked_by: string | null; max_attempts: number; next_attempt_at: string; range_end: string; range_start: string; requested_by: string | null; rows_written: number; source_id: string; started_at: string | null; status: string; trigger: string; updated_at: string; workspace_id: string


FK analytics_sync_runs_source_id_fkey: (source_id) -> analytics_sources (id); one-to-one false


FK analytics_sync_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### api_rate_limits

bucket_key: string; request_count: number; updated_at: string; window_start: string


### approvals

action: string; content_item_id: string | null; created_at: string; decided_at: string | null; id: string; payload: Json; status: string; workspace_id: string


FK approvals_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK approvals_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### assets

asset_type: string; attempt: number; brand_dna_version: string | null; content_item_id: string | null; created_at: string; creative_brief_version: string | null; deleted_at: string | null; filename: string; generation_id: string; height: number | null; id: string; idempotency_key: string; metadata: Json; mime_type: string; model: string | null; model_route: string | null; parent_asset_id: string | null; platform: string | null; prompt_version: string | null; provider: string | null; public_url: string | null; qa_score: number | null; seed: string | null; status: string; storage_path: string | null; thumbnail_path: string | null; updated_at: string; width: number | null; workspace_id: string


FK assets_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK assets_parent_asset_id_fkey: (parent_asset_id) -> assets (id); one-to-one false


FK assets_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_calibration

bias: number; content_type: string; learned: Json; mae: number; n: number; platform: string; updated_at: string; workspace_id: string


FK audience_calibration_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_outcomes

actual: number | null; content_item_id: string | null; content_type: string; delivered_at: string | null; engagement: number; horizon: string; id: string; measured_at: string; metrics: Json; platform: string; predicted: number; prediction_id: string; title: string; workspace_id: string


FK audience_outcomes_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK audience_outcomes_prediction_id_fkey: (prediction_id) -> audience_predictions (id); one-to-one false


FK audience_outcomes_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_predictions

calibrated: boolean; content_item_id: string | null; content_type: string; created_at: string; created_by: string | null; depth: string; dimensions: Json; id: string; overall: number; platform: string; result: Json; run_id: string | null; score_version: number; subject: Json; subject_hash: string; twins_fingerprint: string; variant_index: number | null; workspace_id: string


FK audience_predictions_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK audience_predictions_run_id_fkey: (run_id) -> audience_runs (id); one-to-one false


FK audience_predictions_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_run_events

created_at: string; data: Json; id: string; kind: string; run_id: string; summary: string; workspace_id: string


FK audience_run_events_run_id_fkey: (run_id) -> audience_runs (id); one-to-one false


FK audience_run_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_runs

attempts: number; cancel_requested: boolean; content_item_id: string | null; created_at: string; created_by: string | null; finished_at: string | null; id: string; idempotency_key: string; input: Json; kind: string; last_error: string | null; lease_until: string | null; locked_by: string | null; next_attempt_at: string; output: Json; progress: Json; stage: string; state: Json; status: string; updated_at: string; workspace_id: string


FK audience_runs_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK audience_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audience_twins

created_at: string; created_by: string | null; id: string; kind: string; name: string; origin: string; origin_ref: string | null; profile: Json; segment: string; slug: string; status: string; summary: string; updated_at: string; updated_by: string | null; version: number; weight: number; workspace_id: string


FK audience_twins_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### audit_logs

action: string; created_at: string; entity: string | null; id: string; payload: Json; user_id: string | null; workspace_id: string


FK audit_logs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### autopilot_actions

approved_by: string | null; approved_via: string | null; attempts: number; brief: string; content_item_ids: string[]; content_type: string | null; created_at: string; credits_charged: number; cycle: number; dedupe_key: string; finished_at: string | null; generation_attempt: number; goal: string | null; id: string; kind: string; last_error: string | null; lease_until: string | null; locked_by: string | null; next_attempt_at: string; opportunity_id: string | null; planned_for: string | null; platform: string | null; program_id: string | null; reason: string; requested_by: string | null; result: Json; slot: number | null; status: string; studio_job_id: string | null; title: string; updated_at: string; workspace_id: string


FK autopilot_actions_opportunity_id_fkey: (opportunity_id) -> marketing_opportunities (id); one-to-one false


FK autopilot_actions_program_id_fkey: (program_id) -> autopilot_programs (id); one-to-one false


FK autopilot_actions_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### autopilot_events

action_id: string | null; actor: string; actor_id: string | null; created_at: string; data: Json; id: string; kind: string; opportunity_id: string | null; program_id: string | null; summary: string; workspace_id: string


FK autopilot_events_action_id_fkey: (action_id) -> autopilot_actions (id); one-to-one false


FK autopilot_events_opportunity_id_fkey: (opportunity_id) -> marketing_opportunities (id); one-to-one false


FK autopilot_events_program_id_fkey: (program_id) -> autopilot_programs (id); one-to-one false


FK autopilot_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### autopilot_programs

act_on_opportunities: boolean; acting_user_id: string | null; automations: string[]; content_types: string[]; created_at: string; created_by: string | null; credit_cap_per_week: number; cycle: number; ends_on: string; finished_at: string | null; goal: string; goal_note: string; id: string; last_notified_at: string | null; mode: string; pause_reason: string | null; platforms: string[]; posts_per_week: number; starts_on: string; status: string; stories: Json; strategy: Json; timezone: string; updated_at: string; video_cap_per_week: number; weekdays: number[]; workspace_id: string


FK autopilot_programs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### backlink_campaigns

created_at: string; created_by: string | null; goal: string; id: string; name: string; site_host: string | null; status: string; target_count: number; updated_at: string; workspace_id: string


FK backlink_campaigns_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### backlink_discovery_runs

cache_key: string; campaign_id: string | null; competitors: string[]; completed_at: string | null; cost_usd: number; created_at: string; created_by: string | null; error: string | null; expires_at: string; found: number; id: string; provider: Json; site_host: string; status: string; workspace_id: string


FK backlink_discovery_runs_campaign_id_fkey: (campaign_id) -> backlink_campaigns (id); one-to-one false


FK backlink_discovery_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### backlink_events

actor: string | null; at: string; detail: Json; id: string; opportunity_id: string; type: string; workspace_id: string


FK backlink_events_opportunity_id_fkey: (opportunity_id) -> backlink_opportunities (id); one-to-one false


FK backlink_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### backlink_opportunities

ai: Json | null; anchor_found: string | null; campaign_id: string; competitor_hits: number; created_at: string; created_by: string | null; discovery_run_id: string | null; evidence: Json; first_live_at: string | null; id: string; is_nofollow: boolean | null; kind: string; live_url: string | null; method: string | null; outreach: Json | null; rank: number | null; score: number; source_domain: string; source_title: string | null; source_url: string | null; spam_score: number | null; status: string; suggested_anchor: string | null; target_url: string | null; updated_at: string; verification: string; verified_at: string | null; workspace_id: string


FK backlink_opportunities_campaign_id_fkey: (campaign_id) -> backlink_campaigns (id); one-to-one false


FK backlink_opportunities_discovery_run_id_fkey: (discovery_run_id) -> backlink_discovery_runs (id); one-to-one false


FK backlink_opportunities_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### backlink_verifications

anchor_found: string | null; checked_at: string; checked_by: string | null; checked_url: string; error: string | null; expected_target: string; http_status: number | null; id: string; is_nofollow: boolean | null; link_found: boolean | null; opportunity_id: string; result: string; workspace_id: string


FK backlink_verifications_opportunity_id_fkey: (opportunity_id) -> backlink_opportunities (id); one-to-one false


FK backlink_verifications_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### billing_accounts

billing_interval: string | null; cancel_at: string | null; capacity_reconciled_at: string | null; comped_plan_id: string | null; comped_until: string | null; created_at: string; current_period_end: string | null; current_period_start: string | null; downgrade_at: string | null; downgrade_to: string | null; enforcement_override: string | null; entitled_plan_id: string | null; founding: boolean; grace_until: string | null; grant_anchor: string | null; id: string; last_paid_invoice_id: string | null; next_grant_at: string | null; owner_user_id: string; pause_started_at: string | null; plan_id: string; pro_overage_mode: string; provider: string; provider_customer_id: string | null; provider_subscription_id: string | null; referral_code: string | null; referred_by_account_id: string | null; resume_plan_id: string | null; status: string; trial_ends_at: string | null; trial_used: boolean; updated_at: string


FK billing_accounts_referred_by_account_id_fkey: (referred_by_account_id) -> billing_accounts (id); one-to-one false


### billing_admin_adjustments

account_id: string; actor_user_id: string; amount: number; created_at: string; grant_id: string | null; id: string; meter: string; operation: string; reason: string


FK billing_admin_adjustments_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_admin_adjustments_grant_id_fkey: (grant_id) -> meter_grants (id); one-to-one false


### billing_async_links

account_id: string; action: string; amount: number; captured: number | null; charge_id: string | null; charge_key: string; created_at: string; hold_id: string | null; kind: string; mode: string; ref_id: string; settled_at: string | null; shadow_decision: string | null; workspace_id: string | null


FK billing_async_links_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_async_links_hold_id_fkey: (hold_id) -> meter_holds (id); one-to-one true


### billing_charges

account_id: string; action: string; amount: number; created_at: string; id: string; meter: string; route: string | null; user_id: string | null; workspace_id: string | null


FK billing_charges_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_customers

created_at: string; stripe_customer_id: string; workspace_id: string


FK billing_customers_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### billing_enforcement_actions

account_id: string; actor_user_id: string; created_at: string; id: string; next_mode: string | null; previous_mode: string | null; reason: string


FK billing_enforcement_actions_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_events

account_id: string | null; error: string | null; id: string; occurred_at: string | null; payload: Json; processed_at: string | null; received_at: string; type: string


FK billing_events_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_manual_activations

account_id: string; active_until: string | null; actor_user_id: string; billing_interval: string | null; catalog_key: string; created_at: string; id: string; kind: string; months: number | null; reason: string; reference: string | null; request_id: string | null


FK billing_manual_activations_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_manual_activations_request_id_fkey: (request_id) -> billing_purchase_requests (id); one-to-one false


### billing_payment_records

account_id: string; amount_cents: number; catalog_key: string; checkout_intent_id: string | null; created_at: string; grant_ids: Json; kind: string; provider_invoice_id: string | null; provider_payment_id: string; refunded_cents: number


FK billing_payment_records_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_payment_records_checkout_intent_id_fkey: (checkout_intent_id) -> checkout_intents (id); one-to-one false


### billing_price_map

active: boolean; amount_cents: number; catalog_key: string; environment: string; interval: string; provider_price_id: string; provider_product_id: string


### billing_provider_health

credential_fingerprint: string | null; environment: string; last_event_id: string | null; updated_at: string; webhook_verified_at: string | null


### billing_purchase_requests

account_id: string; admin_note: string | null; billing_interval: string | null; catalog_key: string; contact: string | null; created_at: string; handled_at: string | null; handled_by: string | null; id: string; kind: string; note: string | null; quantity: number; requested_by: string; status: string; updated_at: string


FK billing_purchase_requests_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_shadow_events

account_id: string; action: string; amount: number | null; created_at: string; decision: string; id: number; idempotency_key: string | null; meter: string | null; reason: string | null; workspace_id: string | null


FK billing_shadow_events_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_social_profile_slots

account_id: string; expires_at: string | null; state: string; updated_at: string; workspace_id: string


FK billing_social_profile_slots_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_social_profile_slots_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### billing_studio_jobs

account_id: string; action: string; amount: number; charge_id: string | null; charge_key: string; created_at: string; hold_id: string | null; job_id: string; meter: string; mode: string; route: string; settled_at: string | null; shadow_decision: string; workspace_id: string


FK billing_studio_jobs_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_studio_jobs_hold_id_fkey: (hold_id) -> meter_holds (id); one-to-one true


FK billing_studio_jobs_job_id_fkey: (job_id) -> studio_jobs (id); one-to-one true


FK billing_studio_jobs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### billing_subscription_items

account_id: string; catalog_key: string; created_at: string; id: string; provider_item_id: string | null; provider_price_id: string | null; quantity: number; status: string; updated_at: string


FK billing_subscription_items_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### billing_suspended_members

account_id: string; original_created_at: string; original_role: Database["public"]["Enums"]["app_role"]; suspended_at: string; user_id: string; workspace_id: string


FK billing_suspended_members_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_suspended_members_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### billing_ugc_renders

account_id: string; action: string; charge_id: string | null; charge_key: string; created_at: string; hold_id: string | null; mode: string; render_id: string; settled_at: string | null; shadow_decision: string; units: number; workspace_id: string


FK billing_ugc_renders_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK billing_ugc_renders_hold_id_fkey: (hold_id) -> meter_holds (id); one-to-one true


FK billing_ugc_renders_render_id_fkey: (render_id) -> ugc_renders (id); one-to-one true


FK billing_ugc_renders_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### brand_scan_allowances

account_id: string; kind: string; normalized_domain: string; used_at: string


FK brand_scan_allowances_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### brand_visual_capture_jobs

attempts: number; created_at: string; created_by: string | null; error: string | null; id: string; idempotency_key: string; lease_token: string | null; lease_until: string | null; max_pages: number; mode: string; next_page: number; pages: Json; stage: string; status: string; updated_at: string; url: string; warnings: Json; workspace_id: string


FK brand_visual_capture_jobs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### brand_visual_feedback

created_at: string; created_by: string | null; id: string; job_id: string | null; note: string; profile_id: string | null; reason: string; source_ids: string[]; workspace_id: string


FK brand_visual_feedback_job_id_fkey: (job_id) -> studio_jobs (id); one-to-one false


FK brand_visual_feedback_profile_id_fkey: (profile_id) -> brand_visual_profiles (id); one-to-one false


FK brand_visual_feedback_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### brand_visual_profiles

capture_job_id: string | null; created_at: string; created_by: string | null; id: string; profile: Json; status: string; workspace_id: string


FK brand_visual_profiles_capture_job_id_fkey: (capture_job_id) -> brand_visual_capture_jobs (id); one-to-one true


FK brand_visual_profiles_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### brand_visual_settings

active_profile_id: string | null; updated_at: string; workspace_id: string


FK brand_visual_settings_active_profile_id_fkey: (active_profile_id) -> brand_visual_profiles (id); one-to-one false


FK brand_visual_settings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### brand_visual_sources

asset_id: string; campaign: string | null; capture_job_id: string | null; created_at: string; formats: string[]; id: string; kind: string; label: string; notes: string; purpose: string; region: Json; source_url: string | null; status: string; workspace_id: string


FK brand_visual_sources_asset_id_fkey: (asset_id) -> assets (id); one-to-one false


FK brand_visual_sources_capture_job_id_fkey: (capture_job_id) -> brand_visual_capture_jobs (id); one-to-one false


FK brand_visual_sources_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_design_mappings

asset_id: string | null; canva_asset_ids: string[]; canva_design_id: string; content_item_id: string | null; created_at: string; created_by: string | null; id: string; last_imported_at: string | null; last_opened_at: string; mode: string; source_key: string; title: string | null; workspace_id: string


FK canva_design_mappings_asset_id_fkey: (asset_id) -> assets (id); one-to-one false


FK canva_design_mappings_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK canva_design_mappings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_design_source_pages

canva_asset_id: string | null; mapping_id: string; page_number: number; source_asset_id: string | null; workspace_id: string


FK canva_design_source_pages_mapping_id_fkey: (mapping_id) -> canva_design_mappings (id); one-to-one false


FK canva_design_source_pages_source_asset_id_fkey: (source_asset_id) -> assets (id); one-to-one false


FK canva_design_source_pages_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_fallback_slide_designs

canva_design_id: string; mapping_id: string; page_number: number; workspace_id: string


FK canva_fallback_slide_designs_mapping_id_fkey: (mapping_id) -> canva_design_mappings (id); one-to-one false


FK canva_fallback_slide_designs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_import_pages

asset_id: string; page_number: number; version_id: string; workspace_id: string


FK canva_import_pages_asset_id_fkey: (asset_id) -> assets (id); one-to-one false


FK canva_import_pages_version_id_fkey: (version_id) -> canva_import_versions (id); one-to-one false


FK canva_import_pages_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_import_versions

id: string; imported_at: string; imported_by: string | null; mapping_id: string; selected_at: string | null; version_number: number; workspace_id: string


FK canva_import_versions_mapping_id_fkey: (mapping_id) -> canva_design_mappings (id); one-to-one false


FK canva_import_versions_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### canva_oauth_credentials

access_token_enc: string; access_token_expires_at: string; connection_id: string; created_at: string; refresh_token_enc: string; scopes: string[]; updated_at: string; workspace_id: string


FK canva_oauth_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK canva_oauth_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### chat_actions

args: Json; conversation_id: string | null; created_at: string; destructive: boolean; detail: string; error: string | null; id: string; offered_to: string | null; result: Json | null; run_at: string | null; run_by: string | null; status: string; title: string; tool: string; updated_at: string; workspace_id: string


FK chat_actions_conversation_id_fkey: (conversation_id) -> conversations (id); one-to-one false


FK chat_actions_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### chat_messages

content: string; conversation_id: string | null; created_at: string; id: string; kind: string; metadata: Json; payload: Json; role: string; status: string; user_id: string | null; workspace_id: string


FK chat_messages_conversation_id_fkey: (conversation_id) -> conversations (id); one-to-one false


FK chat_messages_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### checkout_intents

account_id: string; catalog_key: string; consumed_at: string | null; created_at: string; created_by: string; expires_at: string; id: string; interval: string | null; kind: string; provider_price_id: string | null; provider_session_id: string | null; quantity: number


FK checkout_intents_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### client_events

actor_email: string | null; actor_name: string | null; actor_type: string; body: string | null; client_read_at: string | null; created_at: string; id: string; item_id: string | null; kind: string; marketer_decided_at: string | null; marketer_decided_by: string | null; marketer_decision: string; marketer_read_at: string | null; meta: Json; share_id: string


FK client_events_item_id_fkey: (item_id) -> client_share_items (id); one-to-one false


FK client_events_share_id_fkey: (share_id) -> client_shares (id); one-to-one false


### client_share_items

created_at: string; description: string | null; id: string; kind: string; position: number; ref_id: string | null; share_id: string; snapshot: Json; title: string | null; visible: boolean


FK client_share_items_share_id_fkey: (share_id) -> client_shares (id); one-to-one false


### client_shares

allow_approvals: boolean; allow_comments: boolean; allow_download: boolean; branding: Json; client_email: string | null; client_name: string | null; created_at: string; expires_at: string | null; id: string; last_viewed_at: string | null; owner_id: string; password_hash: string | null; slug: string; status: string; title: string; token_ciphertext: string | null; token_hash: string; updated_at: string; view_count: number; workspace_id: string


FK client_shares_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### competitor_alerts

after_value: string | null; before_value: string | null; detail: string | null; detected_at: string; id: string; kind: string; read_at: string | null; severity: string; source_url: string | null; title: string; watch_id: string; workspace_id: string


FK competitor_alerts_watch_id_fkey: (watch_id) -> competitor_watches (id); one-to-one false


FK competitor_alerts_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### competitor_intelligence_runs

competitor_id: string | null; competitor_url: string; completed_at: string | null; created_at: string; created_by: string | null; error: string | null; id: string; pages_crawled: Json; result: Json | null; status: string; updated_at: string; workspace_id: string


FK competitor_intelligence_runs_competitor_id_fkey: (competitor_id) -> workspace_competitors (id); one-to-one false


FK competitor_intelligence_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### competitor_updates

competitor_id: string; detected_at: string; fingerprint: string; id: string; kind: string; published_at: string | null; read_at: string | null; significance: string; source_title: string | null; source_url: string | null; summary: string | null; title: string; workspace_id: string


FK competitor_updates_competitor_id_fkey: (competitor_id) -> workspace_competitors (id); one-to-one false


FK competitor_updates_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### competitor_watches

competitor_id: string | null; created_at: string; created_by: string | null; enabled: boolean; id: string; last_checked_at: string | null; last_error: string | null; last_snapshot: Json | null; name: string | null; updated_at: string; url: string; workspace_id: string


FK competitor_watches_competitor_id_fkey: (competitor_id) -> workspace_competitors (id); one-to-one false


FK competitor_watches_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### connector_install_states

consumed_at: string | null; created_at: string; expires_at: string; id: string; pkce_verifier_enc: string | null; provider: string; return_origin: string | null; return_path: string | null; state_hash: string; user_id: string; workspace_id: string


FK connector_install_states_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### content_items

agent: string; body: string | null; channel: string | null; created_at: string; created_by: string | null; hashtags: string[] | null; id: string; kind: string; media_url: string | null; meta: Json | null; metrics: Json | null; scheduled_at: string | null; status: string; title: string | null; updated_at: string; workspace_id: string


FK content_items_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### content_publications

account_id: string; attempt: number; content_item_id: string; created_at: string; delivered_at: string | null; error_category: string | null; error_code: string | null; frames: Json | null; id: string; last_error: string | null; metrics: Json | null; metrics_synced_at: string | null; placement: string; platform: string; platform_post_id: string | null; platform_post_url: string | null; provider: string; sdr_post_id: string; sdr_target_id: string; status: string; updated_at: string; workspace_id: string


FK content_publications_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK content_publications_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### conversations

archived_at: string | null; created_at: string; created_by: string | null; id: string; is_pinned: boolean; metadata: Json; preview: string | null; summary: string; title: string; updated_at: string; workspace_id: string


FK conversations_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### cron_heartbeats

expected_interval_seconds: number; failure_count: number; job: string; last_duration_ms: number | null; last_error: string | null; last_failed_at: string | null; last_result: Json | null; last_started_at: string | null; last_succeeded_at: string | null; run_count: number; updated_at: string


### entitlement_overrides

account_id: string; allowed: boolean | null; created_at: string; created_by: string; expires_at: string | null; id: string; key: string; kind: string; limit_value: number | null; reason: string; revoke_reason: string | null; revoked_at: string | null; revoked_by: string | null; starts_at: string; workspace_id: string | null


FK entitlement_overrides_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


FK entitlement_overrides_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_assignments

active: boolean; arm: string; baseline: Json; created_at: string; excluded_at: string | null; excluded_reason: string | null; experiment_id: string; id: string; page_url: string; path: string; site_host: string; stratum: number; workspace_id: string


FK experiment_assignments_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_assignments_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_changes

after: string; before: string | null; created_at: string; experiment_id: string; field: string; grounding: Json; id: string; path: string; workspace_id: string


FK experiment_changes_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_changes_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_deliveries

agent_run_id: string | null; approved_at: string | null; approved_by: string | null; base_branch: string | null; base_sha: string | null; commit_sha: string | null; content_hash: string | null; created_at: string; created_by: string | null; error: string | null; experiment_id: string | null; fields: string[]; files: Json; head_branch: string | null; id: string; kind: string; live_at: string | null; merged_at: string | null; pr_number: number | null; pr_state: string | null; pr_url: string | null; source_id: string | null; status: string; template_files: string[]; updated_at: string; validation: Json; workspace_id: string


FK experiment_deliveries_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_deliveries_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK experiment_deliveries_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_events

actor_id: string | null; created_at: string; data: Json; experiment_id: string; id: string; kind: string; summary: string; workspace_id: string


FK experiment_events_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_jobs

attempts: number; created_at: string; experiment_id: string; finished_at: string | null; id: string; kind: string; last_error: string | null; lease_until: string | null; locked_by: string | null; max_attempts: number; next_attempt_at: string; payload: Json; status: string; updated_at: string; workspace_id: string


FK experiment_jobs_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_jobs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_metric_days

complete: boolean; date: string; experiment_id: string; pulled_at: string; source: string; workspace_id: string


FK experiment_metric_days_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_metric_days_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_metrics_daily

ai_referral_sessions: number; arm: string; clicks: number; date: string; experiment_id: string; impressions: number; key_events: number; path: string; position_weighted: number; revenue: number; sessions: number; updated_at: string; workspace_id: string


FK experiment_metrics_daily_experiment_id_fkey: (experiment_id) -> experiments (id); one-to-one false


FK experiment_metrics_daily_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiment_page_groups

created_at: string; detected_at: string; eligibility: Json; id: string; label: string; monthly_clicks: number; page_count: number; paths: string[]; pattern: string; rule: Json; source_id: string; template_file: string | null; updated_at: string; workspace_id: string


FK experiment_page_groups_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK experiment_page_groups_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### experiments

approved_at: string | null; approved_by: string | null; approved_patch_hash: string | null; assignment_attempts: number | null; assignment_seed: number | null; cancelled_at: string | null; change_type: string; closed_at: string | null; closed_via: string | null; concluded_at: string | null; created_at: string; created_by: string | null; estimated_monthly_units: number | null; estimated_monthly_value: number | null; ga4_source_id: string | null; gsc_source_id: string | null; hypothesis: string; id: string; invalid_reason: string | null; invalidated_at: string | null; last_checkpoint_day: number | null; lift: number | null; lift_high: number | null; lift_low: number | null; live_confirmed_at: string | null; mde_estimate: number | null; name: string; page_group_id: string | null; planned_max_days: number; planned_min_days: number; pre_period_end: string | null; pre_period_start: string | null; primary_metric: string; result: Json; revenue_basis: Json; secondary_metrics: string[]; shipped_at: string | null; site_host: string; source_id: string | null; status: string; updated_at: string; value_currency: string | null; verdict: string | null; workspace_id: string


FK experiments_ga4_source_id_fkey: (ga4_source_id) -> analytics_sources (id); one-to-one false


FK experiments_gsc_source_id_fkey: (gsc_source_id) -> analytics_sources (id); one-to-one false


FK experiments_page_group_id_fkey: (page_group_id) -> experiment_page_groups (id); one-to-one false


FK experiments_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK experiments_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_agent_events

actor: string; at: string; detail: Json; id: number; kind: string; run_id: string; stage: string | null; summary: string; user_id: string | null; workspace_id: string


FK geo_agent_events_run_id_fkey: (run_id) -> geo_agent_runs (id); one-to-one false


FK geo_agent_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_agent_runs

attempts: number; base_branch: string | null; base_sha: string | null; batch_id: string | null; cancel_requested_at: string | null; checkpoint: Json | null; completed_at: string | null; connection_id: string | null; correction_rounds: number; created_at: string; created_by: string | null; error: string | null; error_code: string | null; failed_at_step: string | null; feedback: string | null; files_inspected: Json; finding_id: string | null; fingerprint: string; framework: string | null; id: string; inputs: Json; kind: string; lease_until: string | null; locked_by: string | null; max_attempts: number; model: string | null; next_attempt_at: string; page_url: string | null; parent_run_id: string | null; patch: Json | null; plan: Json | null; plan_approved_at: string | null; plan_approved_by: string | null; plan_hash: string | null; plan_ready_at: string | null; plan_revision: number; proposal_id: string | null; provider: string; repo_external_id: string | null; repo_full_name: string | null; result: Json | null; review: Json | null; rule_id: string; scan_id: string | null; site_host: string; site_origin: string; site_ref: Json | null; source_id: string | null; status: string; status_detail: string | null; updated_at: string; usage: Json; validation: Json | null; verification_id: string | null; workspace_id: string


FK geo_agent_runs_batch_id_fkey: (batch_id) -> geo_fix_batches (id); one-to-one false


FK geo_agent_runs_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK geo_agent_runs_finding_id_fkey: (finding_id) -> geo_findings (id); one-to-one false


FK geo_agent_runs_parent_run_id_fkey: (parent_run_id) -> geo_agent_runs (id); one-to-one false


FK geo_agent_runs_proposal_id_fkey: (proposal_id) -> geo_fix_proposals (id); one-to-one false


FK geo_agent_runs_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_agent_runs_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK geo_agent_runs_verification_id_fkey: (verification_id) -> geo_verifications (id); one-to-one false


FK geo_agent_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_audit_runs

created_at: string; created_by: string | null; id: string; meta: Json; score: number; subscores: Json; url: string | null; workspace_id: string


FK geo_audit_runs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_finding_states

dismiss_reason: string | null; fingerprint: string; note: string | null; reopened_at: string | null; resolved_via: string | null; reviewed_at: string | null; reviewed_by: string | null; state: string; updated_at: string; updated_by: string | null; verification_id: string | null; verified_at: string | null; workspace_id: string


FK geo_finding_states_verification_id_fkey: (verification_id) -> geo_verifications (id); one-to-one false


FK geo_finding_states_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_findings

category: string; created_at: string; detail: string; effort: string; evidence: Json; fingerprint: string; fix_id: string | null; id: string; page_id: string | null; page_url: string | null; point_impact: number; priority: string; priority_score: number; rule_id: string; safety: string; scan_id: string; severity: string; status: string; title: string; workspace_id: string


FK geo_findings_page_id_fkey: (page_id) -> geo_scan_pages (id); one-to-one false


FK geo_findings_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_findings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_fix_batches

approved_at: string | null; approved_by: string | null; base_branch: string | null; base_sha: string | null; checks: Json | null; cms_changes: Json | null; cms_snapshot: Json | null; commit_sha: string | null; connection_id: string | null; content_hash: string | null; created_at: string; created_by: string | null; error: string | null; explanation: string | null; files: Json; files_purged_at: string | null; framework: string | null; head_branch: string | null; host: string; id: string; items: Json; last_synced_at: string | null; pr_merged_at: string | null; pr_number: number | null; pr_state: string | null; pr_url: string | null; progress: Json; provider: string; repo_external_id: string | null; repo_full_name: string | null; scan_id: string | null; site_origin: string; source_id: string | null; status: string; updated_at: string; validation: Json; workspace_id: string


FK geo_fix_batches_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK geo_fix_batches_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_fix_batches_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK geo_fix_batches_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_fix_proposals

agent_run_id: string | null; applied_at: string | null; approved_at: string | null; approved_by: string | null; base_branch: string | null; base_sha: string | null; batch_id: string | null; checks: Json | null; cms_changes: Json | null; cms_snapshot: Json | null; commit_sha: string | null; connection_id: string | null; content_hash: string | null; created_at: string; created_by: string | null; error: string | null; explanation: string | null; files: Json; files_purged_at: string | null; finding_id: string | null; fingerprint: string; fix_id: string; framework: string | null; head_branch: string | null; id: string; last_synced_at: string | null; model: string | null; page_url: string | null; pr_merged_at: string | null; pr_number: number | null; pr_state: string | null; pr_url: string | null; preview: Json | null; provider: string; repo_external_id: string | null; repo_full_name: string | null; rolled_back_at: string | null; rolled_back_by: string | null; rule_id: string; scan_id: string | null; site_origin: string; site_ref: Json | null; source_id: string | null; status: string; strategy: string | null; updated_at: string; validation: Json; workspace_id: string


FK geo_fix_proposals_agent_run_id_fkey: (agent_run_id) -> geo_agent_runs (id); one-to-one false


FK geo_fix_proposals_batch_id_fkey: (batch_id) -> geo_fix_batches (id); one-to-one false


FK geo_fix_proposals_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK geo_fix_proposals_finding_id_fkey: (finding_id) -> geo_findings (id); one-to-one false


FK geo_fix_proposals_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_fix_proposals_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK geo_fix_proposals_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_prompt_checks

answer_excerpt: string | null; checked_at: string; cited: boolean; cited_urls: Json; competitors_mentioned: Json; engine: string; error: string | null; id: number; mentioned: boolean; model: string; position: number | null; prompt_id: string; web_search: boolean; workspace_id: string


FK geo_prompt_checks_prompt_id_fkey: (prompt_id) -> geo_tracked_prompts (id); one-to-one false


FK geo_prompt_checks_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_scan_pages

analysis: Json | null; category_scores: Json; content_type: string | null; created_at: string; depth: number; fetch_ms: number | null; fetched_at: string | null; final_url: string | null; id: string; issues: number; scan_id: string; score: number | null; skip_reason: string | null; state: string; status_code: number | null; url: string; workspace_id: string; x_robots_tag: string | null


FK geo_scan_pages_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_scan_pages_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_scans

attempt_count: number; cancel_requested: boolean; category_scores: Json; completed_at: string | null; config: Json; created_at: string; created_by: string | null; error: string | null; host: string; id: string; idempotency_key: string | null; lease_until: string | null; locked_by: string | null; mode: string; origin: string; overall_score: number | null; previous_scan_id: string | null; probes: Json | null; progress: Json; report: Json | null; scheduled_job_id: string | null; site: Json; stage: string; started_at: string | null; status: string; trigger: string; updated_at: string; url: string; workspace_id: string


FK geo_scans_previous_scan_id_fkey: (previous_scan_id) -> geo_scans (id); one-to-one false


FK geo_scans_scheduled_job_id_fkey: (scheduled_job_id) -> scheduled_jobs (id); one-to-one false


FK geo_scans_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_tracked_prompts

created_at: string; created_by: string | null; id: string; last_checked_at: string | null; lease_until: string | null; next_check_at: string; paused_at: string | null; text: string; workspace_id: string


FK geo_tracked_prompts_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### geo_verifications

after: Json; attempts: number; baseline_scan_id: string | null; batch_id: string | null; before: Json; completed_at: string | null; created_at: string; created_by: string | null; fingerprints: string[]; id: string; lease_until: string | null; locked_by: string | null; max_attempts: number; next_attempt_at: string; origin: string; outcome_detail: string | null; proposal_id: string | null; rule_ids: string[]; scan_id: string | null; status: string; updated_at: string; urls: string[]; workspace_id: string


FK geo_verifications_baseline_scan_id_fkey: (baseline_scan_id) -> geo_scans (id); one-to-one false


FK geo_verifications_batch_id_fkey: (batch_id) -> geo_fix_batches (id); one-to-one false


FK geo_verifications_proposal_id_fkey: (proposal_id) -> geo_fix_proposals (id); one-to-one false


FK geo_verifications_scan_id_fkey: (scan_id) -> geo_scans (id); one-to-one false


FK geo_verifications_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### google_oauth_credentials

access_token_enc: string | null; access_token_expires_at: string | null; connection_id: string; created_at: string; email: string | null; google_sub: string | null; refresh_token_enc: string; scopes: string[]; updated_at: string; workspace_id: string


FK google_oauth_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK google_oauth_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### guardrail_events

created_at: string; detail: Json; id: number; kind: string; request_id: string | null; route: string; run_id: string | null; severity: string; user_id: string | null; workspace_id: string | null


FK guardrail_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### link_order_events

actor: string | null; at: string; detail: Json; id: string; line_id: string | null; order_id: string; type: string; workspace_id: string


FK link_order_events_line_id_fkey: (line_id) -> link_order_lines (id); one-to-one false


FK link_order_events_order_id_fkey: (order_id) -> link_orders (id); one-to-one false


FK link_order_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### link_order_lines

attribution: string; attribution_detail: Json; consecutive_missing: number; created_at: string; credits_price: number; donor_domain: string; donor_id: number; first_live_at: string | null; give_up_at: string | null; id: string; lost_at: string | null; next_check_at: string | null; opportunity_id: string | null; order_id: string; provider_basket_id: number | null; provider_cost_usd: number | null; provider_link_id: number | null; provider_order_content_id: number | null; published_at: string | null; published_url: string | null; settled: string; status: string; unit_price_usd: number; updated_at: string; verification: string; verified_at: string | null; workspace_id: string


FK link_order_lines_donor_id_fkey: (donor_id) -> rixot_donors (id); one-to-one false


FK link_order_lines_opportunity_id_fkey: (opportunity_id) -> backlink_opportunities (id); one-to-one false


FK link_order_lines_order_id_fkey: (order_id) -> link_orders (id); one-to-one false


FK link_order_lines_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### link_orders

attempt_count: number; balance_before_usd: number | null; campaign_id: string | null; charged_is_estimated: boolean; checkout_at: string | null; content_mode: string; created_at: string; created_by: string | null; credit_rate: number; credits_captured: number; credits_held: number; credits_refunded: number; failure_code: string | null; id: string; idempotency_key: string; in_flight_since: string | null; keyword: string; language: string; last_error: string | null; lease_until: string | null; line_count: number; lock_token: string | null; locked_by: string | null; needs_operator: boolean; next_attempt_at: string | null; operator_note: string | null; order_post_attempts: number; ordered_at: string | null; own_content: string | null; own_title: string | null; paid_at: string | null; pay_post_attempts: number; provider_basket_ids: number[]; provider_charged_usd: number | null; provider_order_content_ids: number[]; provider_total_usd: number | null; quoted_usd: number; recommendations: string | null; request_fingerprint: string | null; settled_at: string | null; status: string; substate: string | null; target_url: string; updated_at: string; workspace_id: string


FK link_orders_campaign_id_fkey: (campaign_id) -> backlink_campaigns (id); one-to-one false


FK link_orders_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### market_intelligence_cache

analysis_key: string; analysis_type: string; collection_id: string; context_fingerprint: string; created_at: string; id: string; result: Json; updated_at: string; workspace_id: string


FK market_intelligence_cache_collection_id_fkey: (collection_id) -> market_trend_collections (id); one-to-one false


FK market_intelligence_cache_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### market_trend_collections

completed_at: string | null; id: string; keywords: string[]; location: string | null; normalized_result: Json | null; provider: string; provider_error: Json | null; request_key: string; requested_at: string; status: string; updated_at: string; workspace_id: string


FK market_trend_collections_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### marketing_opportunities

created_at: string; decided_at: string | null; decided_by: string | null; evidence: Json; expires_at: string; fingerprint: string; id: string; kind: string; score: number; score_parts: Json; source_id: string | null; source_kind: string; status: string; suggested_action: string; suggested_platforms: string[]; suggested_type: string; summary: string; title: string; updated_at: string; why_relevant: string; workspace_id: string


FK marketing_opportunities_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### mcp_tool_calls

client_id: string | null; created_at: string; duration_ms: number; error_code: string | null; id: string; is_write: boolean; ok: boolean; summary: Json; tool: string; user_id: string | null; workspace_id: string | null


FK mcp_tool_calls_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### mcp_workspace_settings

allow_writes: boolean; enabled: boolean; updated_at: string; updated_by: string | null; workspace_id: string


FK mcp_workspace_settings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### memory_insights

body: string; created_at: string; created_by: string | null; id: string; kind: string; meta: Json; source_label: string | null; updated_at: string; workspace_id: string


FK memory_insights_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### meter_balances

account_id: string; available: number; available_any: number; debt: number; held: number; meter: string; updated_at: string


FK meter_balances_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### meter_grants

account_id: string; amount: number; clawed_back: number; created_at: string; expires_at: string | null; id: string; idempotency_key: string; meter: string; period_start: string | null; provider_ref: string | null; remaining: number; restriction: string; source: string; workspace_id: string | null


FK meter_grants_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### meter_holds

account_id: string; action: string; allocations: Json; amount: number; captured_amount: number; created_at: string; expires_at: string; finalized_at: string | null; id: string; idempotency_key: string; meter: string; state: string; user_id: string | null; workspace_id: string | null


FK meter_holds_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### meter_ledger

account_id: string; action: string | null; actor: string | null; available_after: number; charge_id: string | null; created_at: string; delta_available: number; delta_held: number; grant_id: string | null; held_after: number; hold_id: string | null; id: number; idempotency_key: string; kind: string; meter: string; reason: string | null; user_id: string | null; workspace_id: string | null


FK meter_ledger_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### model_route_overrides

effort: string | null; models: string[] | null; reason: string | null; route_key: string; updated_at: string; updated_by: string | null


### notion_content_mappings

content_item_id: string; created_at: string; id: string; last_mellox_hash: string | null; last_mellox_updated_at: string | null; last_notion_edited_at: string | null; last_notion_hash: string | null; last_sync_direction: string | null; last_sync_hash: string | null; notion_data_source_id: string; notion_page_id: string; updated_at: string; workspace_id: string


FK notion_content_mappings_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK notion_content_mappings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### notion_oauth_credentials

access_token_enc: string; bot_id: string | null; connection_id: string; created_at: string; last_sync_at: string | null; selected_data_source_id: string | null; selected_database_id: string | null; selected_destination_name: string | null; selected_destination_url: string | null; selected_parent_page_id: string | null; sync_lock_owner: string | null; sync_lock_until: string | null; updated_at: string; workspace_id: string


FK notion_oauth_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK notion_oauth_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### platform_announcements

active: boolean; body: string; created_at: string; created_by: string | null; dismissible: boolean; ends_at: string | null; id: string; link_url: string | null; starts_at: string; title: string; tone: string; updated_at: string


### platform_flags

created_at: string; description: string; enabled: boolean; expires_at: string | null; key: string; rollout_percent: number; updated_at: string; updated_by: string | null; workspace_ids: string[]


### platform_switches

changed_at: string; changed_by: string | null; engaged: boolean; key: string; reason: string | null


### profiles

app_tour_seen_at: string | null; avatar_url: string | null; created_at: string; id: string; name: string | null; persona: string | null; persona_set_at: string | null


### provider_basket_lock

acquired_at: string | null; holder: string | null; lease_until: string | null; order_id: string | null; phase: string | null; provider: string; quarantine_reason: string | null; quarantined: boolean; quarantined_at: string | null; released_at: string | null; renewed_at: string | null; takeover_count: number; token: string | null


FK provider_basket_lock_order_id_fkey: (order_id) -> link_orders (id); one-to-one false


### referrals

created_at: string; id: string; referred_account_id: string; referrer_account_id: string; rewarded_at: string | null; status: string


FK referrals_referred_account_id_fkey: (referred_account_id) -> billing_accounts (id); one-to-one true


FK referrals_referrer_account_id_fkey: (referrer_account_id) -> billing_accounts (id); one-to-one false


### rixot_donors

backlinks: number | null; cat: string | null; delisted_at: string | null; dfs_rank: number | null; domain: string; domain_hidden: boolean; dr: number | null; ext: string | null; first_seen_at: string; id: number; last_seen_at: string; page: string | null; price_usd: number; referring_domains: number | null; top100: number | null; topic: Json | null; topic_checked_at: string | null


### rixot_link_sightings

claim_method: string | null; claimed_at: string | null; claimed_by: string | null; cost_usd: number | null; first_seen_at: string; keyword: string | null; last_seen_at: string; link_id: number; published_host: string | null; published_url: string | null; raw: Json; status: string | null; target_url: string | null; unclaimed_reason: string | null


FK rixot_link_sightings_claimed_by_fkey: (claimed_by) -> link_order_lines (id); one-to-one false


### scheduled_jobs

active: boolean; agent: string; cadence: string; channel: string | null; created_at: string; created_by: string | null; id: string; last_content_item_id: string | null; last_run_at: string | null; last_run_error: string | null; last_run_status: string | null; locked_at: string | null; locked_by: string | null; meta: Json; next_run_at: string; prompt: string | null; run_count: number; task_type: string; timezone: string; title: string; updated_at: string; workspace_id: string


FK scheduled_jobs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### sdr_webhook_events

account_id: string | null; delivery_id: string | null; event: string | null; id: number; outcome: string; provider: string; reason: string; received_at: string; sdr_post_id: string | null; sdr_target_id: string | null; workspace_id: string | null


FK sdr_webhook_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### site_blog_settings

blog_url: string | null; content_dir: string | null; created_at: string; detected_at: string | null; frontmatter: Json | null; host: string; id: string; post_format: string | null; provider: string; route_prefix: string | null; setup: Json | null; setup_run_id: string | null; source_id: string | null; status: string; status_detail: string | null; updated_at: string; webflow_collection_id: string | null; webflow_field_map: Json | null; workspace_id: string; wp_category_id: number | null; wp_posts_page_id: number | null


FK site_blog_settings_setup_run_id_fkey: (setup_run_id) -> geo_agent_runs (id); one-to-one false


FK site_blog_settings_source_id_fkey: (source_id) -> workspace_sources (id); one-to-one false


FK site_blog_settings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### site_publications

approved_by: string | null; attempts: number; content_item_id: string; created_at: string; external_id: string | null; head_branch: string | null; host: string; id: string; last_error: string | null; lease_until: string | null; locked_by: string | null; max_attempts: number; next_attempt_at: string; payload_hash: string | null; pr_number: number | null; pr_url: string | null; provider: string; published_at: string | null; scheduled_for: string | null; slug: string; status: string; status_detail: string | null; title: string; updated_at: string; url: string | null; verification: Json | null; verified_at: string | null; workspace_id: string


FK site_publications_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK site_publications_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### slack_action_refs

action: string; consumed_at: string | null; content_item_id: string | null; context: Json; created_at: string; expires_at: string; id: string; installation_id: string; workspace_id: string


FK slack_action_refs_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK slack_action_refs_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


FK slack_action_refs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### slack_channel_mappings

channel_id: string; channel_name: string; created_at: string; id: string; installation_id: string; purpose: string; team_id: string; workspace_id: string


FK slack_channel_mappings_installation_id_team_id_fkey: (installation_id, team_id) -> slack_installations (id, team_id); one-to-one false


FK slack_channel_mappings_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### slack_inbox

attempts: number; completed_at: string | null; created_at: string; delivery_key: string; id: string; installation_id: string; kind: string; last_error: string | null; lease_until: string | null; next_attempt_at: string; payload: Json; status: string; workspace_id: string


FK slack_inbox_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### slack_installations

bot_token_enc: string; bot_user_id: string; connected_by: string | null; created_at: string; id: string; last_error: string | null; last_event_at: string | null; last_outbound_at: string | null; status: string; team_id: string; team_name: string; updated_at: string; workspace_id: string


FK slack_installations_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### slack_link_codes

code_hash: string; consumed_at: string | null; expires_at: string; id: string; installation_id: string; mellox_user_id: string; workspace_id: string


FK slack_link_codes_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### slack_outbound

attempts: number; channel_id: string; created_at: string; dedupe_key: string; id: string; installation_id: string; last_error: string | null; lease_until: string | null; next_attempt_at: string; payload: Json; sent_at: string | null; slack_ts: string | null; status: string; workspace_id: string


FK slack_outbound_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### slack_preferences

approvals: boolean; brief_hour: number; brief_timezone: string; competitor_alerts: boolean; daily_brief: boolean; geo_alerts: boolean; market_alerts: boolean; performance_alerts: boolean; publishing_failures: boolean; updated_at: string; workspace_id: string


FK slack_preferences_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### slack_threads

channel_id: string; installation_id: string; messages: Json; thread_ts: string; updated_at: string; workspace_id: string


FK slack_threads_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### slack_user_links

id: string; installation_id: string; linked_at: string; mellox_user_id: string; slack_user_id: string; workspace_id: string


FK slack_user_links_installation_id_workspace_id_fkey: (installation_id, workspace_id) -> slack_installations (id, workspace_id); one-to-one false


### social_accounts

avatar_url: string | null; brand_id: string | null; connected_at: string; connected_by: string | null; created_at: string; disconnected_at: string | null; display_name: string | null; id: string; last_synced_at: string; platform: string; provider: string; provider_account_id: string; reconnect_reason: string | null; status: string; updated_at: string; username: string | null; workspace_id: string


FK social_accounts_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### social_oauth_states

connection_id: string | null; consumed_at: string | null; created_at: string; expires_at: string; id: string; platform: string; provider: string; state_hash: string; user_id: string; workspace_id: string


FK social_oauth_states_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### social_trend_snapshots

claimed_at: string | null; collected_at: string | null; error: string | null; scope: string; sources: Json; status: string; trends: Json; updated_at: string


### social_usage_events

content_item_id: string | null; created_at: string; id: number; operation: string; provider: string; provider_post_id: string | null; targets: number; user_id: string | null; workspace_id: string


FK social_usage_events_content_item_id_fkey: (content_item_id) -> content_items (id); one-to-one false


FK social_usage_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### spend_caps

daily_usd: number | null; id: string; monthly_usd: number | null; reason: string | null; scope: string; updated_at: string; updated_by: string | null; workspace_id: string | null


FK spend_caps_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### stripe_events

error: string | null; id: string; payload: Json; processed_at: string | null; received_at: string; type: string; workspace_id: string | null


FK stripe_events_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### studio_jobs

asset_ids: string[]; attempt: number; completed_at: string | null; content_item_ids: string[]; created_at: string; created_by: string | null; error: Json | null; group_id: string; id: string; idempotency_key: string; input: Json; lease_until: string | null; output: Json; parent_job_id: string | null; provider_tasks: Json; stage: string; stage_at: string; status: string; title: string | null; type: string; updated_at: string; workspace_id: string


FK studio_jobs_parent_job_id_fkey: (parent_job_id) -> studio_jobs (id); one-to-one false


FK studio_jobs_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### ugc_projects

brand_snapshot: Json; brief: Json; concepts: Json; created_at: string; created_by: string | null; id: string; product: Json; product_url: string | null; reference_asset_ids: string[]; script: Json | null; selected_concept_id: string | null; status: string; title: string; updated_at: string; workspace_id: string


FK ugc_projects_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### ugc_renders

actual_cost_usd: number | null; aspect_ratio: string; asset_id: string | null; attempts: number; audio: boolean; billing_ready: boolean; completed_at: string | null; created_at: string; created_by: string | null; duration_sec: number; error_code: string | null; error_message: string | null; est_cost_usd: number; generation_type: string; id: string; idempotency_key: string; lease_until: string | null; locked_by: string | null; max_attempts: number; model_key: string; next_attempt_at: string; project_id: string; prompt: string; provider: string; provider_meta: Json; provider_model: string; provider_state: string | null; provider_task_id: string | null; provider_variant: string | null; reference_asset_ids: string[]; reservation_id: string | null; resolution: string; script: Json; settings: Json; status: string; submit_attempts: number; submitted_at: string | null; updated_at: string; workspace_id: string


FK ugc_renders_asset_id_fkey: (asset_id) -> assets (id); one-to-one false


FK ugc_renders_project_id_fkey: (project_id) -> ugc_projects (id); one-to-one false


FK ugc_renders_reservation_id_fkey: (reservation_id) -> ai_usage_reservations (id); one-to-one false


FK ugc_renders_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### upgrade_requests

account_id: string; created_at: string; feature: string; id: string; message: string | null; requested_by: string; required_plan: string | null; status: string; updated_at: string; workspace_id: string


FK upgrade_requests_account_id_fkey: (account_id) -> billing_accounts (id); one-to-one false


### webflow_oauth_credentials

access_token_enc: string; access_token_expires_at: string | null; connection_id: string; created_at: string; refresh_token_enc: string | null; scopes: string[]; updated_at: string; webflow_user_email: string | null; webflow_user_id: string | null; workspace_id: string


FK webflow_oauth_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK webflow_oauth_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### webflow_sites

connection_id: string; created_at: string; domain: string | null; domains: string[]; id: string; last_error: string | null; last_synced_at: string | null; preview_url: string | null; selected: boolean; short_name: string | null; site_id: string; site_name: string; status: string; updated_at: string; workspace_id: string


FK webflow_sites_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK webflow_sites_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### wordpress_credentials

api_namespaces: string[]; application_password_enc: string; connection_id: string; created_at: string; site_description: string | null; site_home: string | null; site_name: string | null; site_url: string; updated_at: string; username: string; workspace_id: string


FK wordpress_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK wordpress_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### wordpress_oauth_credentials

access_token_enc: string; access_token_expires_at: string | null; connection_id: string; created_at: string; refresh_token_enc: string | null; scopes: string[]; updated_at: string; wordpress_user_id: string | null; wordpress_user_login: string | null; workspace_id: string


FK wordpress_oauth_credentials_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one true


FK wordpress_oauth_credentials_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### wordpress_sites

api_namespaces: string[]; connection_id: string; created_at: string; id: string; last_error: string | null; last_synced_at: string | null; plugin_checked_at: string | null; selected: boolean; site_name: string; site_url: string; status: string; updated_at: string; wordpress_site_id: string | null; workspace_id: string


FK wordpress_sites_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK wordpress_sites_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_access_state

changed_at: string; changed_by: string | null; mode: string; reason: string | null; workspace_id: string


FK workspace_access_state_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_agent_settings

agents_paused: boolean; disabled_workers: string[]; updated_at: string; updated_by: string | null; workspace_id: string


FK workspace_agent_settings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_brand_dna

created_at: string; dna: Json; updated_at: string; updated_by: string | null; version: number; workspace_id: string


FK workspace_brand_dna_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_competitors

attempt_count: number; confidence: number; created_at: string; created_by: string | null; discovery_sources: Json; domain: string; id: string; lease_until: string | null; locked_by: string | null; name: string; next_check_at: string | null; profile: Json | null; profile_error: string | null; profile_status: string; profile_updated_at: string | null; rationale: string | null; relationship: string; source: string; status: string; updated_at: string; updates_checked_at: string | null; url: string | null; workspace_id: string


FK workspace_competitors_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_connections

account_avatar_url: string | null; account_login: string; account_type: string | null; connected_by: string | null; created_at: string; external_account_id: string; id: string; last_error: string | null; last_verified_at: string | null; manage_url: string | null; metadata: Json; permissions: Json; provider: string; repository_selection: string | null; revoked_at: string | null; revoked_reason: string | null; status: string; updated_at: string; verification: string; workspace_id: string


FK workspace_connections_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_create_requests

created_at: string; idempotency_key: string; user_id: string; workspace_id: string | null


FK workspace_create_requests_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_credit_balances

available: number; held: number; lifetime_spent: number; lifetime_topped_up: number; updated_at: string; workspace_id: string


FK workspace_credit_balances_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_credit_ledger

actor: string | null; balance_after: number; created_at: string; delta_available: number; delta_held: number; held_after: number; id: number; idempotency_key: string; kind: string; line_id: string | null; order_id: string | null; reason: string | null; workspace_id: string


FK workspace_credit_ledger_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_deletions

created_at: string; deleted_by: string | null; domain: string | null; id: string; owner_id: string | null; storage_objects_removed: number; workspace_id: string; workspace_name: string | null


### workspace_invites

accepted_at: string | null; created_at: string; email: string; id: string; invited_by: string; role: string; token: string; workspace_id: string


FK workspace_invites_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_marketing_strategy

built_from: Json; confirmed_at: string | null; confirmed_by: string | null; created_at: string; generated_at: string | null; generations: number; source_fingerprint: string | null; status: string; strategy: Json; updated_at: string; updated_by: string | null; version: number; workspace_id: string


FK workspace_marketing_strategy_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_members

created_at: string; id: string; role: Database["public"]["Enums"]["app_role"]; user_id: string; workspace_id: string


FK workspace_members_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_memories

body: string; conversation_id: string | null; created_at: string; created_by: string | null; expires_at: string | null; fingerprint: string; id: string; kind: string; source: string; status: string; topic: string; updated_at: string; updated_by: string | null; workspace_id: string


FK workspace_memories_conversation_id_fkey: (conversation_id) -> conversations (id); one-to-one false


FK workspace_memories_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspace_memory_settings

created_at: string; enabled: boolean; updated_at: string; updated_by: string | null; workspace_id: string


FK workspace_memory_settings_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_report_branding

created_at: string; display_name: string | null; logo_path: string | null; updated_at: string; updated_by: string | null; workspace_id: string


FK workspace_report_branding_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_sdr

created_at: string; encrypted_api_key: string; id: string; last_provisioned_at: string | null; sdr_base_url: string; sdr_workspace_id: string; status: string; updated_at: string; webhook_secret: string | null; workspace_id: string


FK workspace_sdr_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_socialapi

brand_id: string | null; created_at: string; id: string; last_error: string | null; status: string; updated_at: string; workspace_id: string


FK workspace_socialapi_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one true


### workspace_sources

agent_consent_at: string | null; agent_consent_by: string | null; branch: string | null; connection_id: string; created_at: string; default_branch: string | null; external_id: string; full_name: string; html_url: string | null; id: string; inspection: Json | null; kind: string; last_error: string | null; last_synced_at: string | null; name: string; owner_login: string | null; ownership_checked_at: string | null; ownership_checked_by: string | null; ownership_commit_sha: string | null; ownership_confidence: number | null; ownership_evidence: Json; ownership_hints: Json; ownership_site_host: string | null; ownership_status: string; private: boolean; provider: string; selected_by: string | null; site_host: string | null; site_url: string | null; status: string; updated_at: string; workspace_id: string


FK workspace_sources_connection_id_fkey: (connection_id) -> workspace_connections (id); one-to-one false


FK workspace_sources_workspace_id_fkey: (workspace_id) -> workspaces (id); one-to-one false


### workspaces

audience: string | null; billing_account_id: string; brand_voice: Json; client_status: Database["public"]["Enums"]["client_status"]; connected_provider: string | null; created_at: string; domain: string | null; duplicate_of: string | null; first_prompt: string | null; frozen_at: string | null; frozen_reason: string | null; goals: string | null; id: string; industry: string | null; monthly_credit_cap: number | null; name: string; onboarded_at: string | null; owner_id: string; plan: string; website_url: string | null


FK workspaces_billing_account_id_fkey: (billing_account_id) -> billing_accounts (id); one-to-one false


FK workspaces_duplicate_of_fkey: (duplicate_of) -> workspaces (id); one-to-one false


## Latest SQL addition not yet in generated types

The source audit found one table created by the current migration sequence that is not represented in the checked-in generated Row dictionary: video_compositions. Keep this SQL-only addition alongside the 179 typed tables. Regenerate types after applying the migration in the intended environment; do not omit the table when rebuilding longer-video support.


| Column | Exact SQL declaration |

| --- | --- |

| id | uuid PRIMARY KEY |

| revision | integer NOT NULL DEFAULT 0 |

| lease_until | timestamptz; nullable |

| state | jsonb NOT NULL |

| created_at | timestamptz NOT NULL DEFAULT now() |

RLS is enabled. All privileges are revoked from anon and authenticated; service_role receives access. State contains the render request, clip target and render lengths, accepted provider task IDs, provider identity, available video URLs/cost and submission progress. The worker uses revision comparison and lease_until to coordinate writes. Sensitive state must remain server-only.


Implementation sources: supabase/migrations/20261021090000_video_compositions.sql; src/server/ugc/providers/composition.server.ts


## Database function contract index

These are the 107 generated public-schema function signatures. They may be protected by SQL grants or intended for service role only. The presence of a function here is not permission for an authenticated browser to invoke it. Private-schema functions and functions absent from generated types require the SQL source.


### accept_billed_workspace_invite

{ Args: { p_token: string; p_user: string; p_email: string; p_seat_limit?: number }; Returns: string; }


### accept_workspace_invite

{ Args: { _token: string }; Returns: string }


### account_billable_seat_count

{ Args: { p_account: string }; Returns: number }


### account_has_billable_member

{ Args: { p_account: string; p_user: string }; Returns: boolean; }


### account_wallet

{ Args: { p_account: string }; Returns: { meter: string; available: number; held: number; available_any: number; debt: number; }[]; }


### acquire_provider_lock

{ Args: { p_provider: string; p_holder: string; p_order_id?: string; p_lease_seconds?: number; }; Returns: Json; }


### activate_billing_social_profile_slot

{ Args: { p_workspace: string }; Returns: undefined }


### activate_brand_visual_profile

{ Args: { p_workspace: string; p_profile: string; p_expected: string }; Returns: undefined; }


### admin_abuse_signals

{ Args: never; Returns: Json }


### admin_analytics

{ Args: { p_days: number }; Returns: Json }


### admin_announcement_save

{ Args: { p_actor: string; p_actor_role: string; p_id: string; p_title: string; p_body: string; p_tone: string; p_link_url: string; p_dismissible: boolean; p_active: boolean; p_starts_at: string; p_ends_at: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_emails_for

{ Args: { p_ids: string[] }; Returns: { id: string; email: string }[] }


### admin_flag_save

{ Args: { p_actor: string; p_actor_role: string; p_key: string; p_description: string; p_enabled: boolean; p_rollout: number; p_workspaces: string[]; p_expires_at: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_health

{ Args: never; Returns: Json }


### admin_integrations

{ Args: never; Returns: Json }


### admin_jobs

{ Args: { p_source: string; p_state: string; p_limit: number; p_offset: number }; Returns: Json; }


### admin_lookup

{ Args: { p_query: string; p_match_email: boolean }; Returns: Json }


### admin_override_create

{ Args: { p_actor: string; p_actor_role: string; p_account: string; p_workspace: string; p_kind: string; p_key: string; p_allowed: boolean; p_limit_value: number; p_starts_at: string; p_expires_at: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_override_revoke

{ Args: { p_actor: string; p_actor_role: string; p_id: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_overview

{ Args: never; Returns: Json }


### admin_route_override_set

{ Args: { p_actor: string; p_actor_role: string; p_route: string; p_models: string[]; p_effort: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_spend_cap_set

{ Args: { p_actor: string; p_actor_role: string; p_scope: string; p_workspace: string; p_daily: number; p_monthly: number; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_switch_set

{ Args: { p_actor: string; p_actor_role: string; p_key: string; p_engaged: boolean; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_team_save

{ Args: { p_actor: string; p_actor_role: string; p_user: string; p_role: string; p_status: string; p_extra: string[]; p_denied: string[]; p_note: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_usage

{ Args: { p_days: number }; Returns: Json }


### admin_user_add_note

{ Args: { p_actor: string; p_actor_role: string; p_user: string; p_body: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_user_directory

{ Args: { p_search: string; p_filter: string; p_sort: string; p_limit: number; p_offset: number; }; Returns: Json; }


### admin_user_revoke_sessions

{ Args: { p_actor: string; p_actor_role: string; p_user: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_user_set_suspended

{ Args: { p_actor: string; p_actor_role: string; p_user: string; p_suspend: boolean; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_user_stats

{ Args: { p_user: string }; Returns: Json }


### admin_view_end

{ Args: { p_actor: string; p_actor_role: string; p_session: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_view_read

{ Args: { p_actor: string; p_actor_role: string; p_session: string; p_section: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_view_start

{ Args: { p_actor: string; p_actor_role: string; p_workspace: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### admin_workspace_directory

{ Args: { p_search: string; p_filter: string; p_limit: number; p_offset: number }; Returns: Json; }


### admin_workspace_members

{ Args: { p_workspace: string }; Returns: Json }


### admin_workspace_set_access

{ Args: { p_actor: string; p_actor_role: string; p_workspace: string; p_mode: string; p_reason: string; p_request_id: string; p_ip: string; p_user_agent: string; }; Returns: Json; }


### ai_usage_summary

{ Args: { p_scope_key: string }; Returns: { today_cost_usd: number; month_cost_usd: number; month_images: number; month_videos: number; month_calls: number; month_cached_calls: number; month_saved_usd: number; }[]; }


### analytics_ga4_dimension_totals

{ Args: { p_source_id: string; p_dimension: string; p_from: string; p_to: string; p_limit?: number; }; Returns: { value: string; sessions: number; screen_page_views: number; key_events: number; }[]; }


### analytics_gsc_dimension_totals

{ Args: { p_source_id: string; p_dimension: string; p_from: string; p_to: string; p_limit?: number; }; Returns: { value: string; clicks: number; impressions: number; position_weighted: number; }[]; }


### apply_credit_entry

{ Args: { p: Json }; Returns: Json }


### auth_user_id_for_email

{ Args: { p_email: string }; Returns: string }


### autopilot_overview

{ Args: never; Returns: { workspace_id: string; program_id: string; status: string; pause_reason: string; mode: string; ends_on: string; needs_approval: number; plan_waiting: number; new_opportunities: number; failures: number; missed: number; performance_warnings: number; next_action_at: string; next_action_title: string; }[]; }


### backlink_spent_credits

{ Args: { p_workspace: string }; Returns: number }


### billing_margin_report

{ Args: never; Returns: Json }


### billing_rollout_report

{ Args: never; Returns: Json }


### call_app_hook

{ Args: { p_path: string }; Returns: number }


### capture_ai_usage_reservation

{ Args: { p_id: string; p_actual_cost_usd?: number; p_latency_ms?: number }; Returns: boolean; }


### change_billed_workspace_member_role

{ Args: { p_workspace: string; p_user: string; p_role: Database["public"]["Enums"]["app_role"]; p_seat_limit?: number; }; Returns: undefined; }


### claim_analytics_sync_runs

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["analytics_sync_runs"]["Row"][]; }


### claim_audience_runs

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["audience_runs"]["Row"][]; }


### claim_autopilot_actions

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["autopilot_actions"]["Row"][]; }


### claim_competitor_jobs

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_competitor_id?: string; }; Returns: Database["public"]["Tables"]["workspace_competitors"]["Row"][]; }


### claim_due_scheduled_jobs

{ Args: { p_max?: number; p_lease_seconds?: number; p_market_brain?: boolean; p_job_id?: string; }; Returns: Database["public"]["Tables"]["scheduled_jobs"]["Row"][]; }


### claim_experiment_jobs

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["experiment_jobs"]["Row"][]; }


### claim_geo_agent_runs

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["geo_agent_runs"]["Row"][]; }


### claim_geo_scans

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_scan_id?: string }; Returns: Database["public"]["Tables"]["geo_scans"]["Row"][]; }


### claim_geo_verifications

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["geo_verifications"]["Row"][]; }


### claim_link_orders

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_order_id?: string }; Returns: Database["public"]["Tables"]["link_orders"]["Row"][]; }


### claim_site_publications

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["site_publications"]["Row"][]; }


### claim_slack_inbox

{ Args: { p_limit: number }; Returns: Database["public"]["Tables"]["slack_inbox"]["Row"][]; }


### claim_slack_outbound

{ Args: { p_limit: number }; Returns: Database["public"]["Tables"]["slack_outbound"]["Row"][]; }


### claim_tracked_prompts

{ Args: { p_limit: number; p_lease_seconds: number }; Returns: Database["public"]["Tables"]["geo_tracked_prompts"]["Row"][]; }


### claim_ugc_renders

{ Args: { p_worker: string; p_max?: number; p_lease_seconds?: number; p_id?: string }; Returns: Database["public"]["Tables"]["ugc_renders"]["Row"][]; }


### complete_visual_analysis

{ Args: { p_job: string; p_token: string; p_profile: Json }; Returns: undefined; }


### consume_rate_limit

{ Args: { p_bucket_key: string; p_window_seconds: number; p_limit: number; p_cost?: number }; Returns: { allowed: boolean; current_count: number; reset_at: string }[]; }


### create_billed_workspace_for_user

{ Args: { p_user_id: string; p_name: string; p_website_url: string; p_idempotency_key: string; p_brand_limit: number; }; Returns: { workspace_id: string; created: boolean }[]; }


### create_workspace_for_user

{ Args: { p_user_id: string; p_name: string; p_website_url: string; p_idempotency_key: string; }; Returns: { workspace_id: string; created: boolean }[]; }


### ensure_billing_account

{ Args: { p_user: string }; Returns: string }


### experiment_overview

{ Args: never; Returns: { workspace_id: string; proven_monthly_value: number; proven_value_currency: string; won_experiments: number; running_experiments: number; }[]; }


### is_workspace_member

{ Args: { _workspace_id: string; _user_id: string }; Returns: boolean }


### log_audit

{ Args: { _workspace_id: string; _action: string; _entity?: string; _payload?: Json }; Returns: string; }


### meter_capture

{ Args: { p: Json }; Returns: Json }


### meter_clawback

{ Args: { p: Json }; Returns: Json }


### meter_expire_due

{ Args: never; Returns: number }


### meter_grant

{ Args: { p: Json }; Returns: Json }


### meter_hold

{ Args: { p: Json }; Returns: Json }


### meter_release

{ Args: { p: Json }; Returns: Json }


### meter_release_expired_holds

{ Args: never; Returns: number }


### meter_rollover

{ Args: { p: Json }; Returns: Json }


### my_workspace_role

{ Args: { _workspace_id: string }; Returns: string }


### platform_spend_since

{ Args: { p_since: string }; Returns: number }


### prune_geo_agent_runs

{ Args: never; Returns: Json }


### prune_operational_logs

{ Args: never; Returns: Json }


### quarantine_provider_lock

{ Args: { p_provider: string; p_reason: string }; Returns: boolean; }


### reconcile_billing_capacity

{ Args: { p_account: string; p_brand_limit: number; p_seat_limit: number; p_preferred_workspace?: string; }; Returns: Json; }


### record_ai_usage

{ Args: { p_event: Json }; Returns: number }


### refresh_canva_authorization

{ Args: { p_workspace_id: string; p_connection_id: string; p_previous_refresh_token_enc: string; p_access_token_enc: string; p_refresh_token_enc: string; p_expires_at: string; }; Returns: boolean; }


### release_ai_usage_reservation

{ Args: { p_id: string; p_reason?: string }; Returns: boolean }


### release_billing_social_profile_slot_if_empty

{ Args: { p_workspace: string }; Returns: boolean; }


### release_expired_ai_usage_reservations

{ Args: never; Returns: number }


### release_provider_lock

{ Args: { p_provider: string; p_token: string }; Returns: boolean }


### renew_provider_lock

{ Args: { p_provider: string; p_token: string; p_phase?: string; p_lease_seconds?: number }; Returns: boolean; }


### replace_visual_artwork

{ Args: { p_workspace: string; p_job: string; p_expected: Json; p_output: Json; p_asset: string; p_headline: string; }; Returns: undefined; }


### reserve_ai_usage

{ Args: { p_request: Json }; Returns: Json }


### reserve_billing_social_profile_slot

{ Args: { p_workspace: string; p_limit: number }; Returns: undefined; }


### resolve_media_storage_paths

{ Args: { paths: string[] }; Returns: { source_path: string; target_path: string; status: string }[]; }


### save_canva_authorization

{ Args: { p_workspace_id: string; p_user_id: string; p_state_id: string; p_access_token_enc: string; p_refresh_token_enc: string; p_expires_at: string; p_scopes: string[]; p_canva_user_id: string; p_canva_team_id: string; }; Returns: string; }


### set_billing_enforcement_override

{ Args: { p_action: string; p_account: string; p_actor: string; p_mode: string; p_reason: string; }; Returns: Json; }


### set_persona_once

{ Args: { _persona: string }; Returns: { persona: string; persona_set_at: string }[]; }


### sweep_rixot_donors

{ Args: { p_before: string }; Returns: number }


### tombstone_migrated_media

{ Args: { paths: string[] }; Returns: undefined }


### upsert_rixot_donors

{ Args: { p_rows: Json }; Returns: number }


### use_manual_visual_look

{ Args: { p_workspace: string; p_expected: string }; Returns: undefined; }


### withdraw_canva_authorization

{ Args: { p_workspace_id: string }; Returns: { refresh_token_enc: string }[]; }


### workspace_member_profiles

{ Args: { _workspace_id: string }; Returns: { user_id: string; role: string; name: string; avatar_url: string; joined_at: string; }[]; }


### workspace_members_page

{ Args: { p_workspace: string; p_offset: number; p_limit: number }; Returns: Json; }


### workspace_overview

{ Args: never; Returns: { id: string; name: string; website_url: string; domain: string; industry: string; client_status: string; plan: string; role: string; owner_id: string; duplicate_of: string; onboarded_at: string; created_at: string; logo_url: string; pending_approvals: number; draft_count: number; scheduled_count: number; published_count: number; failed_count: number; connected_social_accounts: number; geo_score: number; geo_scanned_at: string; last_activity_at: string; }[]; }


Implementation sources: src/integrations/supabase/types.ts


## Migration chronology

All 175 SQL migrations in the extracted snapshot, ordered by filename. A timestamp establishes repository ordering, not proof it has been applied to production. Preserve migration history and review clean-install and upgrade behavior separately. The newest composition and approval migrations are necessary for their matching source behavior.


| Migration file |

| --- |

| supabase/migrations/20260515092856_f89390f2-6325-42a0-851e-f98e1eefea7f.sql |

| supabase/migrations/20260515092920_fe0a7e57-7fa8-4c00-ae75-cb64c147f1ff.sql |

| supabase/migrations/20260515135802_88eca8f8-cada-47c2-b1fc-eb69c8d7e954.sql |

| supabase/migrations/20260515171352_5adc29a4-a1c9-4078-a003-94c1f7674c44.sql |

| supabase/migrations/20260515182818_78eaf3f8-a75a-41ef-aa34-554d096ce288.sql |

| supabase/migrations/20260515183134_7b9834fc-9f54-4bfe-9482-f613bf39008e.sql |

| supabase/migrations/20260524095344_35bcd6b9-e019-492a-aabe-aad725fdd103.sql |

| supabase/migrations/20260601102030_84ed669b-c522-4dc5-a8c0-00f97d775439.sql |

| supabase/migrations/20260603041939_5ea73fac-cd96-4cbf-921d-30287135f0d6.sql |

| supabase/migrations/20260612120630_f30875d5-827c-42b1-8420-d36ac035f9fa.sql |

| supabase/migrations/20260612121844_ff58033e-2d55-475e-bc39-2029a81e161a.sql |

| supabase/migrations/20260613164523_3dc39956-68a4-4711-866d-63de937cfa8a.sql |

| supabase/migrations/20260620095236_c414764d-9c96-4fff-86ae-80f3e3dc7b73.sql |

| supabase/migrations/20260620095952_dd03daa6-3753-4f4e-a537-78d0baf9b849.sql |

| supabase/migrations/20260620100449_4da6100a-eef2-4d78-8cba-7070b7c8b802.sql |

| supabase/migrations/20260620101957_e39091c5-a1b9-43fc-92c7-1fd0c84a59aa.sql |

| supabase/migrations/20260620102147_283e6290-faa9-4151-aacc-295cf267db1f.sql |

| supabase/migrations/20260620102427_1adcf2e5-0ed0-4aa2-bbaf-6c5e5b161d29.sql |

| supabase/migrations/20260625122548_53ddd990-24cb-4ee9-8963-1a45cf3b48ac.sql |

| supabase/migrations/20260628091455_a06cae50-764c-4ff8-b1d9-3432e8e0bd23.sql |

| supabase/migrations/20260628091518_2db13045-fba3-4774-964e-fad75972b77d.sql |

| supabase/migrations/20260628092047_201bf8bb-842b-44c9-8332-7f18c4946b0f.sql |

| supabase/migrations/20260628153819_120670af-a4b9-4078-a8cd-751772916ee3.sql |

| supabase/migrations/20260629103118_1a4cdde3-a8ed-455e-826a-0bc5e6c5ba5f.sql |

| supabase/migrations/20260629103222_0f0ff6b4-3ec3-4c16-a0ba-b96c91074098.sql |

| supabase/migrations/20260629103938_23e6571f-8b4a-4979-a8ce-a4aea34b096e.sql |

| supabase/migrations/20260630182537_4e453f97-ab49-4ca6-9014-999752576722.sql |

| supabase/migrations/20260630184724_e380d055-2b47-44dc-a4da-9de7c1fd7171.sql |

| supabase/migrations/20260630200258_1ce1cb32-45d3-42f3-becc-ac052001e396.sql |

| supabase/migrations/20260707193010_fea60858-a686-48a2-8fb6-e63f6e340f53.sql |

| supabase/migrations/20260707193116_954a033c-abb0-4dda-aa87-317f91ae5d66.sql |

| supabase/migrations/20260707193303_93348393-698b-4f35-ae22-644af74d8942.sql |

| supabase/migrations/20260707193445_46dd0707-2e4d-4ee8-b7d1-e2cea84ec364.sql |

| supabase/migrations/20260709194343_9ba1d523-b946-4e78-a69d-e6bdaf5ba26e.sql |

| supabase/migrations/20260709194553_bb8d43fe-2f5e-48cb-9c77-8042cb96e8be.sql |

| supabase/migrations/20260709212343_4feb1702-87f2-45f0-9b83-6b92ce93a1e9.sql |

| supabase/migrations/20260709213859_80e26c94-28cf-45c1-9383-304df23d4ba5.sql |

| supabase/migrations/20260710100535_45a3451d-82a0-4499-bc1d-7e2e6260ca0c.sql |

| supabase/migrations/20260712203224_2d6ac297-789e-40b6-9228-e05bdb9dfb39.sql |

| supabase/migrations/20260712220251_2a14b1a0-8e29-4a9a-bad7-e71064c4ce68.sql |

| supabase/migrations/20260718184546_e27386a1-4495-4b68-b399-0a94f1d7702d.sql |

| supabase/migrations/20260718184836_4ff53c1f-ade2-4fe4-88c2-518841d56158.sql |

| supabase/migrations/20260720095116_ad729590-6b24-416b-8a9f-bf7cd05b7214.sql |

| supabase/migrations/20260809000001_add_workspace_sdr.sql |

| supabase/migrations/20260809000002_add_content_publications.sql |

| supabase/migrations/20260809000003_publishing_status_doc.sql |

| supabase/migrations/20260810000001_add_publications_perf_indexes.sql |

| supabase/migrations/20260903000000_disable_legacy_competitor_watch_cron.sql |

| supabase/migrations/20260907120000_create_conversations.sql |

| supabase/migrations/20260907150000_enforce_content_lifecycle.sql |

| supabase/migrations/20260910010000_create_persistent_assets.sql |

| supabase/migrations/20260910020000_harden_generated_asset_storage.sql |

| supabase/migrations/20260910030000_harden_client_share_secrets.sql |

| supabase/migrations/20260910040000_protect_workspace_owner_membership.sql |

| supabase/migrations/20260910050000_add_schedule_claim_leases.sql |

| supabase/migrations/20260910060000_lock_workspace_resource_ownership.sql |

| supabase/migrations/20260910070000_add_market_trend_collections.sql |

| supabase/migrations/20260910080000_add_market_intelligence_cache.sql |

| supabase/migrations/20260911000000_add_api_rate_limits.sql |

| supabase/migrations/20260911000100_add_app_hook_caller.sql |

| supabase/migrations/20260911090000_add_market_brain_production_schema.sql |

| supabase/migrations/20260911120000_add_sdr_webhook_events.sql |

| supabase/migrations/20260911120100_add_ai_usage_metering.sql |

| supabase/migrations/20260911120200_add_guardrail_events.sql |

| supabase/migrations/20260911120300_add_agent_control_plane.sql |

| supabase/migrations/20260911120400_add_cron_heartbeats_and_job_claims.sql |

| supabase/migrations/20260911120500_revoke_private_schema_from_anon.sql |

| supabase/migrations/20260911120600_schedule_app_cron_jobs.sql |

| supabase/migrations/20260913080000_content_lifecycle_distribution_meta.sql |

| supabase/migrations/20260913090000_studio_jobs.sql |

| supabase/migrations/20260913100000_add_socialapi_distribution.sql |

| supabase/migrations/20260914120000_add_geo_intelligence.sql |

| supabase/migrations/20260915090000_add_workspace_connectors.sql |

| supabase/migrations/20260916090000_add_geo_fix_workflow.sql |

| supabase/migrations/20260916100000_add_geo_fix_batches.sql |

| supabase/migrations/20260917090000_add_source_ownership.sql |

| supabase/migrations/20260917090100_add_geo_agent_runs.sql |

| supabase/migrations/20260918090000_connector_install_return_origin.sql |

| supabase/migrations/20260919090000_connector_install_return_path.sql |

| supabase/migrations/20260920090000_canonical_workspaces.sql |

| supabase/migrations/20260920090100_workspace_brand_dna.sql |

| supabase/migrations/20260920090200_workspace_overview.sql |

| supabase/migrations/20260920090300_stop_signup_placeholder_workspace.sql |

| supabase/migrations/20260920090400_client_portal_messages.sql |

| supabase/migrations/20260920090500_harden_client_portal_grants.sql |

| supabase/migrations/20260921090000_add_ai_usage_reservations.sql |

| supabase/migrations/20260921090100_add_ugc_video_ads.sql |

| supabase/migrations/20260921110000_add_competitor_intelligence.sql |

| supabase/migrations/20260922090000_add_google_analytics_connector.sql |

| supabase/migrations/20260922090100_schedule_analytics_sync.sql |

| supabase/migrations/20260922090200_add_analytics_aggregates.sql |

| supabase/migrations/20260922090300_add_webflow_connector.sql |

| supabase/migrations/20260923090000_add_backlink_intelligence.sql |

| supabase/migrations/20260923090100_schedule_backlink_runs.sql |

| supabase/migrations/20260923090200_add_backlink_upsert_rpcs.sql |

| supabase/migrations/20260923100000_backlink_builder.sql |

| supabase/migrations/20260923110000_backlink_sites.sql |

| supabase/migrations/20260923120000_add_wordpress_connector.sql |

| supabase/migrations/20260923130000_add_wordpress_com_oauth.sql |

| supabase/migrations/20260924090000_backlink_acquisition.sql |

| supabase/migrations/20260925090000_link_marketplace.sql |

| supabase/migrations/20260925090100_link_marketplace_rpcs.sql |

| supabase/migrations/20260925090200_schedule_link_orders.sql |

| supabase/migrations/20260925090300_provider_lock_optional_order.sql |

| supabase/migrations/20260926090000_add_competitor_intelligence_graph.sql |

| supabase/migrations/20260926100000_replace_dataforseo_with_tavily_market_signals.sql |

| supabase/migrations/20260927090000_client_share_stable_links.sql |

| supabase/migrations/20260928090000_add_proof_engine.sql |

| supabase/migrations/20260928090100_fix_experiment_lock_children.sql |

| supabase/migrations/20260929090000_geo_site_connectors.sql |

| supabase/migrations/20260930090000_schedule_experiments_hook.sql |

| supabase/migrations/20261001090000_brand_kit_styles.sql |

| supabase/migrations/20261002090000_billing_account_schema.sql |

| supabase/migrations/20261002090100_billing_meter_rpcs.sql |

| supabase/migrations/20261002090200_billing_usage_attribution.sql |

| supabase/migrations/20261002090300_billing_schedule.sql |

| supabase/migrations/20261002090400_billing_brand_limit.sql |

| supabase/migrations/20261002090500_billing_studio_async.sql |

| supabase/migrations/20261002090600_billing_ugc_async.sql |

| supabase/migrations/20261002090700_billing_seat_limit.sql |

| supabase/migrations/20261002090800_billing_social_profile_slots.sql |

| supabase/migrations/20261002090900_billing_provider_stripe.sql |

| supabase/migrations/20261002091000_billing_stripe_account.sql |

| supabase/migrations/20261002091100_billing_capacity_reconcile.sql |

| supabase/migrations/20261002091200_billing_invoice_clawback.sql |

| supabase/migrations/20261002091300_billing_operations.sql |

| supabase/migrations/20261002091400_billing_backlink_history.sql |

| supabase/migrations/20261002091500_billing_checkout_reservation.sql |

| supabase/migrations/20261002091600_billing_capacity_cursor.sql |

| supabase/migrations/20261002091700_billing_margin_report.sql |

| supabase/migrations/20261002091800_billing_provider_health.sql |

| supabase/migrations/20261002091900_billing_enforcement_override.sql |

| supabase/migrations/20261002092000_billing_frozen_brand_boundary.sql |

| supabase/migrations/20261002092100_postforme_social_profile_slots.sql |

| supabase/migrations/20261002092200_billing_purchase_requests.sql |

| supabase/migrations/20261002092300_billing_async_links.sql |

| supabase/migrations/20261002092400_billing_launch_grace.sql |

| supabase/migrations/20261002092500_billing_idempotency_terms.sql |

| supabase/migrations/20261002092501_geo_tracked_prompts.sql |

| supabase/migrations/20261002092600_billing_legacy_workspace_plan_sync.sql |

| supabase/migrations/20261002092700_content_lifecycle_calendar_plan.sql |

| supabase/migrations/20261003090000_autopilot.sql |

| supabase/migrations/20261003090100_autopilot_rpcs.sql |

| supabase/migrations/20261003090200_autopilot_strategy.sql |

| supabase/migrations/20261003090300_autopilot_tasks.sql |

| supabase/migrations/20261004090000_social_trend_snapshots.sql |

| supabase/migrations/20261005090000_mcp.sql |

| supabase/migrations/20261005090100_billing_idempotency_terms_repair.sql |

| supabase/migrations/20261006090000_stories.sql |

| supabase/migrations/20261007090000_canva_connector.sql |

| supabase/migrations/20261008090000_canva_edit_versions.sql |

| supabase/migrations/20261008100000_workspace_invite_lookup.sql |

| supabase/migrations/20261009090000_notion_calendar.sql |

| supabase/migrations/20261010090000_audience_intelligence.sql |

| supabase/migrations/20261011090000_brand_look_from_default_style.sql |

| supabase/migrations/20261011090100_workspace_marketing_strategy.sql |

| supabase/migrations/20261012090000_canva_atomic_authorization.sql |

| supabase/migrations/20261012090000_drop_brand_styles.sql |

| supabase/migrations/20261012190000_r2_storage_migration.sql |

| supabase/migrations/20261013090000_slack_integration.sql |

| supabase/migrations/20261014090000_workspace_memory.sql |

| supabase/migrations/20261015090000_brand_visual_taste.sql |

| supabase/migrations/20261015090000_site_blog_setup.sql |

| supabase/migrations/20261016090000_repair_slack_claims_and_experiments_schedule.sql |

| supabase/migrations/20261017090000_app_tour.sql |

| supabase/migrations/20261018090000_admin_foundation.sql |

| supabase/migrations/20261018090000_content_kind_approval.sql |

| supabase/migrations/20261018100000_entitlement_overrides.sql |

| supabase/migrations/20261018120000_admin_operations.sql |

| supabase/migrations/20261018130000_admin_flags_announcements.sql |

| supabase/migrations/20261018140000_admin_insight.sql |

| supabase/migrations/20261018150000_admin_ai_controls.sql |

| supabase/migrations/20261018160000_admin_workspace_access.sql |

| supabase/migrations/20261018170000_admin_jobs_abuse.sql |

| supabase/migrations/20261021090000_video_compositions.sql |

Implementation sources: supabase/migrations


## Separate Python API inventory

These paths are statically extracted from direct @router/@app decorators in backend. Router prefixes can add a path segment at registration; this table is not a full OpenAPI export. Production deployment, auth policy and model availability for this separate service were not independently confirmed.


| Decorator path | Method | Source |

| --- | --- | --- |

| /health | GET | backend/app/main.py |

Implementation sources: backend


## Maintaining the blueprint

- Regenerate API/page/model/catalog/schema inventories whenever their source changes; store snapshot date, commit and file hashes.

- Update narrative when behavior changes, especially approval modes, billing, provider retirement, media capabilities or source ownership.

- Review official model availability and rate cards at each provider change; retain invoices as actual-spend evidence.

- Track production facts in a private operational supplement: services, migrations, flags, approved OAuth apps, backups and contacts.

- Keep future feature decisions separate from current-state documentation. Move a later catalog item to launch only with an implemented path and verified acceptance evidence.

- Retain the editable Markdown companions and machine-readable inventory so a future maintainer can update the series without reconstructing it from PDFs.

## Source ledger and verification limits

Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.


The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.


| Source | SHA-256 prefix |

| --- | --- |

| docs/documentation-maintenance.md | 8117afd85c931614 |

| src/server/route.ts | 391e0eb6fa6c43a7 |

| src/lib/billing/catalog.ts | eb845ac041f58b84 |

| supabase/migrations | directory reference |

| package.json | c6995b00a40c90b8 |

| package-lock.json | 3128315607b265d7 |

| Dockerfile | 430225c9b5bc79c7 |

| src/server/env.ts | a814c54a60a11cb0 |

| src/instrumentation.ts | 5e3caad36277cc50 |

| next.config.ts | bc5ebc3b26f710f9 |

| src/server/workspaces | directory reference |

| src/server/fns/workspaces.ts | 974d72a2d9da1509 |

| src/lib/workspace | directory reference |

| src/integrations/supabase | directory reference |

| src/server/billing | directory reference |

| src/server/ai | directory reference |

| src/lib/ai-gateway.server.ts | 45c14a06dd6557bf |

| src/server/platform | directory reference |

| src/server/brain | directory reference |

| src/server/strategy | directory reference |

| src/server/memory | directory reference |

| src/server/chat | directory reference |

| src/lib/memory | directory reference |

| src/lib/strategy | directory reference |

| src/server/studio | directory reference |

| src/server/assets | directory reference |

| src/server/fns/content.ts | cbd7e21890647951 |

| src/server/connectors/canva | directory reference |

| src/server/connectors/notion | directory reference |

| supabase/migrations/20261018090000_content_kind_approval.sql | df81942beba55d0e |

| src/lib/postforme | directory reference |

| src/lib/feature-flags.ts | e56ac35e17629593 |

| src/server/social | directory reference |

| src/server/articles | directory reference |

| src/server/analytics | directory reference |

| src/server/fns/publish.ts | ba13a497e8368272 |

| src/lib/ugc | directory reference |

| src/server/ugc | directory reference |

| src/server/billing/ugc-async.server.ts | 687ecbb7c2909d94 |

| src/server/ugc/providers/composition.server.ts | 4b92cd5607c286fb |

| supabase/migrations/20261021090000_video_compositions.sql | d2c16d0b4eea8af7 |

| src/lib/geo | directory reference |

| src/server/geo | directory reference |

| src/lib/experiments/constants.ts | c6a71a1733c65aa5 |

| src/lib/experiments/evaluate.ts | d0203f55074861cd |

| src/server/experiments | directory reference |

| src/lib/audience/calibration.ts | 0dd94c44e6bc5838 |

| src/server/autopilot | directory reference |

| src/lib/autopilot | directory reference |

| src/server/mcp | directory reference |

| src/server/admin | directory reference |

| tests | directory reference |

| src/server | directory reference |

| src/app/api/geo/scans/route.ts | a529199b35c27467 |

| src/app/api/studio/jobs/route.ts | 8a10299506026906 |

| src/lib/studio/jobs.ts | edb9510909c0a97f |

| src/app/api/ugc/renders/route.ts | 31d547eaf590ac88 |

| src/lib/ugc/schemas.ts | 63049c08f6641501 |

| src/lib/ugc/models.ts | 6d1c68c9c5d44b38 |

| src/lib/ugc/duration.ts | 6ad312021cd6c5d5 |

| src/server/ai/task-models.ts | e905dc027bcc6d2b |

| src/integrations/supabase/types.ts | 2c6c5e758669115b |

| backend | directory reference |