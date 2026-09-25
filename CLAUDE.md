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
- **Paid AI calls:** only through the gateways — text/vision/tools
  `src/lib/ai-gateway.server.ts` (+ `ai-gateway.tool-loop.server.ts`), images
  `src/lib/openrouter-image.server.ts`, video the provider interface in
  `src/server/ugc/providers/` — they meter and budget-check. Declare a
  rate-limit tier for anything that spends. Never name a model at a call site
  (see "Models" below).
- **Cross-component events:** declare in `src/lib/app-events.ts`, use `emitAppEvent`.
- **Design:** icons from `@/components/icons` (bespoke Mellox set, lucide fallback);
  primary colour is Ultra Moss lime in both themes; use `EmptyState` /
  `ErrorState` / `Skeleton` for states; feature surfaces are `AppModalShell` modals.
  Follow [docs/design-system.md](docs/design-system.md): `ds-*` tokens/utilities,
  `SurfaceLayout` rail for multi-section surfaces, pill buttons. Never restyle the
  public landing page (`src/app/page.tsx`) as part of app UI work.
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

## Models (OpenRouter only)

Decision record [ADR-0026](docs/adr/0026-openrouter-only-models.md); full
table in [MODEL-USAGE-AUDIT.md](MODEL-USAGE-AUDIT.md).

- **No Anthropic API.** Text, vision, tool use and images all go through
  OpenRouter (`OPENROUTER_API_KEY`). Claude is used as
  `anthropic/claude-opus-5.5` via OpenRouter.
- **The model comes from the route label.** `src/server/ai/task-models.ts`
  maps every metering `route` to a plan (models + fallbacks, reasoning effort,
  token ceiling, escalation, degraded plan). Tiers: PREMIUM Opus 5.5,
  WORKHORSE Gemini 3.8 Flash, ECONOMY Gemini 3.1 Flash-Lite. A new `route:`
  label needs an entry (a test enforces it). Override per route with
  `AI_MODEL_<ROUTE_KEY>` / `AI_EFFORT_<ROUTE_KEY>`.
- Every call sends `provider.data_collection: "deny"`, `tool_choice: "auto"`
  only (Opus rejects forced tools), and meters the model that actually
  answered from `usage.cost`. The tool loop replays `reasoning_details`
  unchanged and is append-only.
- **Images:** GPT Image 2.5 Flare (default) / Sunburst (premium), routed by
  `src/lib/model-router.server.ts`, env `IMAGE_MODEL_*`.
- **Video (still KIE):** `VIDEO_PROVIDER=kie` with automatic fallback to
  OpenRouter (`VIDEO_PROVIDER_FALLBACK`) only on out-of-credits, auth or
  model-unavailable — never on an unknown outcome. Catalog keys
  (`standard`, `draft`, `premium`, `long`, `cinematic`, `variation`) in
  `src/lib/ugc/models.ts`; old keys are read-only aliases. Dropping KIE is
  the checklist in ADR-0026.
- Live check: `tests/live/openrouter-models.live.ts` (video behind
  `VIDEO_LIVE_OPENROUTER=yes`).

## Brand Kit and Styles

Full reference: [docs/brand-kit.md](docs/brand-kit.md), decision record
[ADR-0025](docs/adr/0025-brand-kit-styles.md).

- A **Style** (`brand_styles`) is a named look and voice; the **Brand Kit** is
  its library (`brand_kit_assets`: logos, fonts, elements, example posts and
  videos, writing samples). Brand DNA stays the source of facts; a style
  inherits colours, fonts, voice, logo and rules field by field.
- **Generators get a style only through** `loadResolvedStyle` / `styleTextFor`
  (`src/server/brand-kit/resolve.server.ts`), with the verified workspace id.
  Choice: style id, `"none"` (Brand DNA only), or empty (the default, only for
  the formats it lists). Never trust a browser style id without that check.
- Pure core in `src/lib/brand-kit/` (`resolveStyle`, prompt blocks,
  `mergeAnalyses`, `checkWritingConformance`, fonts); analysis uses vision
  through the gateway's `images` option (`llmJson`), claimed by compare-and-set.
  Analysis never overwrites a user-set field (`provenance`).
- Uploads: signed upload URLs for server-chosen paths under
  `workspace/<id>/assets/brand-kit/`, verified in `finishUpload`. No SVG.
- Live check: `tests/live/brand-kit.live.ts` (paid part behind
  `BRAND_KIT_LIVE_ANALYZE=yes`).

## Sharing (team invites and the client portal)

- **Team invites:** `src/server/fns/workspaces.ts` + `ShareDialog.tsx`.
  - The link is `/app?invite_token=<uuid>`, accepted by `LegacyAppRedirect`.
  - Login and signup keep `?next=` when you switch between them, so a new
    teammate lands back on the invite.
  - Inviting the same email again issues a new token and resets
    `accepted_at`, which lets a removed member rejoin.
  - Accepting never lowers an existing role.
  - Admins+ invite; only the owner changes roles or removes members.
- **Client portal:** `ClientPortalDialog.tsx`, opened by `open:client-portal`
  and mounted once in `AppShell`. Routes: `src/app/api/shares` (team side) and
  `src/app/api/public/share/[slug]` (client side, service role after
  token/password check).
- **Share links stay the same link.** `client_shares.token_ciphertext`
  (`SHARE_LINK_ENCRYPTION_KEY`, `src/server/shares/link-token.server.ts`) lets
  `?action=link` return the link the client already has. Only
  `?action=rotate` issues a new link. Access is always checked against
  `token_hash`.
- The public thread never returns emails or `viewed` rows, and the page's
  background refresh (`?refresh=1`) doesn't count as a view.
- Live check: `tests/live/client-portal-collaboration.live.ts`.

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
  - tool loop `llmToolLoop` in `src/lib/ai-gateway.tool-loop.server.ts`;
  - read-only `repo-tools.server.ts`;
  - stages in `geo-coding-agent.ts`;
  - leased `runner.server.ts`;
  - `service.server.ts`;
  - RPC `src/server/fns/geo-agent.ts`, UI `geo/agent/AgentPanel.tsx`.
  Models: routes `geo.agent.investigate` / `implement` / `review` in
  `task-models.ts` (Opus 5.5; override `AI_MODEL_GEO_AGENT_*`). Rules:
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
- WordPress / Webflow sites (migration `20260929090000_geo_site_connectors.sql`):
  - **Which platform builds a host** is decided only by `src/server/sites/resolve.server.ts`
    (connection + live page fingerprint, `src/lib/sites/fingerprint.ts`). Nothing
    is written to a site whose binding isn't `verified`.
  - CMS fixes live in `src/server/geo/cms/` (targets → generate → field-level
    before/after → apply with a snapshot → undo). Approval binds the content
    hash; apply refuses on drift. Still only a verification scan resolves a finding.
  - "Fix all" follows the site's platform (`FixAllPreflight.platform`): GitHub →
    one batch PR; WordPress/Webflow → `fixes/cms-fix-all.server.ts` + `geo/CmsFixAllPanel.tsx`
    (one run per finding, one change per field and page, apply all ready changes
    at once). The platform tiles are `geo/SiteConnectPicker.tsx` fed by
    `fixes/site-connections.server.ts`; brand marks are `components/brand/SiteLogos.tsx`.
  - The optional WordPress plugin is `integrations/wordpress/mellox-geo`
    (`scripts/build-wp-plugin.mjs` → `public/downloads/mellox-geo.zip`).
- Article publishing (Studio article → the workspace's website):
  `src/lib/articles/` (render + GEO gate, blog layout, live-page verify, all pure
  and tested), `src/server/articles/` (`blog.server.ts` detection/setup,
  `publish.server.ts` service + leased worker on `claim_site_publications`),
  RPC `src/server/fns/site-publishing.ts`, UI `src/components/studio/PublishToSite.tsx`.
  - Advanced by the **existing** geo-agents cron hook and `after()`; no new cron job.
  - A publication is bound to a hash of the approved article; an edit after
    approval stops it (`needs_attention`).
  - Provider creates are never blindly retried: WordPress/Webflow re-find by
    slug; GitHub stores the `mellox/post-` branch name before committing and
    only ever opens a pull request.
  - Only the live-page check marks a publication `verified`. A "coming soon"
    placeholder, an empty template or noindex keeps it unverified.
  - Mellox never invents a blog in a codebase: GitHub needs an existing posts
    folder; Webflow can get a "Blog Posts" collection in one click.
  - Live checks: `tests/live/article-publish.live.ts`, `tests/live/geo-cms-fix.live.ts`
    (writes gated behind `SITES_LIVE_WRITE=yes`).

## Proof Engine (Experiments)

Decision record [ADR-0024](docs/adr/0024-proof-engine-controlled-experiments.md).
Flag `FEATURE_FLAG_PROOF_ENGINE_ENABLED` (per workspace:
`FEATURE_FLAG_PROOF_ENGINE_ENABLED_WS_<id>`), off by default. When it's off the
sidebar entry is hidden, RPCs answer 404, and the worker pauses that workspace.

- A test changes one field (title, meta description, H1, intro, FAQ, button
  text) on half of a group of similar pages and compares it with the other
  half. Pure maths in `src/lib/experiments/`; server in
  `src/server/experiments/`; RPC `src/server/fns/experiments.ts`; UI
  `src/components/app/experiments/` at `/w/<id>/app/experiments`.
- **Delivery:** everything goes through pull requests on `mellox/exp-…`
  branches (`deliveries.server.ts`), with exact-content approval. Mellox never
  merges.
  - A one-time integration PR adds a reader module plus
    `mellox-experiments/overrides.json`, and wires the page template to it.
  - Ship, roll-out and roll-back PRs rewrite only that data file,
    deterministically.
  - Only one experiment PR may be open per repository at a time.
- **Only the live check starts the clock** (`live-check.server.ts`, raw HTML
  through `safeFetch`). Verdicts are written only at checkpoint days, and the
  database keeps the design, patch hash, live date and verdict final. Never
  write them anywhere else.
- **Grounding:** AI copy goes through `fixes/grounding.ts`, the same rule as
  fixes: no facts that aren't on the page, in its searches or in Brand DNA.
- **Client reports** are built from server rows at view time (`buildReport`),
  never from the member-writable share snapshot.
- Worker: leased `experiment_jobs` (`claim_experiment_jobs`), advanced by
  `/api/public/hooks/experiments` every 5 minutes. PR state arrives via the
  GitHub webhook and a poll.
- Live check: `tests/live/experiments.live.ts`.

## Web intelligence and Competitors

Decision record [ADR-0022](docs/adr/0022-tavily-web-intelligence.md).

- **One way to search the web:** `webSearch` / `webAnswer` /
  `webSearchMany` in `src/server/research/web-search.server.ts`. It is a
  quality ladder — Tavily, then Firecrawl, then the legacy DuckDuckGo scrape —
  and it never throws: no sources is a fact, not an error. Never add another
  search path.
- **Tavily lives in one file.** `src/lib/tavily-gateway.server.ts` is the only
  place that reads `TAVILY_API_KEY` or talks to `api.tavily.com`; the key goes
  in a header, never a URL or a log. Any user-supplied domain or URL passes
  `assertPublicUrl` before it enters a request body, because Tavily fetches on
  its own infrastructure. Flag: `src/lib/tavily-flags.server.ts`.
- **Division of labour:** Tavily discovers across the open web; Firecrawl
  crawls one known site and is preferred wherever it is configured;
  `safeFetch` is for anything this process fetches itself. Tavily `/extract`
  is a fallback for reading pages, never a crawler.
- **Selective by construction.** `src/lib/research/triggers.ts` decides, with
  pure string work, whether chat or a Studio brief needs live information.
  Plain creative and "about my own data" requests must never search.
- **Source rules are shared and browser-safe** (`src/lib/research/sources.ts`):
  normalise, dedupe with a per-host cap, refuse file hosts and throwaway TLDs.
  A claim that came from the web carries its URL, or it is not shown.
- **Competitors are one entity.** `workspace_competitors` (+
  `competitor_updates`) is canonical; `competitor_watches` and
  `competitor_intelligence_runs` hang off it by `competitor_id`. Engines in
  `src/server/competitors/` (discovery → profile → updates), RPC
  `src/server/fns/competitors.ts`, UI `src/components/app/competitors/` at
  `/w/<id>/app/competitors`.
  - **Grounding:** discovery may only classify companies a search really
    returned, and an update may only reference a supplied result. Never let a
    model introduce a company or an event of its own.
  - **Discovery never tracks anyone.** It writes suggestions; a person accepts
    them, because tracking is what costs money on every later sweep.
  - **Updates are deduped by fingerprint** (unique index), and the recency
    window is derived from `updates_checked_at`, never a fixed sweep.
  - Background work is leased (`claim_competitor_jobs`) and advanced by the
    **existing** `competitor-watch` cron hook — do not add a cron job.

## Market Brain ("Market Updates" in Marketing Coach)

Decision record [ADR-0023](docs/adr/0023-tavily-market-signals.md).

- **DataForSEO/Google Trends is removed from this product — never add it
  back.** Market Brain's measured evidence is Tavily web search
  (`src/server/research/market-signals.server.ts`, via the one search path in
  ADR-0022), not a search-interest index. There is no numeric trend graph or
  regional-interest map to restore; a `MarketSignalsData` collection is a list
  of real, dated, linkable web sources.
- **Collection/cache**: `src/lib/market-signals-collection.server.ts`
  (workspace-scoped `market_trend_collections`, 6 h TTL, compare-and-set claim
  so concurrent requests never double-bill). Tavily answers inline, so a scan
  resolves `completed`/`failed`/`no_data` directly from the POST in the normal
  case — `pending`/poll is crash recovery only, not a normal phase.
- **Synthesis**: `market-intelligence.server.ts` turns a collection's sources
  into a Claude-authored `MarketIntelligence` (cached in
  `market_intelligence_cache`, keyed on the sources' own content so identical
  evidence never bills twice). Sources are wrapped as untrusted data
  (`src/server/guardrails/untrusted.ts`) before they reach the prompt.
- **Daily re-collection** is a `scheduled_jobs` row (`task_type:
  "market-brain"`) driven by `market-brain-scheduler.server.ts`, advanced by
  `runDueMarketBrainCollections()`.
- UI: `MarketBrainPanel.tsx` + `MarketBrainInsights.tsx` +
  `MarketBrainProgress.tsx`, embedded in `MarketingCoachPanel.tsx`'s "Market"
  tab; routes `src/app/api/market/{trends,intelligence,latest}`.

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

## Caption naturalization & image metadata finalization

Two quality passes, both fail open (a failure never blocks saving the
originally generated content) and both off only if explicitly disabled.

- **Captions:** `src/lib/studio/naturalize.ts` (pure heuristic — an
  AI-cliché/robotic-phrasing score, `needsNaturalization`) gates
  `src/lib/studio/naturalize.server.ts` (calls `llmJson` from the
  OpenRouter gateway, route `studio.naturalize`). Wired into `runner.server.ts`'s `executeJob`, right after
  `humanizeOutput` (em-dash cleanup) and before drafts are written. Most
  captions never cross the threshold and ship unrewritten. A rewrite is kept
  only if it demonstrably reduced the cliché score (`isBetterThanOriginal`)
  _and_ preserved every URL/@mention/#hashtag/number from the original
  (`checkPreservation`) — otherwise the original ships untouched. Re-runs
  `finalizeVariant` afterward so a rewrite can never blow past a platform's
  character limit. Scoped to `output.variants[].body` (social captions) only —
  article/script/ad/carousel text is intentionally out of scope for now.
- **Images:** `src/server/assets/image-metadata.server.ts` wraps the vendored
  `vendor/image-metadata-toolkit` (MIT, pinned — see `MELLOX_VENDOR.md` there)
  as a CLI subprocess: strips privacy-sensitive EXIF/GPS/device fields, writes
  XMP ownership/attribution (creator/publisher from the workspace's own
  name+domain), and verifies pixels are unchanged. Wired into
  `persist.server.ts`'s `persistAsset`, between downloading the generated
  image and uploading it to Storage. **Never overrides the toolkit's
  `provenance_policy: "preserve"`** — a file already carrying C2PA/Content
  Credentials is left untouched, never stripped. Requires `python3` (3.10+)
  and `exiftool` (12.70+) on `PATH` (the Dockerfile installs both via apt);
  where either is missing, every call fails open to the original bytes.
  Gated by `isAssetMetadataFinalizeEnabled()` in `feature-flags.ts`
  (`FEATURE_FLAG_ASSET_METADATA_ENABLED`, on by default).
- Neither pass talks to an AI-detection/plagiarism-detection service or
  attempts to defeat one — naturalization is a genuine style rewrite with a
  gateway-backed model, and metadata finalization is legitimate EXIF/XMP
  hygiene with provenance left untouched by design.

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
