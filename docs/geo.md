# SEO, AEO, and GEO

The AI Visibility system combines extraction, deterministic rules, scoring,
findings, verification, and optional AI probes. Pure engine code lives in
`src/lib/geo`; crawlers, runners, services, and fixes live in `src/server/geo`.
The UI is under `src/components/app/geo` and routes under `/api/geo`.

## Current AI Visibility model

The current GEO/AEO/SEO product is intended to behave like a measurable
visibility workflow, not a passive dashboard. The system records a site or
page state, gathers evidence from crawls and page analysis, scores the result
against deterministic rules, surfaces findings to a workspace, and then supports
fix generation and post-fix verification.

This is important because a finding is never considered complete merely because a
recommendation was proposed. The verification lifecycle is what converts a
hypothesis into a real, auditable outcome.

## Finding lifecycle

A scan creates pages/findings and stable fingerprints. Fix proposals and
batches can produce repository PRs through the GitHub connector. Only a
verification scan resolves a finding; proposal approval alone does not.
Scores are server-computed and browsers cannot write audit scores directly.

## Rendering and probes

Browser rendering is a fallback for empty client-side shells and is disabled by
feature flag unless configured. AI answer probes are paid calls and are disabled
by default. Both paths use SSRF-guarded fetching and explicit budgets.

Current detailed references: [geo-intelligence](geo-intelligence.md),
[validation rules](VALIDATION_RULES.md), [deterministic scoring](DETERMINISTIC_SCORING_AND_TRACEABILITY.md),
and [fix engine](FIX_ENGINE.md). Older Raval AI naming in those documents is
historical terminology, not a separate runtime product.
