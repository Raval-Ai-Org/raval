# Documentation audit record

**Audit date:** 2026-09-24

## Scope

Audited the current Next.js routes, server modules, client feature surfaces,
Supabase migrations/RLS patterns, environment schema, provider gateways,
background hooks, tests, deployment artifacts, and the current `docs` material.
The repository contains a mixed set of active product documentation, canonical
reference guides, ADRs, specs, validation records, and historical planning
material that should not be treated as current behavior without revalidation.

## Findings and fixes

- Added and refreshed a canonical Mellox AI documentation index and modular
  current-state guides for the active product.
- Realigned the docs around current workspace-first, server-backed architecture,
  security boundaries, and product workflows.
- Clarified the distinction between current implementation guidance and
  historical Raval AI planning material.
- Updated the contributor-facing docs to emphasize the actual runtime layers:
  web app, server enforcement, provider gateways, Supabase schema, Python
  services, and the separate social distribution runtime.
- Removed stale assumptions and improved the navigation of the main canonical
  guides.
- Checked canonical relative links and confirmed the documentation set remains
  free of secret-shaped values in the active pages.
- Verified the documentation patch passes a repo-level whitespace check.

## Residual risks and TODOs

- Some historical deep-reference documents still contain legacy Raval AI
  naming and should be treated as historical unless revalidated against current
  runtime behavior.
- The repository does not prove a single production hosting topology, release
  policy, SLO set, retention schedule, privacy notice, pricing sheet, or final
  component catalog. These remain explicit TODOs in the relevant guides.
- Live database/provider verification remains an operational requirement before a
  production release.

## Current canonical status

The canonical current-state documentation is now centered on the active product
implementation and the repository's actual runtime boundaries. Historical records
and planning specs remain available for context, but they are intentionally not
used as the primary source of truth for current product behavior.
