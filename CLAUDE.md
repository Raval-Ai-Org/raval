# Mellox AI — notes for Claude Code sessions

AI Marketing Intelligence platform. Next.js 16 App Router (read
`node_modules/next/dist/docs/` before using Next APIs — this version differs
from older training data), React 19, TypeScript strict, Tailwind v4, Supabase.

## Conventions that are enforced

- **Routes:** authenticated `/api` handlers use `defineRoute` (`src/server/route.ts`):
  auth → validate (zod) → workspace membership/`minRole` → rate limit → handler.
  Side effects need `minRole: "editor"`. Cron hooks use `defineCronRoute`.
- **Server functions:** `createServerFn().middleware([requireSupabaseAuth])` in
  `src/server/fns/<module>.ts`, registered in `src/server/fns/index.ts`, called
  from the browser through stubs in `src/lib/<module>.functions.ts`.
- **Server/client boundary:** server modules import `server-only` and are named
  `*.server.ts` or live under `src/server/**`; components may only `import type`
  from them (ESLint enforces).
- **Database:** RLS user client by default; `supabaseAdmin` only inside workers,
  cron and explicit service paths. Every table has RLS. Migrations are
  idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) — `npm run db:verify`
  replays them; `npm run db:types` regenerates `src/integrations/supabase/types.ts`.
- **Fetching user-supplied URLs:** only via `src/server/safe-fetch.ts` (SSRF guard).
- **Paid AI calls:** only through the gateways (`src/lib/ai-gateway.server.ts`,
  `anthropic-gateway.server.ts`, `kie-gateway.server.ts`) — they meter and
  budget-check. Declare a rate-limit tier for anything that spends.
- **Cross-component events:** declare in `src/lib/app-events.ts`, use `emitAppEvent`.
- **Design:** icons from `@/components/icons` (bespoke Mellox set, lucide fallback);
  primary colour is Ultra Moss lime in both themes; use `EmptyState` /
  `ErrorState` / `Skeleton` for states; feature surfaces are `AppModalShell` modals.
- **Background work:** no queue service — job rows with leases claimed via
  SKIP LOCKED RPCs, advanced by pg_cron → `/api/public/hooks/*` and `after()`.

## AI Visibility (GEO / AEO / SEO)

Full reference: [docs/geo-intelligence.md](docs/geo-intelligence.md), decision
record [ADR-0010](docs/adr/0010-ai-visibility-geo-intelligence.md).

- Pure engine `src/lib/geo/` (extract → analyze → `rules.ts` → `score.ts`);
  worker `src/server/geo/` (crawler, lease-based `scan-runner.server.ts`,
  `service.server.ts`); routes `src/app/api/geo/scans/**`; RPC `src/server/fns/geo.ts`;
  UI `src/components/app/GeoAeoPanel.tsx` + `src/components/app/geo/`.
- Rule ids and finding fingerprints are **stable** — add rules, don't rename.
  Every `fixId` must have a recipe in `fix-recipes.ts` (a test enforces it).
- Scores are server-computed; never let the browser write `geo_audit_runs`.
- AI answer probes are paid and flagged off (`FEATURE_FLAG_GEO_AI_PROBES_ENABLED`).
- The runner is tested against `store.memory.ts`; keep it store-agnostic.
- Fix workflow (ADR-0012): `src/server/geo/fixes/` (targets → generate → validate →
  PR → verify), RPC `src/server/fns/geo-fixes.ts`, UI `geo/FindingDetail.tsx`.
  "Fix all" = `batch.server.ts` + `geo/FixAllPanel.tsx`: one PR, one approval,
  per-finding verification. Batch member proposals are approved only via their batch.
  **Only a verification scan resolves a finding** (`verify.server.ts`); never set
  `geo_finding_states.state = 'resolved'` anywhere else (RLS refuses browsers).
- Browser rendering is a fallback for empty client-side shells only
  (`render.server.ts`, flag `FEATURE_FLAG_GEO_RENDERING_ENABLED`); every browser
  request is fulfilled through the SSRF-guarded fetcher.

## Website source connectors (GitHub)

Full reference: [docs/github-connector.md](docs/github-connector.md), decision
record [ADR-0011](docs/adr/0011-github-app-website-connector.md).

- Server code in `src/server/connectors/`; RPC `src/server/fns/connectors.ts`;
  webhook `src/app/api/integrations/github/webhook`; UI in Settings → Connections
  (`src/components/app/connectors/`), and contextually from a finding's "Fix this".
- Never persist or return GitHub tokens, keys or raw API responses — map rows
  through `present.ts`. Only `api.server.ts` talks to `api.github.com`.
- Role checks use `requireWorkspaceRole` (throws `ForbiddenError` → 403).
- Repository writes go only through `git.server.ts`: new `mellox/` branches,
  paths checked by `paths.ts`, exact-content approval, a PR — never a push to or
  merge of a base branch. Every write is audited (`src/server/audit.server.ts`).

## Verifying work

Unit tests, typecheck and build are necessary but not sufficient. Before
calling a feature done: apply new migrations to the real database
(`supabase migration list --db-url "$SUPABASE_DB_URL"`, dry-run then push),
exercise the real path (`npm run test:live`, e.g. `tests/live/geo-scan.live.ts`),
and check the routes on a dev server (the `verify` launch config runs a second
server on 8081 with `NEXT_DIST_DIR=.next-verify`). Say plainly what could not
be verified (e.g. flows that need a real user login).

```bash
npm run dev            # :8080
npm run typecheck && npm run lint && npm test && npm run build
npm run db:verify
npm run test:live      # real Supabase / providers, opt-in
```
