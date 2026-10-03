# ADR-0029: MCP server — AI assistants operate Mellox as a member

- Status: Accepted
- Date: 2026-10-05
- Builds on: ADR-0014 (canonical workspaces), ADR-0027 (billing), ADR-0028 (Autopilot)

## Context

People want to run Mellox from Claude, ChatGPT and other MCP clients: ask what
needs attention across clients, create and schedule content, pause Autopilot.
Mellox had no API keys, no OAuth server and no MCP code.

## What the codebase gave us (findings that shaped this decision)

- Every entry point authenticates a **Supabase JWT** (`verifyBearer`) and builds
  an RLS client from it. Several services need that client (`workspace_overview()`,
  `autopilot_overview()` run as the caller). Nothing can build one from a user id.
- Capabilities live in two places: server functions (`src/server/fns`) and
  `defineRoute` handlers. Each already does role, rate limit, plan and credits.
- `@supabase/auth-js` ships Supabase's OAuth 2.1 server API
  (`auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization`).
- `@modelcontextprotocol/sdk` has a Web-standard Streamable HTTP transport that
  fits a Next route handler.

## Decision

### 1. Sign-in is Supabase's OAuth server; the token is the person's own

Claude and ChatGPT require OAuth with dynamic client registration. Supabase
Auth provides it and issues ordinary user access tokens carrying a `client_id`
claim. So the MCP route authenticates with the existing `verifyBearer`, and
RLS applies exactly as in the app. We rejected our own token table (personal
access tokens): an opaque token cannot produce an RLS client, which would force
service-role reads and hand-written membership checks everywhere.

### 2. A tool calls the app's own function or route, in-process

`bridge.server.ts` builds a request with the caller's token and invokes the
registered server function or the exported route handler. The existing checks
run unchanged. No tool reads or writes the database or a provider directly
(one exception: reading `content_items` ids through the caller's RLS client to
confirm a record belongs to the verified workspace).

### 3. Assistant tokens work only through the MCP server

`verifyBearer` refuses a token with a `client_id` claim unless the request is
the MCP route's or one the bridge built (tracked by object identity in a
`WeakSet`, so it cannot be forged over the network). Otherwise an assistant's
token could call `/api/rpc` directly and skip the workspace switch.

### 4. Off by default, two switches per workspace

`mcp_workspace_settings`: `enabled`, `allow_writes`. Admins change them.
Anything that edits, posts or spends is a "write". Global and per-workspace
kill switch: `FEATURE_FLAG_MCP_ENABLED`.

### 5. Approval stays a person's decision

Scheduling and posting require `content_items.status = 'approved'`, checked by
the tool itself (the provider handler would promote a draft). Tool descriptions
tell the assistant to approve only what the person agreed to, and MCP clients
show their own confirmation for tools not marked read-only.

### 6. Everything is recorded

`mcp_tool_calls` is append-only (trigger) and holds who, which client, which
tool, the outcome and identifiers — never content. Successful changes are also
written to `audit_logs`.

## Decisions made with the product owner

- Broad coverage: content, calendar, posting, Autopilot, competitors, Brand
  DNA, AI Visibility and workspaces are all operable from an assistant.
- Posting now is available, for approved content only.

## Out of scope

Deleting workspaces, approving or applying website fixes, billing and credit
purchases, team and role changes, connecting accounts. Each either cannot be
undone, moves money, or binds an approval to something a person must read.

## Consequences and risks

- **A dashboard setting is required** (Supabase OAuth Server + dynamic
  registration + consent path). Until it is on, clients cannot sign in.
- **An assistant's token is a user JWT.** A client that has one could call
  Supabase's REST API directly with the public key. RLS bounds that to what the
  person can already do, and browsers cannot write service-only tables, but the
  workspace switch does not apply there. If that matters later, add restrictive
  RLS policies on `auth.jwt()->>'client_id'`.
- Supabase tokens are not bound to this resource (`aud` is `authenticated`).
- Tool output is model input. Text from the web that Mellox stored (market
  sources, competitor updates) reaches the assistant as data; clients treat
  tool results as untrusted.
- ~55 tools is a large list for a client to load. Split into read and manage
  servers if clients struggle.
