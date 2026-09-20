# Security guide

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
