# Product overview

Mellox AI is an AI-native marketing platform for a brand workspace. The current
application combines brand-grounded content work, marketing intelligence,
SEO/AEO/GEO visibility, media generation, analytics, and social distribution.
The product is implemented as a Next.js App Router application backed by
Supabase/PostgreSQL.

## Product boundaries

A workspace is the tenant and the source of brand identity. Workspace-scoped
requests must carry an explicit workspace id and verify membership before data
access or paid AI work. The browser is an editorial and orchestration surface;
server modules own credentials, provider calls, metering, authorization, and
persistent state.

Current product surfaces are visible in `src/app`, `src/components/app`, and
`src/app/api`: projects/workspaces, chat, library/content, Studio, analytics,
GEO/AEO/SEO, connectors, agents, social distribution, and UGC media.

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
