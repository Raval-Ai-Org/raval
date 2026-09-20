# Backend architecture

## Request handling

Authenticated HTTP routes should use `defineRoute` from `src/server/route.ts`.
The kernel authenticates the Supabase bearer token, parses Zod body/query
schemas, checks workspace membership and minimum role, applies rate limits,
then calls the handler. Known errors become stable JSON status responses;
unknown errors are logged server-side and returned as a generic 500 response.

Server functions are implemented under `src/server/fns`, registered centrally,
and exposed to the browser through `src/lib/*.functions.ts` stubs over
`/api/rpc/[...fn]`. Server-only modules import `server-only` and must not be
imported as runtime code by client components.

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
