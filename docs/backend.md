# Backend architecture

## Request handling

Authenticated HTTP routes should use `defineRoute` from `src/server/route.ts`.
The kernel authenticates the Supabase bearer token, parses Zod body/query
schemas, checks workspace membership and minimum role, applies rate limits,
then calls the handler. Known errors become stable JSON status responses;
unknown errors are logged server-side and returned as a generic 500 response.

The backend is not just a transport layer. It is the enforcement layer for the
product: it validates user identity, workspace membership, provider budgets,
server-side secrets, external API calls, and database writes. The browser is the
front-end orchestration surface, while the backend is the trust boundary.

Server functions are implemented under `src/server/fns`, registered centrally,
and exposed to the browser through `src/lib/*.functions.ts` stubs over
`/api/rpc/[...fn]`. Server-only modules import `server-only` and must not be
imported as runtime code by client components.

## Trust boundaries

The backend is the trust boundary in Mellox AI. That means the server decides:

- whether the caller is authenticated,
- whether the caller belongs to the requested workspace,
- whether the caller has the required role,
- whether the request is within rate and spend limits,
- whether the requested URL or provider operation is safe,
- whether the action is grounded in valid workspace ownership,
- whether the state change is recorded and auditable.

The browser can only request, not authorize. When a route, server function, or
job writes state or calls a billing-capable provider, the consuming code must
pass through the server-enforced validation chain.

## Background work and lease coordination

The product relies on background job rows, public hook routes, and lease
coordination. In practical terms, work that takes longer than a web request is
stored in durable state and later advanced by a worker or cron-driven path.

Examples include GEO scans, competitor sweeps, content generation runs, social
delivery reconciliation, analytics syncs, and UGC render completion. The
database lease pattern keeps two workers from acting on the same job at the same
time while still allowing retries and reconciliation under server control.

This is how the app stays responsive without losing the durability of long-lived
operations.

## Current backend pattern

The main backend pattern in Mellox AI is:

- authenticate the caller,
- verify workspace membership and role,
- validate payload and request context,
- apply rate limits/budget guards,
- call the server-only domain logic,
- persist state in Supabase, and
- return a normalized result or failure.

This pattern is used across chat, Studio, GEO, distribution, and connector work.

## Data access

`client.user.server.ts` creates an RLS-bound client from the caller JWT.
`client.server.ts` exposes the service-role client for explicit service paths.
The default is the user client; service-role use should be auditable and
workspace-scoped.

## Workers and external calls

Background systems use public hook routes, scheduled jobs, and claim functions
with leases. Provider-specific calls belong in gateways or integration modules:
AI gateways, safe URL fetching, GitHub API, Google OAuth/analytics, SDR,
SocialAPI, Firecrawl, KIE, Pexels, and Unsplash. Do not call these providers
from a browser component.

## Error and retry semantics

Zod errors are 400, authentication failures are 401, permission failures are
403, upstream failures preserve a mapped status, rate and budget failures are
429, and SSRF-blocked URLs are 400. Provider retry behavior is local to its
adapter; job retries must be idempotent and persist state. TODO: document
provider-specific retry counts after verifying each adapter.
