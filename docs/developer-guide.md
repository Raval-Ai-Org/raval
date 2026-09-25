# Developer onboarding

## Prerequisites

Use a supported Node.js/npm environment and access to the team-managed local
`.env`. Do not copy secrets into commits or documentation.

```bash
npm run setup
npm install
npm run dev
```

The development server normally runs at `http://localhost:8080`. Setup checks
for placeholder values and dependencies. Authentication requires real Supabase
configuration and a test account.

## Daily validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Use `npm run db:verify` for migration work, `npm run db:types` after schema
changes, and focused Vitest/Playwright commands before the full suite. Use
`npm run test:live` only with approved real service credentials.

## Working effectively in this repo

This repository is intentionally multi-runtime. If you are making changes, check
which layer owns the feature before editing:

- Product UI, routing, and client flows: `src/app`, `src/components`, `src/hooks`
- Server-side logic and authorization: `src/server`, `src/server/fns`, and route
  layers
- Shared logic, contracts, and prompts: `src/lib`
- Database migrations and schema work: `supabase/migrations`
- Python analysis and crawling systems: `backend`, `crawler`, and domain-engine
  packages
- Separate social distribution runtime: `Social-Distribtion-Engine-RavalAI-SDE/`

When a change crosses layers, keep the ownership boundaries explicit and do not
mix browser logic with service credentials or privileged runtime behavior.

## Contribution standards

Keep changes within the owning module, preserve server/client boundaries, use
`defineRoute` for authenticated API routes, use workspace-aware paths and query
keys, route paid AI calls through gateways, and add tests for authorization,
RLS, idempotency, and failure states. Use ADRs for durable architecture
changes. Do not commit `.env`, generated secrets, or unrelated formatting.

## Git and GitHub workflow

Create a focused branch, keep commits reviewable, run the relevant checks, and
open a pull request with migration/security/operational notes. GitHub connector
writes use the application's controlled branch/PR path; this is separate from
engineering repository contribution workflow. TODO: confirm the organization's
branch naming, required reviewers, and merge policy.
