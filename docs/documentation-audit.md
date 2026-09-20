# Documentation audit record

**Audit date:** 2026-09-20

## Scope

Audited the current Next.js routes, server modules, client feature surfaces,
Supabase migrations/RLS patterns, environment schema, provider gateways,
background hooks, tests, deployment artifacts, and existing `docs` material.
The repository contains 82 API route handlers, 91 migration files, and a mixed
set of current ADRs, feature specifications, validation records, and historical
planning documents.

## Findings and fixes

- Added a canonical Mellox AI documentation map and modular current-state guides.
- Indexed all major API route families and documented representative request/response contracts.
- Added architecture, codebase, frontend, backend, database, AI, workspace, agent, media, social, GEO, security, configuration, deployment, operations, testing, flow, analytics, privacy, performance, component, developer, troubleshooting, glossary, and release references.
- Marked old Raval AI architecture and launch material as historical and linked current guides.
- Removed real-looking test-account credentials, historical Supabase project identifiers, and an ephemeral development tunnel hostname from documentation.
- Checked canonical relative links; no missing targets were found.
- Checked canonical pages for secret-shaped values; no secret values were found.
- TypeScript validation passed after documentation changes.

## Residual risks and TODOs

- Existing deep-reference documents still contain historical Raval AI wording and
  should be migrated only when their implementation claims are revalidated.
- The repository does not prove a single production hosting topology, release
  policy, SLO set, retention schedule, privacy notice, pricing sheet, or final
  component catalog. These remain explicit TODOs in the relevant guides.
- Live database/provider verification was not run because it requires approved
  credentials and external services. Run the live checks before a production
  release.
