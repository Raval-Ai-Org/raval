# Repository layout

This repository contains the Mellox AI web application and supporting Python
services. The folders below are grouped by ownership and runtime. A folder's
location at the repository root does not by itself mean it is legacy.

## Active runtimes

| Area                        | Location                                                                                               | Ownership                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Mellox web application      | `src/`                                                                                                 | Next.js App Router, React UI, server functions, API routes, and domain logic              |
| Supabase database           | `supabase/`                                                                                            | Migrations, database seed/baseline material, and generated database assets                |
| Python intelligence backend | `backend/`                                                                                             | FastAPI application, persistence, extraction, analysis, and orchestration                 |
| Python crawler              | `crawler/`                                                                                             | Crawl configuration, fetching, discovery, robots, sitemap, and queue behavior             |
| Python domain packages      | `analytics/`, `content-engine/`, `entity-engine/`, `fix-engine/`, `opportunity-engine/`, `validation/` | Compatibility facades and domain packages backed by the Python application                |
| Python connector system     | `connectors/`                                                                                          | Connector contracts, execution, security, reliability, GitHub, and WordPress integrations |
| Social Distribution Engine  | `Social-Distribtion-Engine-RavalAI-SDE/`                                                               | Separate FastAPI/Celery service for platform delivery; deployed and tested independently  |

## Supporting areas

| Area                                | Location                                                                               | Purpose                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Browser and integration tests       | `tests/`                                                                               | Python crawler tests and Next.js end-to-end, integration, and visual tests             |
| Product and technical documentation | `docs/`                                                                                | Current guides, ADRs, specifications, runbooks, and historical implementation records  |
| Deployment and local operations     | `deploy/`, `scripts/`, `docker-compose*.yml`, `Dockerfile`, `amplify.yml`, `Caddyfile` | Provisioning, checks, migration helpers, containers, and hosting configuration         |
| Static web assets                   | `public/`                                                                              | Files served by the Next.js application                                                |
| Audit and validation records        | `audit/`, `validation/`, root `*-REPORT.md` files                                      | Review output and historical verification records; they do not define runtime behavior |
| Evaluation fixtures                 | `evals/`                                                                               | Prompt evaluation configurations and test fixtures                                     |

## Source-of-truth rules

- New web product behavior belongs under `src/` unless it is explicitly part of
  the separate SDR service or Python backend.
- New database behavior belongs in an idempotent migration under
  `supabase/migrations/`; generated Supabase types belong under
  `src/integrations/supabase/`.
- Python crawler, extraction, and deterministic intelligence behavior belongs
  in the Python packages listed above. Keep imports stable until a package is
  deliberately migrated.
- The SDR service is a separate deployable runtime. Changes to it must be
  validated from its own directory and through the `sdr` CI job.
- `docs/` is the navigation layer, not an implementation layer. Start at
  [the documentation index](README.md), and treat audit reports and older
  specifications as historical unless a current guide points to them.
- The repository should remain readable as a product map: the app ships the
  experience, while the Python modules and distribution service provide the
  operational and intelligence layer behind it.

## Safe organization workflow

Before moving a directory, search for imports, CI working directories, Docker
build contexts, documentation links, and Python path configuration. Prefer
updating ownership documentation first; relocate a package only together with
its tests, deployment configuration, and import paths.

## Canonical rule for documentation

When in doubt, prefer the current canonical guides in `docs/` and the actual
code under `src/` and `supabase/` over older historical notes. The historical
project documents remain useful for context, but they should not override the
current architecture or runtime boundaries enforced by the repository itself.
