# Codebase map

| Location | Responsibility |
| --- | --- |
| `src/app/**/page.tsx` | App Router pages and route metadata |
| `src/app/api/**/route.ts` | HTTP API handlers and public hooks |
| `src/app/providers.tsx` | Query, theme, and client-wide providers |
| `src/components/**` | Client UI components; `components/app` contains product surfaces |
| `src/hooks/**` | Reusable client hooks |
| `src/lib/**` | Shared browser-safe libraries, contracts, prompts, navigation, gateways |
| `src/server/**` | Server-only route, function, worker, provider, and service modules |
| `src/integrations/supabase/**` | Supabase browser/server clients, auth middleware, generated types |
| `src/trigger/**` | Trigger.dev integration surface |
| `supabase/migrations/**` | Idempotent schema, RLS, functions, indexes, and schedules |
| `tests/**` | Playwright/integration coverage and live checks |
| `src/**/*.test.ts` | Unit and contract tests |
| `scripts/**` | Setup, validation, migration, and operational utilities |
| `docs/adr/**` | Architecture decisions |
| `docs/specs/**` | Feature specifications and contracts |

## Feature ownership map

- Workspaces and Brand DNA: `src/server/workspaces`, `src/server/fns/brand-dna.ts`, `src/components/workspace`, `workspace_*` migrations.
- AI and chat: `src/lib/ai*`, `src/server/ai`, `src/app/api/chat`, `src/app/api/ai-generate`.
- Studio and UGC: `src/server/studio`, `src/server/ugc`, `src/app/api/studio`, `src/app/api/ugc`.
- GEO: `src/lib/geo`, `src/server/geo`, `src/components/app/geo`, `src/app/api/geo`.
- Connectors: `src/server/connectors`, `src/app/api/integrations`, `src/components/app/connectors`.
- Distribution: `src/server/sdr`, `src/lib/socialapi`, `src/app/api/sdr`, `src/app/api/social`.
- Analytics: `src/server/analytics`, `src/app/api/social/analytics`, Google callback and sync hooks.
- Agents: `src/server/agents`, `src/server/geo/agents`, `src/app/api/agents`, public agent hooks.

## Naming and source of truth

When code, a migration, and a document disagree, verify the current route,
service, or migration first. Generated Supabase types are derived from the
schema and should be regenerated with `npm run db:types` after schema changes.
