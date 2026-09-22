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

## Workspaces (one brand = one isolated workspace)

Decision record [ADR-0014](docs/adr/0014-canonical-workspaces.md).

- **Identity comes from the URL, never storage.**
  - Workspace pages are `/w/<id>/app/...`; build every link with
    `src/lib/workspace/paths.ts`.
  - Components get the workspace from `useWorkspace()` /
    `useOptionalWorkspaceId()` (`src/components/workspace/WorkspaceProvider.tsx`).
  - `workspace:last-opened` is a highlight only.
  - Never fall back to "first/newest/last" workspace.
- **Home is `/projects`.** Sign-in and app roots land there.
- **Create, list and delete** only go through
  `src/server/workspaces/service.server.ts`:
  - create uses the idempotent, domain-deduplicated
    `private.create_workspace_for_user`;
  - list uses `workspace_overview()`;
  - delete is owner-only and needs `CONFIRM`.
- **Brand DNA is in `workspace_brand_dna`.** Read and write it via
  `src/server/fns/brand-dna.ts` or `use-brand-dna.ts`, and load it on the server
  for AI by the verified workspace id.
- **Every request that touches workspace data or spends AI** takes an explicit
  workspace id and verifies it (`auth: "workspace"` / `requireWorkspaceRole`).
  Async results save to the id captured at request start.
- **React Query keys** for workspace data include the workspace id; the provider
  removes them on switch.
- **Service-role reads of user-editable `meta`** (storage paths, provider ids)
  must check they belong to the row's workspace (`src/lib/workspace/storage-path.ts`).

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
- GEO Engineer coding agent ([ADR-0013](docs/adr/0013-geo-coding-agent-and-repo-ownership.md)):
  `src/server/geo/agents/`:
  - tool loop `claudeToolLoop` in `anthropic-gateway.server.ts`;
  - read-only `repo-tools.server.ts`;
  - stages in `geo-coding-agent.ts`;
  - leased `runner.server.ts`;
  - `service.server.ts`;
  - RPC `src/server/fns/geo-agent.ts`, UI `geo/agent/AgentPanel.tsx`.
  Model `GEO_AGENT_MODEL` (default `claude-sonnet-5`). Rules:
  - **Ownership first:** no proposal, batch or run unless
    `src/lib/connectors/ownership.ts` verified the repository builds that host
    (`assertSourceOwnsHost`).
  - **Plans:** they may only change files the agent read this run.
  - **Approval:** it binds the plan hash, then the exact patch hash.
  - **Grounding:** agent patches go through `fixes/grounding.ts` — no invented facts.
  - **Strategies:** every rule needs a strategy in `fixes/strategies.ts`
    (a test enforces it).
  - **Activity log:** `geo_agent_events` holds real tool/transition summaries
    only, never model reasoning.
- Dimension scores (`src/lib/geo/dimensions.ts`) are derived from the stored
  rule summaries; every rule id must be mapped (a test enforces it).

## Backlink Growth (buying real placements)

Mellox **buys** backlinks; it does not analyse someone else's. A user picks the
page they want to rank and the sites to appear on, Mellox writes the brief, buys
the placement through a fulfilment provider, then fetches the published page to
prove the link is really there. The user never needs a provider account and
never sees one.

- Route `/w/<id>/app/backlinks` (renders `AppModalShell` over `AppShell`, which
  owns the viewport); sidebar entry in **Intelligence**. UI in
  `src/components/app/links/`, RPC `src/server/fns/links.ts`, stubs
  `src/lib/links.functions.ts`.
- **Mellox owns the provider credential** (`RIXOT_API_KEY`) — never ask a user
  to paste a token or connect their own account. Without it the surface reports
  itself unavailable instead of failing at the moment someone tries to buy.
- `src/server/links/rixot/client.server.ts` is the only file that reads the key
  or talks to the provider. **Its POSTs are never retried**: the provider has no
  idempotency key on its order call and no way to remove a basket item, so a
  repeat is money that cannot be recovered.
- Two invariants shape everything (both stated in the migration header):
  - **Basket exclusivity** — one provider account and one basket are shared by
    every workspace, and the pay call charges for the whole basket. So exactly
    one order cycle may touch the provider at a time, enforced by the lease row
    `provider_basket_lock` with a fencing token that every write carries.
  - **No blind retry** — an unknown POST outcome is resolved by *reading* the
    basket. An unknown order resolves by items appearing; an unknown pay by
    items disappearing.
- Anything the runner cannot resolve with certainty quarantines the lock and
  halts the queue (`needs_operator`). A stuck queue is recoverable; an
  unattributed charge is not.
- The money decisions are pure and tested in `src/lib/links/basket.ts`
  (`preflightVerdict`, `payVerdict`); `reconcile.server.ts` is only the database
  half. Paying requires pinned basket ids, set equality both ways, and a total
  matching to the cent.
- **Credits**: `workspace_credit_ledger` is append-only (a trigger refuses
  UPDATE and DELETE even for `service_role`); `apply_credit_entry` is idempotent
  on `(workspace_id, idempotency_key)`, and keys derive from row ids only.
  Held at checkout, captured at payment, refunded per line if a placement never
  appears. Top-ups go through Stripe (`src/server/billing/stripe.server.ts`);
  with no Stripe key the packs show disabled rather than breaking.
- **Pricing is server-side only** (`src/lib/links/pricing.ts` + env
  `MELLOX_LINK_MARGIN`, `MELLOX_CREDITS_PER_USD`). The browser's total is
  checked against the server's at checkout, never trusted.
- **Relevance is Mellox's own read, labelled as such.** The provider catalog has
  no dependable category, so `src/lib/links/rank.ts` ranks on figures it really
  returns (domain rating, referring domains, ranking keywords, price) and
  `match.server.ts` fetches a sample page for Claude to judge topical fit. Never
  invent a score the data cannot support; file hosts and throwaway TLDs are
  refused outright.
- **A placement only counts once verification says so.** The provider saying
  "published" is not proof. `link_order_lines_live_needs_proof` refuses `live`
  in the database without a real check, mirroring `backlink_opportunities`.
  Verification (`src/lib/backlinks/verify.ts` + `src/server/backlinks/
  verify.server.ts`, through `safeFetch`) is deliberately conservative: a bot
  wall, truncated body or client-rendered page is `unreachable`, never
  `missing`, and a link is only `lost` after two consecutive misses a day apart.
- Attribution from the provider's link list is `(target, keyword, donor, cost)`,
  which is **not a key**. A tie is recorded as `ambiguous` and the word reaches
  the user rather than being smoothed over.
- Background work: `/api/public/hooks/link-orders` every minute (advance one
  cycle, poll links, verify, refund) and `/api/public/hooks/link-catalog` daily
  (mirror the catalog into `rixot_donors`).
- Live checks: `tests/live/links.live.ts`. Everything in it is a GET and spends
  nothing; the one test that really buys a placement is gated behind
  `LINKS_LIVE_BUY=yes`.

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
