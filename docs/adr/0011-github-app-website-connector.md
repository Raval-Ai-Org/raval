# ADR-0011: GitHub App as the first website source connector

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

AI Visibility (ADR-0010) finds problems on a live website but cannot fix them.
The planned workflow is: connect the site's source → inspect → analyze →
propose changes → branch → pull request → the user merges → Mellox rescans.
GitHub comes first; WordPress, Webflow, Framer and Shopify follow.

Constraints: no separate auth system or database, no credentials in the
browser, tenant isolation on every call, and no repository writes until the
proposal phase.

## Decision

1. **A GitHub App, not OAuth Apps or personal tokens.** Installation tokens
   are scoped to the repositories the customer picks, expire after an hour, and
   are revoked by uninstalling. Requested permissions are the minimum for the
   full workflow: Metadata read, Contents read/write, Pull requests read/write.
   Write access is granted now so customers don't re-consent later; this phase
   never uses it.
2. **Store no tokens.** App JWTs and installation tokens are minted on demand
   and cached in server memory. The database keeps the installation id, account
   display fields, granted permissions and status.
3. **Prove the installer controls the installation.** An `installation_id`
   in a redirect is attacker-controlled. Production requires GitHub OAuth during
   installation and checks `GET /user/installations`. Development falls back to
   a timing check (installation created or updated after the state was issued,
   not linked elsewhere); production refuses installs without the client secret.
   The install state is random, hashed, single-use, 20-minute, and bound to the
   user and workspace.
4. **Client-side callback page.** Mellox sessions are bearer tokens in
   `localStorage`, so the GitHub redirect lands on an API route that forwards to
   a client page, which completes the install with the user's token.
5. **Webhooks only update known connections.** Uninstall, suspend, repository
   removal and permission changes update status; nothing is created from a
   webhook. Deliveries are deduplicated in the existing `sdr_webhook_events`
   receipt log rather than a new table.
6. **Generic tables, one implementation.** `workspace_connections` and
   `workspace_sources` carry a `provider` column that already allows the future
   providers, and the UI reads a provider registry. No other provider code
   exists yet.
7. **Thin GEO boundary.** `getSiteSourceContext(workspaceId, host)` links a
   scanned site to its repository and advertises capabilities
   (`inspect: true, proposeChanges: false`). The GEO engine is unchanged.

## Consequences

- Production needs `GITHUB_CLIENT_SECRET` and the App's OAuth-during-install
  setting before customers can connect.
- A server restart drops cached tokens; they are re-minted on the next call.
- One installation may serve several workspaces only when OAuth verification
  proves the same user controls it.
- Disconnecting in Mellox doesn't uninstall the App on GitHub; the UI links to
  GitHub for that.
- The proposal phase adds branch/PR creation behind explicit user approval and
  will use the stored `branch` and `inspection` fields.

Reference: [docs/github-connector.md](../github-connector.md).
