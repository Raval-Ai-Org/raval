# Social publishing and integrations

## Distribution model

Mellox AI is the editorial front end. Approved content is published through a
configured distribution provider, currently supporting the SDR proxy path and
SocialAPI path in server code. Credentials and platform OAuth tokens remain
server-side. The browser receives mapped status, never provider tokens or raw
responses.

Publishing and scheduling routes are under `/api/sdr`; social connection,
metrics, analytics, retry, and creator routes are under `/api/social`. The
publish route requires editor role, validates workspace-owned content and
accounts, respects provider flags, and consumes plan credits.

## Webhooks and reconciliation

SDR and SocialAPI callbacks are public hook routes with signature/tolerance
checks. SDR delivery applies idempotently and terminal statuses win over stale
retries. The reconciliation hook repairs pending/publishing records when a
provider callback is late. Exact contracts live in
`docs/specs/001-sdr-integration/contracts/`.

## Other integrations

- GitHub App: source ownership, repository context, callbacks, webhooks, and PR-based writes.
- Google Analytics/Search Console: OAuth callback, encrypted token storage, sync runs, and aggregates.
- Firecrawl/Tavily/Pexels/Unsplash: server-side intelligence or media providers.

The full external SDR runtime is not in this repository. Its availability,
platform approval state, and production credentials must be verified outside
this codebase.
