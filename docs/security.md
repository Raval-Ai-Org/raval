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

The browser client disables Supabase's automatic URL session detection because
Mellox's callback and recovery pages own the exchange. Both capture credentials
once, remove them from the address bar before asynchronous work, and reuse a
single pending operation when React replays an effect. PKCE exchanges pass the
raw authorization code and the captured `sb_flow_id` explicitly so concurrent
flows use their own verifier. Supabase validates the credentials and persists
the session; the client-side guards do not replace provider verification.
Invalid recovery links cannot fall back to an unrelated existing session.

Sign-out checks Supabase's result before clearing context or redirecting. If
revocation fails, Mellox keeps the current account open and offers retry.
Successful sign-out clears account context independently from local and session
storage; failure to access one store does not prevent clearing the other.

Implementation: `src/integrations/supabase/client.ts`, `src/lib/auth-code.ts`,
`src/lib/password-recovery.ts`, `src/app/auth/callback/AuthCallbackPage.tsx`, and
`src/app/reset-password/ResetPasswordPage.tsx`. Regression coverage is in
`src/lib/password-recovery.test.ts` and
`tests/integration/password-recovery.spec.ts`.

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

## AI assistants (MCP)

`/api/mcp` lets an assistant act as a signed-in member (see [mcp.md](mcp.md)).
It is off per workspace until an admin enables it, tools call the app's own
functions so role, plan and credit checks still apply, assistant tokens are
refused on every other route, unapproved content cannot be scheduled or
posted, and every call is recorded in the append-only `mcp_tool_calls`.

## Security TODOs

- TODO: confirm retention/deletion/export policy with legal/product.
- TODO: document incident contacts in a private runbook, not public repository docs.
- TODO: add automated documentation scanning for secret-shaped values and broken links.
