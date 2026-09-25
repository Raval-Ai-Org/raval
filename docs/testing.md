# Testing and QA

## Available checks

- `npm run typecheck`: TypeScript validation.
- `npm run lint`: ESLint validation.
- `npm test`: Vitest unit/contract tests.
- `npm run test:live`: opted-in real service/database tests.
- `npm run test:visual`: Playwright visual suite.
- `npm run test:seo`, `npm run test:sitemap`, `npm run test:robots`, `npm run test:hreflang`: SEO/public output checks.
- `npm run db:verify`: migration baseline/replay verification.
- `npm run eval`: Promptfoo model/security evaluations.

## Testing model for Mellox AI

The project relies on a multi-layer QA model because the product spans UI,
workflows, route validation, provider integrations, and database policy changes.
A change is not considered safe just because a page renders; it must also pass
through the relevant contract, authorization, migration, and runtime checks.

Focused tests exist for navigation/library, AI route selection and metering,
GEO scan/agent behavior, and related contracts. Tests must not print secrets or
call paid providers accidentally; live tests require explicit environment
configuration.

## Change-level expectations

Route/schema changes need contract and authorization coverage. Migration changes
need RLS, idempotency, type regeneration, and database verification. AI changes
need budget/metering behavior and prompt/security checks. User-facing changes
need loading/error/empty states and targeted Playwright coverage.

TODO: publish a coverage threshold and CI matrix after confirming the deployment
pipeline's actual required gates.
