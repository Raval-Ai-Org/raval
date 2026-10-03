# Mellox AI

Mellox AI is an AI-native marketing operating system for modern brands and
agencies. It brings workspace identity, Brand DNA, content operations,
analytics, AI Visibility, social publishing, and acquisition workflows into one
product surface.

The application is built with the Next.js App Router, React 19, TypeScript, and
Supabase/PostgreSQL. The server side owns credentials, provider integrations,
role checks, metering, and database writes; the browser is used for editorial
workflows and orchestration.

The workspace Canva connection and image editing workflow are documented in
[docs/canva-integration.md](docs/canva-integration.md).

## What is included in the current product

- Workspace-scoped brand context and explicit authorization checks
- Content studio and media generation flows
- AI Visibility, GEO/AEO/SEO finding and verification workflows
- Social distribution and publishing integrations
- Market signals, competitor insights, and analytics surfaces
- Backlink acquisition, verification, and credit controls
- GitHub repository ownership and source-connected fixes
- Agent-based automation with approval, grounding, and audit boundaries

## Platform at a glance

Mellox AI is built around a workspace-first operating model. Every user action
is anchored to a brand workspace, which owns Brand DNA, team permissions,
content assets, audits, and AI usage budgets. That gives the product a shared
source of truth and ensures branding, production logic, and governance remain
consistent across content, research, and distribution.

The product is designed for a practical marketing cycle:

1. Capture the brand context and shared objectives in the workspace
2. Generate or refine content, assets, and briefs with AI assistance
3. Research competitors, market signals, and channel performance
4. Improve visibility in AI search and traditional search results
5. Review, approve, and distribute work through connected channels
6. Measure results and iterate from verified evidence

This is not a generic chatbot shell. Mellox AI is oriented around repeatable
marketing operations: grounded strategy, production, verification, and
execution.

## Current repository scope

This repository is a multi-runtime product codebase, not a single app in a
single language. The active live implementation spans:

- Next.js web application, route handlers, and client surfaces in `src/`
- Supabase migrations and schema work in `supabase/`
- Python intelligence, analysis, and orchestration in `backend/`, `crawler/`,
  and the domain-engine packages under the root
- External connector and automation packages under `connectors/`
- A service-backed social distribution runtime under
  `Social-Distribtion-Engine-MelloxAI-SDE/`

The repository includes both production app logic and supporting systems that
interact with the platform, so branch boundaries and ownership should be treated
as part of the product architecture rather than as an afterthought.

## Documentation map

The authoritative documentation entry point is [docs/README.md](docs/README.md).
Use it to find the canonical references for product overview, architecture,
product flows, APIs, database, security, and deployment.

- Product overview: [docs/overview.md](docs/overview.md)
- Architecture: [docs/architecture-overview.md](docs/architecture-overview.md)
- Repository map: [docs/repository-layout.md](docs/repository-layout.md)
- Local setup: [docs/developer-guide.md](docs/developer-guide.md)
- API and data contracts: [docs/api.md](docs/api.md) and [docs/database.md](docs/database.md)
- AI and provider configuration: [docs/ai.md](docs/ai.md) and [docs/configuration.md](docs/configuration.md)
- Security and operations: [docs/security.md](docs/security.md) and [docs/operations.md](docs/operations.md)

Feature ADRs and specifications remain under [docs/adr](docs/adr/) and
[docs/specs](docs/specs/). The canonical pages identify when those documents are
historical, planning material, or currently implemented behavior.

The repository is a multi-runtime workspace rather than a single `src/` app.
See [the repository layout](docs/repository-layout.md) for ownership boundaries,
active runtimes, and rules for safely organizing packages.

## Codebase map

The Next.js application and product UI live in `src/app`, `src/components`, and
`src/hooks`. Server-side authorization, integrations, and background work live
under `src/server`; shared contracts and browser-safe logic live in `src/lib`.
Database changes are managed in `supabase/migrations`, with supporting Python
services and domain engines in the repository's other runtime packages.

See [the repository layout](docs/repository-layout.md) for ownership boundaries
and [the architecture guide](docs/architecture-overview.md) for the request and
data flow. The server owns credentials, authorization, provider calls, metering,
and persistent side effects. Workspace identity is explicit in workspace routes
and data access.

## Social publishing

Approved social content is sent through the configured server-side distribution
provider. The browser does not receive provider credentials. See the current
[social publishing guide](docs/social.md) and the
[SDR integration specification](docs/specs/001-sdr-integration/spec.md) for
provider behavior and detailed contracts.

## Quick start

```bash
npm run setup
npm run dev
```

Setup instructions, environment handling, and validation commands are in the
[developer guide](docs/developer-guide.md). Never commit `.env` or credentials;
see the [configuration reference](docs/configuration.md) and
[team credential guidance](docs/TEAM-CREDENTIALS.md).
