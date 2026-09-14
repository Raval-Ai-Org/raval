# GitHub connector (website sources)

GitHub is the first **website source connector**: a workspace connects the
repository that builds its website so Mellox can later inspect it, propose
AI-visibility fixes, open a pull request and rescan after the user merges.

This phase delivers the **connection only**. Mellox reads repository metadata
and a handful of file paths; it never writes to a repository, creates a branch
or opens a pull request. Decision record:
[ADR-0011](adr/0011-github-app-website-connector.md).

## Planned workflow and what ships now

| Step                                        | Status                                        |
| ------------------------------------------- | --------------------------------------------- |
| Connect GitHub (App install)                | Shipped                                       |
| Choose repository, branch, site URL         | Shipped                                       |
| Inspect source (framework, discovery files) | Shipped — read-only, names only               |
| Analyze with AI Visibility scans            | Existing GEO engine (crawls the live site)    |
| Propose code changes                        | Next phase                                    |
| Create branch + pull request                | Next phase (App already holds the permission) |
| User merges, Mellox rescans                 | Next phase (webhook + rescan-and-compare)     |

## Architecture

```
src/lib/connectors/types.ts                client-safe provider registry + view types
src/lib/connectors.functions.ts            RPC stubs + BroadcastChannel helpers
src/server/connectors/github/
  config.server.ts                         env parsing/validation (never echoes values)
  api.server.ts                            App JWT, installation tokens, GitHub REST client
  service.server.ts                        install state, linking, repos, sources, inspection, audit
  webhook.ts                               signature verification + event handling (pure, injected deps)
  inspect.ts                               framework + discovery-file detection (pure)
src/server/connectors/present.ts           row → view mapping (whitelists URLs)
src/server/connectors/source-context.server.ts   GEO boundary: getSiteSourceContext(host)
src/server/fns/connectors.ts               server functions (auth, roles, rate limits)
src/app/api/integrations/github/webhook    POST webhook receiver
src/app/api/integrations/github/callback   GET → forwards to the callback page
src/app/integrations/github/callback       client page that completes the install
src/components/app/connectors/             GitHubConnector (Integrations dialog), install callback UI
```

The UI lives in **Workspace → Integrations** (sidebar), in the existing
Integrations dialog. WordPress, Webflow, Shopify and Framer appear there as
"coming soon"; they are entries in `CONNECTOR_PROVIDERS` and allowed values of
`workspace_connections.provider`, with no implementation.

## Connection flow

1. An **admin** clicks _Connect GitHub_. `startGithubInstall` stores a random,
   single-use state (SHA-256 hash only) in `connector_install_states`, bound to
   the user and workspace for 20 minutes, and returns
   `https://github.com/apps/<slug>/installations/new?state=…`.
2. GitHub opens in a popup. The user picks the account and repositories.
3. GitHub redirects to the App's Callback/Setup URL
   (`/api/integrations/github/callback`), which forwards `installation_id`,
   `setup_action`, `state` and `code` to `/integrations/github/callback`.
   Sessions live in the browser, so a client page finishes the install with
   the signed-in user's token. A signed-out browser is sent to sign in and back.
4. `completeGithubInstall` consumes the state (must match the user, unexpired,
   unused) and proves the user controls the installation:
   - **`oauth`** (production): exchanges `code` for a user token and requires
     the installation in `GET /user/installations`. Requires
     `GITHUB_CLIENT_SECRET` and _Request user authorization (OAuth) during
     installation_ on the App.
   - **`install_window`** (development fallback, or
     `GITHUB_INSTALL_VERIFICATION=install_window`): the installation must have
     been created or updated after the state was issued, and must not already be
     linked to another workspace.
   - **`unavailable`**: production without a client secret refuses installs.
5. The connection is upserted, the installation's repositories are synced to
   existing sources, an audit entry is written, and every open Mellox tab is
   told over the `mellox-connectors` BroadcastChannel.

Then an admin chooses a repository (verified with the installation token),
optionally sets the site URL and branch (branch verified on GitHub), and an
editor can run _Inspect source_.

## Data model

Migration `20260915090000_add_workspace_connectors.sql` (additive):

- `workspace_connections` — one row per workspace + provider + installation:
  status (`active` / `suspended` / `revoked` / `error`), account login/type/avatar,
  repository selection, granted permissions, verification mode, last verified,
  last error, revocation reason. **No tokens or secrets.**
- `workspace_sources` — a selected repository: full name, visibility, default
  branch, chosen branch, site URL/host, status (`active` / `access_lost`),
  last inspection summary (framework + file paths only, never file contents).
- `connector_install_states` — hashed install states; service role only.

RLS: workspace members can `SELECT` connections and sources. All writes go
through server functions using the service role after a role check.

## Tokens and credentials

- The App JWT (RS256, 9 minutes) and installation tokens (1 hour) are minted
  server-side and cached **in memory** only, dropped 5 minutes before expiry,
  and re-minted once on a 401. Nothing is persisted.
- Credentials are only ever sent to `https://api.github.com` (redirects refused,
  15 s timeout).
- Responses to the browser are mapped views (`present.ts`); raw GitHub
  responses never leave the server.
- `src/server/env.ts` refuses `NEXT_PUBLIC_*` names that look like the private
  key, webhook secret or client secret.

## Authorization

| Action                                                     | Minimum role |
| ---------------------------------------------------------- | ------------ |
| View connections and sources                               | member       |
| List repositories, verify connection, inspect source       | editor       |
| Connect, choose/remove repository, edit source, disconnect | admin        |

Rate limits: `connector` (30/min) for GitHub-calling reads, `connector-connect`
(10 per 10 min) for install start/complete. Non-members get **403**, signed-out
callers **401**.

## Webhooks

`POST /api/integrations/github/webhook`

- Verifies `X-Hub-Signature-256` (HMAC SHA-256, constant-time) — **401** on
  mismatch; **503** when `GITHUB_WEBHOOK_SECRET` isn't set; **413** over 1 MB.
- Each verified delivery claims `X-GitHub-Delivery` in `sdr_webhook_events`
  (provider `github`) — replays return `{duplicate: true}`. Rejections are
  recorded without a delivery id.
- Events:
  - `installation.deleted` → connections `revoked`, sources `access_lost`, token dropped
  - `installation.suspend` / `unsuspend` → `suspended` / `active`
  - `installation.new_permissions_accepted` → permissions refreshed
  - `installation_repositories.removed` / `added` → sources `access_lost` / restored
  - `ping` → `{pong: true}`
- Webhooks never create or link a connection; unknown installations are ignored.
- A handler error returns 500 so GitHub retries (handlers are idempotent).

## Disconnect and revoked access

_Disconnect_ marks the connection `revoked` and its sources `access_lost`
inside Mellox; the App stays installed on GitHub (the dialog links to
_Manage on GitHub_ to uninstall). Uninstalling on GitHub has the same effect via
webhook. Any GitHub 401/403/404 for an installation surfaces as
`GitHubAccessError` and marks the connection `error` / `revoked` with a
reconnect prompt, never a 500.

## GEO boundary

`getSiteSource` / `getSiteSourceContext(workspaceId, host)` returns the
connected repository for a scanned site host, with
`capabilities: { inspect: true, proposeChanges: false }`. AI Visibility keeps
crawling the live website; no code-level scanning exists yet and the UI does
not claim it.

## Environment

| Variable                      | Required   | Notes                                                          |
| ----------------------------- | ---------- | -------------------------------------------------------------- |
| `GITHUB_APP_ID`               | yes        | Numeric App ID                                                 |
| `GITHUB_APP_SLUG`             | yes        | From `github.com/apps/<slug>`                                  |
| `GITHUB_APP_NAME`             | no         | Display name                                                   |
| `GITHUB_APP_PRIVATE_KEY`      | yes        | PEM; multiline, `\n`-escaped or base64 accepted                |
| `GITHUB_WEBHOOK_SECRET`       | yes        | Webhooks rejected (503) without it                             |
| `GITHUB_CLIENT_ID`            | production | OAuth verification of installers                               |
| `GITHUB_CLIENT_SECRET`        | production | Without it production refuses installs                         |
| `GITHUB_INSTALL_VERIFICATION` | no         | `install_window` to allow the weaker check outside development |

Missing or invalid configuration shows a "not configured" notice in the
Integrations dialog listing variable **names** only.

## GitHub App settings

- **Permissions** (repository): Metadata _read_, Contents _read & write_,
  Pull requests _read & write_. Write access is for the next phase and unused now.
- **Callback URL** and **Setup URL**: `<APP_URL>/api/integrations/github/callback`
- **Request user authorization (OAuth) during installation**: on
- **Webhook URL**: `<APP_URL>/api/integrations/github/webhook`, with the webhook secret.
  `installation` and `installation_repositories` events are delivered to Apps
  automatically.
- **Where can this App be installed**: _Any account_ for customers outside the
  owner's account.

## Tests

- Unit: `src/server/connectors/github/github.test.ts` — config parsing, JWT,
  signature verification, webhook handler events, inspection.
- Live (opt-in, read-only): `tests/live/github-app.live.ts` — App auth and
  permission subset, installation tokens and repository access, unknown
  installation → `GitHubAccessError`, connector tables reachable.
