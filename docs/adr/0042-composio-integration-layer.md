# ADR-0042: Composio as the connected-apps layer

Status: Accepted (foundation built; apps go live one by one after their capability check)
Date: 2026-11-02

## Context

Mellox connects to seven services, each hand-built (GitHub, WordPress, Webflow,
Google, Canva, Notion, Slack) with its own tables, encryption key and Settings
card. Social publishing runs on Post for Me. Customers also use CRMs, email
tools, shops, spreadsheets and social networks that Mellox can't reach, and
building each one by hand is slow.

Composio offers OAuth sign-in, token storage and refresh, and a large set of
typed tools for hundreds of apps behind one API. Research (Nov 2026) found:

- Sign-in: auth configs per toolkit, connected accounts per `user_id`,
  `POST /connected_accounts/link` returns the new account id up front.
  Composio's managed OAuth apps work immediately but share rate limits and
  quotas across Composio's customers; production should move to Mellox's own
  apps per toolkit.
- There is no event when an account stops working.
- Managed sign-in exists for Instagram, Facebook Pages, LinkedIn, YouTube,
  Pinterest, Reddit, HubSpot and others; not for X (removed Feb 2026),
  Threads, TikTok or Wix.
- Pricing changed several times in 2026; Mellox meters every call itself.

## Decision

1. **One gateway.** `src/server/integrations/composio/gateway.server.ts` is the
   only file that reads `COMPOSIO_API_KEY` or calls Composio (plain `fetch`,
   API v3.1). Reads retry; writes never do, and an unclear write outcome is
   `unknown_outcome`, resolved by reading.
2. **One guard.** Every tool runs through `runIntegrationTool`
   (`src/server/integrations/execute.server.ts`): kill switch → account
   belongs to the verified workspace and is active → tool is on the catalog's
   allow-list → role → a write needs an approval reference → per-workspace
   rate limit → run → `integration_tool_calls` (append-only) and an audit row
   for writes. A refused sign-in flips the account to `reconnect_required`.
3. **One catalog.** `src/lib/integrations/catalog.ts` (pure) lists every app,
   how Mellox talks to it (`composio | direct | postforme | search`), whether
   it can be connected (`live | testing | needs_approval | later`), what
   Mellox does with it, and the exact tool slugs allowed. Destructive tools are
   never listed (a test enforces it). Only OAuth apps; never a pasted key.
4. **Identity is the workspace.** The Composio user is
   `mellox_ws_<workspaceId>`, derived, never stored or read from a request.
   One brand = one isolated set of connections; an agency connects an account
   once per brand. Completing a connection re-reads Composio and refuses an
   account that isn't ACTIVE, isn't this toolkit, or isn't this workspace's.
5. **Status is swept.** `sweepAccounts` re-reads each account every 6 hours
   from the existing `sdr-reconcile` hook. No new cron job.
6. **Existing connectors stay direct.** GitHub (App PRs), Slack (events and
   buttons), Notion, Canva, Google, WordPress, Webflow and the new Wix
   connector keep their own code: moving them would force reconnects and lose
   features.
7. **Social publishing: Composio first, Post for Me as fallback** (Phase 2):
   Instagram, Facebook Pages, LinkedIn, YouTube and Pinterest through
   Composio once their capability check passes; X, Threads, TikTok (and
   Bluesky) stay on Post for Me. Provider is per account
   (`social_accounts.provider`), so existing accounts keep working.
8. **Reddit's API stays off** until Reddit grants commercial access; Community
   Intelligence finds threads through search and open APIs meanwhile.

## Consequences

- New apps are a catalog entry plus the workflow that uses them; no new
  tables, keys or Settings cards.
- An app is shown only once its workflow exists. `testing` apps connect only
  where `FEATURE_FLAG_INTEGRATIONS_TESTING(_WS_<id>)=true`, until a row in
  `docs/integrations/capability-matrix.md` passes.
- Disconnecting deletes the account at Composio; Composio does not revoke the
  grant at the app, so the dialog tells the person where to remove access.
- Moving a toolkit to Mellox's own OAuth app is `COMPOSIO_AUTH_CONFIG_<TOOLKIT>`
  only; existing connections keep their auth config.
- Flags: `FEATURE_FLAG_INTEGRATIONS_ENABLED` (on unless `false`, with
  `_WS_<id>`), `FEATURE_FLAG_INTEGRATIONS_TESTING` (off unless `true`).
