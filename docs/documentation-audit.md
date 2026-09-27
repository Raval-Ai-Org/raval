# Documentation audit record

**Audit date:** 2026-09-28

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
  historical planning material.
- Updated the contributor-facing docs to emphasize the actual runtime layers:
  web app, server enforcement, provider gateways, Supabase schema, Python
  services, and the separate social distribution runtime.
- Removed stale assumptions and improved the navigation of the main canonical
  guides.
- Consolidated the root README as an entry point, removed its dated feature
  snapshot and duplicated setup/provider walkthroughs, and fixed the SDR spec
  links.
- Aligned the AI, configuration, and deployment references with the OpenRouter
  gateway decision and current environment schema.
- Replaced legacy credential-sharing instructions with least-privilege setup
  guidance and provider-owned rotation instructions.
- Verified relative links across the README and canonical documentation set;
  checked formatting for the files changed in this pass.
- Verified the documentation patch passes a repo-level whitespace check.

## Residual risks and TODOs

- Some historical deep-reference documents still contain legacy
  naming and should be treated as historical unless revalidated against current
  runtime behavior.
- Historical and planning documents were not all revalidated for source links;
  they are retained for decision history and must not override canonical guides.
- The Python `backend/` package contains provider adapters separate from the
  Next.js AI gateway. Confirm runtime ownership and provider policy before
  consolidating or removing that subsystem.
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
