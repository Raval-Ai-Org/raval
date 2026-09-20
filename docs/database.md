# Database reference

Supabase PostgreSQL is the system of record. Migrations under
`supabase/migrations` are the authoritative schema history; generated client
types live in `src/integrations/supabase/types.ts`.

## Core domains

| Domain | Tables (representative current objects) |
| --- | --- |
| Identity/workspaces | `profiles`, `workspaces`, `workspace_members`, `workspace_invites`, `workspace_brand_dna`, `workspace_sources`, `workspace_connections` |
| Content and delivery | `content_items`, `content_publications`, `approvals`, `assets`, `scheduled_jobs` |
| Conversation and memory | `conversations`, `chat_messages`, `memory_insights` |
| AI usage and controls | `ai_usage_events`, `ai_usage_daily`, `ai_usage_reservations`, `guardrail_events`, `api_rate_limits` |
| GEO and agents | `geo_scans`, `geo_scan_pages`, `geo_findings`, `geo_finding_states`, `geo_verifications`, `geo_fix_batches`, `geo_fix_proposals`, `geo_agent_runs`, `geo_agent_events`, `agent_runs`, `agent_run_steps`, `agent_findings`, `agent_action_requests` |
| Media | `studio_jobs`, `ugc_projects`, `ugc_renders` |
| Social and analytics | `social_accounts`, `social_oauth_states`, `social_usage_events`, `workspace_sdr`, `workspace_socialapi`, `analytics_sources`, `analytics_sync_runs`, `analytics_ga4_daily`, `analytics_gsc_daily`, aggregate and insight tables |
| Operations | `audit_logs`, `cron_heartbeats`, `sdr_webhook_events`, `competitor_intelligence_runs`, `market_intelligence_cache`, `market_trend_collections` |

This is a domain index, not a substitute for the migration definitions. New
schema work must update the relevant migration and regenerate types.

## Relationships and tenancy

Most workspace-owned rows carry `workspace_id` and are authorized through
`private.is_workspace_member` or role helpers. Workspace membership is the
canonical access relationship. Content, AI usage, connectors, analytics, GEO,
agent, media, and distribution rows must not be reassigned across workspaces;
current migrations add database guards for important ownership columns.

## RLS

Tables are generally created with RLS enabled and policies scoped to the
authenticated user and workspace membership. Service-role operations bypass
RLS by design and therefore must remain server-only, explicit, and audited.
Private schema functions support membership, workspace creation, storage path
validation, job claiming, rate limits, and AI usage reservations.

## Schema change checklist

1. Add an idempotent migration with `IF NOT EXISTS`/policy replacement where appropriate.
2. Add or update RLS policies and ownership guards.
3. Add indexes for new workspace and claim paths.
4. Run `npm run db:verify` and `npm run db:types`.
5. Update this domain index and any API/feature guide.
6. Apply and exercise the real migration in the target environment before release.

TODO: publish a generated ERD from the current schema as part of CI; the checked-in
`docs/ERD.png` may not reflect the newest migrations.
