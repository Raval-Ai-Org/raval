# Product overview

Mellox AI is an AI-native marketing platform for a brand workspace. The current
application combines brand-grounded content work, marketing intelligence,
SEO/AEO/GEO visibility, media generation, analytics, and social distribution.
The product is implemented as a Next.js App Router application backed by
Supabase/PostgreSQL.

## Current product focus

The live codebase is centered on a few core workflows that define the product
experience today:

- Workspace identity and Brand DNA as the source of truth for brand context
- Content generation, review, and publishing for marketing teams
- AI Visibility work across GEO, AEO, and technical SEO signals
- Social distribution, approval, and delivery monitoring
- Competitor and market intelligence for strategic recommendation
- Link acquisition and verification to support growth programs
- Repository-scoped agent workflows with approval boundaries and audit trails

## How the platform works

The platform follows a simple operating pattern:

1. A workspace defines the brand context, roles, and identity boundary.
2. Content, research, and automation flows use that context to stay on-brand.
3. AI and external tools operate behind server-side adapters with authorization,
   metering, and safety checks.
4. AI-generated work is reviewed, approved, and then published or acted on.
5. Evidence from scans, content performance, and integrations is fed back into
   the workflow for iteration.

This structure is designed to make AI useful in real marketing work without
letting unchecked browser actions or unvetted provider output drive the process.

## Core capability areas

The current implementation covers a set of product capabilities that map to the
codebase and the major product surfaces:

- Brand and workspace setup: identity, Brand DNA, team membership, routing, and
  project-level organization
- Content operations: generation, review, library organization, and media
  production
- Intelligence: analytics, market signals, competitor monitoring, and strategic
  recommendations
- Visibility: GEO, AEO, and SEO scoring, scan execution, findings, and fix
  workflows
- Distribution: social publishing, scheduling, and delivery status tracking
- Growth execution: backlink acquisition, verification, and credit-led buying
- Automation: agent-driven task execution with approval, grounding, and audit
  checks

## Product boundaries

A workspace is the tenant and the source of brand identity. Workspace-scoped
requests must carry an explicit workspace id and verify membership before data
access or paid AI work. The browser is an editorial and orchestration surface;
server modules own credentials, provider calls, metering, authorization, and
persistent state.

Current product surfaces are visible in `src/app`, `src/components/app`, and
`src/app/api`: projects/workspaces, chat, library/content, Studio, analytics,
GEO/AEO/SEO, connectors, agents, social distribution, and UGC media.

## Product lifecycle

The product lifecycle is designed to move from raw intent to reviewed,
operational output without losing the brand and audit trail. In practice the
system follows this pattern:

1. A user creates or selects a workspace and attaches the brand context.
2. The app loads that workspace state and any required Brand DNA, identity, or
  connection metadata.
3. A content, research, or growth action is initiated from a workspace-bound
  route or UI surface.
4. The server validates the request, role, rate limit, budget, and provider
  readiness before executing it.
5. The result is persisted, surfaced, and optionally approved or verified.
6. Provider delivery, workspace updates, and background jobs reconcile their
  final state back into the workspace record.

This is the operating model behind chat, GEO, publishing, social workflow, and
UGC output generation: the user chooses the next action, the system validates it,
and the server turns it into a documented, traceable outcome.

## Execution model

Mellox AI is not a single monolithic product experience. It combines a web app,
server-side enforcement, paid AI gateways, Python supporting runtimes, and
external integration services. This distribution of responsibility is intentional.

- The web layer handles user flows and UI state.
- The server layer enforces trust and executes the side effects.
- Provider adapters centralize external integration logic.
- Background workers handle async jobs, scans, polling, and lease-based
  reconciliation.
- Data stores provide durable truth, not just a view layer.

That structure is what keeps the product usable in real marketing operations:
users get a fast front end, while the server keeps the system accountable,
auditable, and safe within a tenant boundary.

## Product principles

Mellox AI is guided by a few practical principles:

- Workspace-first identity: the brand and workspace define the trust boundary.
- Server-side enforcement: secrets, budgets, and paid API work remain in server
  modules.
- Verification over optimism: results are checked before they are treated as
  evidence.
- Human approval: editorial and operational actions remain explicit and reviewable.
- Grounded execution: AI is grounded in workspace data, provider evidence, and
  authorized integrations rather than free-form assumptions.

## Positioning

The implementation supports a workflow in which a team grounds marketing work
in workspace identity, creates and reviews content and media, measures market
and channel signals, improves AI visibility, and distributes approved work. It
is not documented here as an autonomous marketing system: approvals,
workspace roles, provider availability, feature flags, and usage budgets remain
explicit control points.

## Current versus planned

- **Current:** workspace isolation, Brand DNA storage, server-side AI gateways,
  GEO scans and deterministic findings, GitHub source ownership, agent runs and
  approvals, Studio jobs, UGC renders, analytics connectors, and distribution
  proxy routes are represented in code and migrations.
- **External dependency:** the Social Distribution Engine (SDR), SocialAPI.ai,
  GitHub, Google Analytics/Search Console, AI providers, KIE, Firecrawl, and
  media providers are not all shipped in this repository.
- **TODO:** confirm customer-facing plan names, contractual data retention,
  supported production regions, and the final public product claims with the
  product owner. The codebase alone cannot establish them.

## Terminology

The canonical product name is **Mellox AI**. Older documents may say Raval AI or
RavalAI; those are historical labels unless explicitly marked current. GEO means
Generative Engine Optimization in this repository's AI Visibility feature;
AEO and SEO are related dimensions, not interchangeable product names.
