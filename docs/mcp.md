# Mellox MCP server

Lets people run Mellox from Claude, ChatGPT and any other MCP client. Decision
record: [ADR-0029](adr/0029-mcp-server.md).

```
Claude / ChatGPT ──OAuth──▶ /api/mcp ──▶ existing server functions and /api routes
                                          (Autopilot, Studio, calendar, publishing,
                                           competitors, Market Brain, AI Visibility)
```

## How it works

- **Address:** `<APP_URL>/api/mcp` (Streamable HTTP, stateless, JSON replies).
- **Sign-in:** OAuth 2.1 through Supabase Auth's OAuth server. A client that
  calls without a token gets `401` with a pointer to
  `/.well-known/oauth-protected-resource/api/mcp`, registers itself, and sends
  the person to `/oauth/consent`. The token it receives is that person's own
  Supabase access token, so every database read runs under their RLS.
- **Per workspace, off by default.** An admin turns it on in
  Settings → AI assistants, and separately allows changes. Read-only is the
  first step; "allow changes" covers anything that edits, posts or spends.
  Creating a new workspace through MCP requires at least one existing workspace
  with assistant changes allowed; the new workspace starts with access off.
- **A tool is a call to the app's own code.** `src/server/mcp/bridge.server.ts`
  invokes the same server function (`callFn`) or route handler (`callRoute`) the
  browser uses, in-process, with the caller's token. That code runs its own
  auth, role, rate-limit, plan and credit checks. The MCP layer adds its gates
  in front; it never replaces one.

## Gates on every call (`runTool`, `src/server/mcp/registry.server.ts`)

1. Kill switch `FEATURE_FLAG_MCP_ENABLED` (and `_WS_<id>`), on unless `false`.
2. Input validated against the tool's schema.
3. Workspace membership and the tool's minimum role, with the caller's RLS client.
4. The workspace's switch: on, and for a change, "allow changes".
5. Rate limit: `mcp-read` 120/min, `mcp-write` 30/min, per person and workspace.
6. The function or route behind the tool then applies its own checks.
7. One row in `mcp_tool_calls` (append-only); a successful change also goes to
   `audit_logs` as `mcp.<tool>`.

## What is deliberately not exposed

| Not available                            | Why                                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| Deleting a workspace                     | Cannot be undone; stays a typed confirmation in the app |
| Approving or applying a website fix      | Approval binds the exact patch a person read            |
| Billing, credits, upgrades               | Money decisions stay with the owner in the app          |
| Team invites, roles, removing members    | Access changes stay with admins in the app              |
| Connecting or disconnecting accounts     | Needs the provider's own sign-in                        |
| Scheduling or posting unapproved content | `content_items.status` must be `approved`               |

## Tools

| Area             | Read                                                                                                                                        | Change                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspaces       | `list_workspaces`, `get_workspace_details`, `get_workspace_summary`, `get_agency_summary`, `list_social_accounts`                           | `create_workspace`, `rename_workspace`                                                                                                                                                                                                                              |
| Content          | `list_content`, `get_content_calendar`, `get_pending_approvals`, `get_content_job`                                                          | `create_content`, `generate_campaign_brief`, `plan_content_calendar`, `write_content_draft`, `update_content`, `regenerate_content`, `move_content_date`, `delete_content`, `review_content`, `schedule_content`, `publish_content_now`, `cancel_scheduled_content` |
| Autopilot        | `get_autopilot_status`, `get_opportunities`, `suggest_marketing_plan`                                                                       | `act_on_opportunity`, `save_marketing_plan`, `approve_weekly_plan`, `review_autopilot_piece`, `retry_autopilot_step`, `set_autopilot_paused`, `stop_autopilot`                                                                                                      |
| Market and brand | `get_market_updates`, `get_competitors`, `get_brand_dna`, `get_analytics_summary`                                                           | `get_marketing_briefing` (spends), `discover_competitors`, `add_competitor`, `track_competitors`, `set_competitor_status`, `refresh_competitor`, `remove_competitor`, `update_brand_dna`                                                                            |
| AI Visibility    | `list_geo_scans`, `get_geo_scan`, `get_geo_findings`, `get_geo_trend`, `get_geo_fix_options`, `get_geo_fix_proposal`, `get_tracked_prompts` | `start_geo_scan`, `set_geo_finding_state`, `propose_geo_fix`, `request_geo_verification`, `add_tracked_prompt`, `set_tracked_prompt_paused`, `delete_tracked_prompt`, `check_tracked_prompt_now`                                                                    |

## Errors

A failed tool returns `isError: true` with
`{ "error": { "code", "message", "details"? } }`. Codes: `unauthenticated`,
`forbidden`, `mcp_disabled`, `read_only`, `not_found`, `invalid_input`,
`conflict`, `not_approved`, `rate_limited`, `budget_exceeded`,
`upgrade_required`, `insufficient_balance`, `limit_reached`,
`spend_not_allowed`, `brand_frozen`, `schedule_failed`, `upstream_error`,
`unavailable`, `internal_error`. An unknown failure is logged on the server
and reported as `internal_error` with no detail.

## Output

Every result passes `cleanOutput` (`src/server/mcp/tool.ts`): keys that could
hold a credential, storage path, provider id or email are removed, and long
text and lists are cut.

## Setup (once per environment)

1. Supabase dashboard → Authentication → OAuth Server: enable it, allow dynamic
   client registration, and set the authorization (consent) path to
   `<APP_URL>/oauth/consent`.
2. Apply `supabase/migrations/20261005090000_mcp.sql`.
3. `APP_URL` must be the public HTTPS origin (it is put in the sign-in metadata).
4. In a workspace: Settings → AI assistants → turn it on.
5. In Claude or ChatGPT, add a custom connector with `<APP_URL>/api/mcp`.

## Adding a tool

Add an entry to a file in `src/server/mcp/tools/` that calls an existing
server function or route through the bridge. Give it `minRole`, set
`write: true` if it changes or spends, and `destructive: true` if it can't be
undone. Read tools are named `list_`, `get_` or `suggest_` (a test enforces
it). If the function takes a bare record id, check the record belongs to the
verified workspace first (`requireItems` in `tools/content.ts`).

## Tests

- `src/server/mcp/mcp.test.ts` — gates, records, approval rule, errors, output.
- `src/app/api/mcp/route.test.ts` — 401 challenge, kill switch, protocol.
- `tests/db/mcp.test.ts` — RLS and append-only.
- `tests/live/mcp.live.ts` — real database and dev server; set
  `MCP_LIVE_ACCESS_TOKEN` to also run as a signed-in person.
