# Security guide

## Security model

Mellox AI treats security as a product boundary, not a side concern. The web
browser is never the authority for privileged actions. Real permissions,
provider access, workspace ownership checks, and side-effectful operations are
validated on the server before data is changed or an external provider is
called.

## Data classification

The repository's security model assumes three main classes of data:

- Workspace data: content, Brand DNA, approvals, assets, settings, and member
	ownership information.
- Sensitive operational data: tokens, webhook secrets, OAuth metadata, service
	account credentials, and provider keys.
- External evidence data: search results, crawled pages, provider responses, and
	integration metadata used to inform decisions.

Only the server layer should touch the second category. The first and third
categories must stay scoped to a verified workspace and be treated as untrusted
unless the server has validated them and the feature specifically needs them.

## Provider and integration boundaries

All outbound provider calls are expected to pass through approved adapters or
gateways. This includes AI providers, GitHub, Google, Tavily, Firecrawl,
distribution providers, media providers, and analytics services. Direct calls
from the browser are not accepted as the product design.

The reason is straightforward: a browser-safe API surface cannot safely enforce
budget, approval, provider authorization, or data hygiene rules. Provider trust
is therefore not an app-level UX concern; it is a server-side engineering
decision.

## Authentication and authorization

Supabase bearer tokens authenticate API requests. Workspace membership and roles
(`owner`, `admin`, `editor`, `viewer`) are checked before workspace operations;
side effects use an editor-or-higher boundary where configured. RLS is the
second enforcement layer. Authentication is not a substitute for workspace
authorization.

## Secrets

Never commit `.env`, publish secret values, put provider credentials in
`NEXT_PUBLIC_*`, or return tokens/raw provider responses. Server-only modules
own service-role keys, AI keys, OAuth secrets, webhook secrets, and encryption
keys. Use the repository's credential-sharing procedure without copying real
values into documentation.

## SSRF and untrusted input

User-supplied URLs go through `src/server/safe-fetch.ts`. Prompt context and
scraped text are fenced as untrusted data. Webhook signatures are checked over
the raw request body with timing-safe comparison before state changes.

## Webhooks, writes, and audit

GitHub and distribution writes are server-mediated, workspace-scoped,
idempotent, and audited. GitHub source writes create reviewable branches/PRs;
they do not push or merge a base branch. Public hooks require cron or provider
verification as appropriate.

## Security TODOs

- TODO: confirm retention/deletion/export policy with legal/product.
- TODO: document incident contacts in a private runbook, not public repository docs.
- TODO: add automated documentation scanning for secret-shaped values and broken links.
