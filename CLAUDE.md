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
- **Connecting a service** (GitHub, WordPress, Webflow, Slack, Notion, Canva,
  Google) opens a small sign-in window, never this tab: start it with
  `useConnectWindow` (`src/components/app/connectors/`), and the page the
  provider returns to calls `finishConnectWindow`
  (`src/lib/connectors/connect-window.ts`). The result only means "re-read the
  connection from the server". Same-tab is the fallback when the window is blocked.
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

## Brain (the four brains, the strategy, and the brand's look)

Full reference: [docs/brain.md](docs/brain.md), decision record
[ADR-0032](docs/adr/0032-brain-strategy-and-one-look.md) (supersedes ADR-0025:
Brand Styles and the Brand Kit are gone — never add them back).

- **One place.** Brand DNA, Audience, Competitors and Market live in Brain at
  `/w/<id>/app/brain?s=<section>&t=<place>`; build links with `brainPath()`.
  UI in `src/components/app/brain/` (`BrainShell`, `BrainHome`, `BrainMark`,
  `BrainPulse`), opened by `open:brain`. The older `open:brand-dna`,
  `open:audience`, `open:competitors` and `open:marketing-coach` events land on
  the matching section. Add a new brain view there, never as another dialog,
  route or sidebar entry.
- **The overview is free.** `getBrainOverview` (`src/server/brain/`, pure half
  `src/lib/brain/brain.ts`) only counts and lists rows that exist, with the
  caller's own client. The Coach pill (`BrainPulse`) shows those updates and
  must never start a briefing, a scan or anything paid.
- **One marketing strategy per workspace** (`workspace_marketing_strategy`;
  `src/lib/strategy/`, `src/server/strategy/`, RPC `src/server/fns/strategy.ts`,
  UI `brain/strategy/`).
  - The model proposes, `groundStrategy` decides: only tracked competitors, only
    market sources Market Brain collected, only real audience groups. A person's
    edit goes through the same function.
  - **Only a confirmed strategy reaches a generator** (`strategyBlockFor`, added
    in `loadStudioContext`, chat and the Coach briefing). A draft or a rebuild
    waits for a person.
  - Autopilot follows it: `suggestStrategy` proposes the confirmed one and
    `syncProgramStrategy` updates a live program. The program's `strategy`
    column is a copy; the workspace row is the source.
  - Nothing rebuilds or spends by itself. The first strategy is included; a
    rebuild is `strategy_rebuild` through `runMetered`.
- **One look per brand, on Brand DNA** (`dna.look`, edited in Brand → Look &
  voice). Pure core in `src/lib/brand-look/` (`parseLook`, `resolveLook`, prompt
  blocks, `checkWritingConformance`, fonts).
  - **Generators get the look only through** `loadBrandLook` / `lookTextFor`
    (`src/server/brand-look/resolve.server.ts`), with the verified workspace id.
    There is no style id anywhere; never add a picker or a second look.
  - No look set means plain Brand DNA (`customized: false`, no style block).
- **One scan fills three brains.** A Brand DNA scan (`BrandDnaSurface`) then
  builds the audience groups (`buildAudience`) and looks for competitors
  (`bootstrapCompetitors`) from what it found; `ScanSteps` shows the three
  steps. A plan or flag that doesn't allow one skips it quietly. Never make a
  person scan Audience separately after a Brand scan.
- **Layout:** blocks inside Brain are `<div>`s, not sibling `<section>`s — the
  global rhythm rule in `styles.css` adds a 48px gap between sibling sections
  and breaks grids. Notes are `brain/home/NotesBoard.tsx`.
- `BrainHome`, `StrategyScreen` and `BrainPulseView` are presentational;
  `/brain-lab` renders them with sample data in development
  (`tests/integration/brain-lab.spec.ts`).
- Live check: `tests/live/brain.live.ts` (model call behind
  `STRATEGY_LIVE_AI=yes`).

## Memory and chat tools

Full reference: [docs/memory.md](docs/memory.md), decision record
[ADR-0033](docs/adr/0033-memory-and-chat-tools.md). Flags
`FEATURE_FLAG_MEMORY_ENABLED` and `FEATURE_FLAG_CHAT_TOOLS_ENABLED` (each with
`_WS_<id>`), on unless `false`. Memory off: the Settings section and
account-menu entry are hidden, RPCs answer 404, chat saves nothing and
generators get no memory block. Chat tools off: chat is one plain reply.

- **One memory per brand** (`workspace_memories`, shared by the workspace's
  members; "use memory" switch in `workspace_memory_settings`). Pure rules in
  `src/lib/memory/`; server in `src/server/memory/`; RPC
  `src/server/fns/memory.ts`; UI `src/components/app/memory/`, shown in
  Settings → Memory and Account menu → Memory. `BrandDna.userInsights` is the
  old store: never read or write it again.
- **The model proposes, pure code decides.** Every change from chat or the
  background reader goes through `applyMemoryOps` (`decide.ts`): no duplicates,
  no secrets or private details, 200 per brand, and a memory a person removed
  is never brought back by the background reader. Never write the table from a
  model's output any other way.
- **Temporary memories end by themselves** (`expires_at`, an hour to a week;
  `context` is always temporary). They are deleted by the **existing**
  `run-schedules` hook; do not add a cron job.
- **Generators get memory only through** `memoryBlockFor(workspaceId, surface)`
  (`src/server/memory/context.server.ts`), with the verified workspace id. It
  goes near the top of the prompt and is **not** fenced as untrusted data (it
  is the team's own rules); a memory that reads like an attempt to steer the
  model is refused at write time instead. A new generator must call it.
- **Chat saves by itself and says so.** `remember` / `update_memory` / `forget`
  run in the reply, and the reply carries a "Memory updated" note with Undo and
  Manage. Never bring back an approval step or a pop-up for saving.
- **Chat reads by itself; a change is always a button**
  (`src/server/chat/tools.server.ts`). Reads are the allow-list
  `CHAT_READ_TOOLS` (every one `write: false`; a test enforces it). Anything in
  `CHAT_ACTION_TOOLS` is never run for the model: the request is stored in
  `chat_actions` and shown as a button.
  - A click runs it once, as the person who clicked
    (`src/server/chat/actions.server.ts`): arguments come from the stored row,
    the role is checked again, `offered → running` is a compare-and-set, and a
    failed button stays failed.
  - Tools are the MCP tools (`src/server/mcp/tools/`) called through the
    bridge, so plan, credits and approval rules apply as in the app. Chat does
    not use `runTool` or the workspace's MCP switch.
  - Not offered from chat, on purpose: workspaces, starting or stopping
    Autopilot, rewriting Brand DNA, website fixes, billing, team and roles,
    connecting accounts, buying backlinks.
- **A reply is rounds without replay** (`src/server/chat/stream.server.ts`):
  tool results are added as reference data and the next round starts fresh.
  The model's tool-call turn is never sent back, so this is not `llmToolLoop`
  and carries no reasoning. At most three tool rounds and eight tool calls; the
  last round has no tools.
- **Places and the "/" menu:** `src/lib/chat/places.ts` is the one list of
  places chat can open (`open_in_mellox`, the "/" menu in `ChatComposer`). Add
  a place there. Opening is always a person's click.
- What a reply carried (memory changes, buttons, place offers) is stored on the
  assistant message's `metadata` (`src/lib/chat/events.ts`).
- `MemoryScreen` and `ReplyExtras` are presentational; `/memory-lab` renders
  them with sample data in development (`tests/integration/memory-lab.spec.ts`).
- Live check: `tests/live/memory.live.ts`.

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
- A new rule needs four entries or a test fails: `RULE_DIMENSIONS`
  (`dimensions.ts`), `STRATEGIES` (`fixes/strategies.ts`), `RULE_FIELDS` or
  `CMS_MANUAL_RULES` (`cms-fixes.ts`), and a recipe for its `fixId`.
- Scores are server-computed; never let the browser write `geo_audit_runs`.
- **The score must stay honest and reachable** (score version 2, `SCORE_VERSION`):
  - a well-built site reaches 100 (`rules.v2.test.ts` builds one — keep it passing);
  - crawlers have tiers in `robots.ts`: blocking a `training` crawler is the
    owner's choice and is never scored; only `search` / `user` crawlers are;
  - `ai.live_access` (a look-alike crawler request) only ever warns;
  - every rule that claims an AI effect carries an `evidence` label
    (`documented` / `measured` / `emerging`) — don't add checks for myths;
  - bump `SCORE_VERSION` when scoring changes enough that old and new scores
    aren't comparable; the UI doesn't compare across versions.
- Rules that compare pages (`COMPARISON_RULES` in `verify.ts`) verify only when
  the other pages are re-read; never let them pass on a single-page scan.
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
  - **A site with no blog can get one** ("Add a blog to my site"). Webflow: a
    "Blog Posts" collection in one click. GitHub: one pull request with blog
    pages that match the site (`src/lib/articles/blog-scaffold.ts`, pure;
    `src/server/articles/blog-setup.server.ts`), on TanStack Start and the
    Next.js App Router with TypeScript and Tailwind. Any other site says so and
    the person's developer adds the blog.
    - **Templates write the code; the model only proposes class names** (route
      `articles.blog-design`). `mergeDesign` / `insertNavLink` check every value
      and fall back to a plain default. Never let a model write a page.
    - New files only, plus at most one "Blog" link in the site's menu. No
      package, configuration or build file is touched. A site that already has
      a `/blog` route is refused.
    - Posts on that blog are one JSON file each (`post_format: data_module`,
      `githubDataPostFile`): rendered HTML plus the article's own JSON-LD.
      `mellox-blog.json` at the repository root is how detection finds the blog
      after the merge.
    - The state is `site_blog_settings.status` (`missing → creating → detected`)
      with the branch and pull request in `setup`. The branch name is stored
      before the commit; the claim is a compare-and-set. Mellox never merges.
  - Live checks: `tests/live/article-publish.live.ts`, `tests/live/geo-cms-fix.live.ts`
    (writes gated behind `SITES_LIVE_WRITE=yes`),
    `tests/live/article-blog-setup.live.ts` (model call behind
    `BLOG_SETUP_LIVE_AI=yes`; never writes to GitHub).

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

## Autopilot

Full reference: [docs/autopilot.md](docs/autopilot.md), decision record
[ADR-0028](docs/adr/0028-autopilot.md). Flag `FEATURE_FLAG_AUTOPILOT_ENABLED`
(per workspace: `FEATURE_FLAG_AUTOPILOT_ENABLED_WS_<id>`), on unless set to
`false`. When it's off the message-box switch is hidden, RPCs answer 404, and the
worker skips that workspace. `AGENTS_DISABLED` and a workspace's paused agents pause it too.

- One engine for every workspace: a program (`autopilot_programs`), leased
  steps (`autopilot_actions`, kinds `plan` / `content` / `scan`), append-only
  history (`autopilot_events`) and scored opportunities
  (`marketing_opportunities`). Pure rules in `src/lib/autopilot/`; worker,
  store and ports in `src/server/autopilot/`; RPC `src/server/fns/autopilot.ts`;
  UI `src/components/app/autopilot/` at `/w/<id>/app/autopilot`.
- **It owns no generator, publisher or approval.** A piece is made only through
  `createBilledStudioJob` (`src/server/studio/billed.server.ts`, shared with the
  Studio route) and scheduled only through `scheduleForWorkspace`
  (`src/server/social/schedule.server.ts`, shared with `/api/sdr/schedule`).
  Never add a second path for either.
- **Approval is `content_items.status`, nothing else.** The worker hands an
  item to the publisher only if it reads `approved` at that moment; the
  publisher itself would promote a draft, so never rely on it for the gate. An
  item edited after approval reads `draft` and goes back to waiting.
- **The model proposes, pure code decides.** Dates, platforms, formats, weekly
  limits, duplicates, freshness, scores and whether a person must approve are
  decided in `policy.ts` / `opportunities.ts`. An opportunity's title, link and
  date come from the source record; a web claim with no usable link is not shown.
- **No duplicates:** `(workspace_id, dedupe_key)` is unique on actions,
  `(workspace_id, fingerprint)` on opportunities, and the Studio idempotency key
  is `autopilot:<actionId>:<attempt>`. Scheduling is never retried by the
  worker; the outcome is read from the content item.
- **It acts as a member.** `acting_user_id` is re-checked on every step; if
  that person is no longer an editor the program pauses with a reason.
- **Set up once.** `suggestStrategy` (`strategy.server.ts`) proposes the
  workspace's confirmed marketing strategy (Brain → Strategy, ADR-0032) when
  there is one, else a short one from Brand DNA, plus settings; it is stored on
  the program and every weekly plan is written against it. Never ask the person
  to restate goals per week or per post.
- **Fully automatic mode** only approves by itself through `publishDecision()`
  (plain and image posts, no quality warning, no figure missing from Brand DNA,
  two a day at most). `FEATURE_FLAG_AUTOPILOT_FULL_ENABLED=false` removes the
  mode. Never add another way for a piece to become approved without a person,
  and never loosen a check to make more posts go out.
- When posts wait for a person, `notifyWaiting` emails the acting member at
  most once a day (Resend, via `src/server/notify/email.server.ts`).
- The UI is one presentational component (`AutopilotScreen`) fed by
  `AutopilotPanel`; `/autopilot-lab` renders it with sample data in development
  for visual checks (`tests/integration/autopilot-lab.spec.ts`).
- **It lives in the chat message box, not the sidebar** (`autopilot/composer/`:
  presentational `AutopilotDeck`, wired by `useComposerAutopilot`). Off, it is
  one switch in the box's toolbar; on, the deck covers the box in a new chat
  and the top bar shows `AutopilotBeacon`. Typing always hands the box back.
  The full view loads only while the deck shows and the proposal is asked for
  only after a person flips the switch. Never add a sidebar entry back; link to
  the full screen with `autopilotPath(id, section)`.
- **More than posts.** A program's `automations` become weekly `task` actions
  that start work in another Mellox system through `ports.tasks.run` (today:
  `geo_scan` → `createScan`). A task only starts the work; that system keeps
  its own rules (only a verification scan resolves a GEO finding). Add a new
  automation there, never as a second implementation inside Autopilot.
- **Adaptive.** `summarizeLearnings` (`src/lib/autopilot/learn.ts`, pure) turns
  the workspace's own measured posts into a few sentences that go into the
  next plan prompt and onto the home screen. No pattern is claimed from fewer
  than two posts per group.
- **Ask, don't fail.** `readiness` in the view lists what is missing (social
  accounts, Brand DNA, website) with the place to fix it; the UI shows it in
  setup and on Home.
- Opportunity scans read stored Market Brain and competitor data only — no new
  web searches — and are queued from `runMarketBrainJob` and `advanceCompetitor`.
- Worker: advanced by the **existing** `run-schedules` cron hook
  (`runDueAutopilot`) and `after()`; do not add a cron job. The runner is tested
  against `store.memory.ts`; keep it store-agnostic.
- Agency HQ: `autopilot_overview()` (`SECURITY INVOKER`) feeds
  `command-center/AutopilotView.tsx`; every action there calls a per-workspace,
  role-checked function. Never read another workspace's rows with the service role.
- Live check: `tests/live/autopilot.live.ts` (paid step behind
  `AUTOPILOT_LIVE_GENERATE=yes`).

## Audience

Full reference: [docs/audience.md](docs/audience.md), decision record
[ADR-0031](docs/adr/0031-audience-intelligence.md). Flag
`FEATURE_FLAG_AUDIENCE_ENABLED` (per workspace:
`FEATURE_FLAG_AUDIENCE_ENABLED_WS_<id>`), on unless `false`. When it's off the
sidebar entry and editor sections are hidden, RPCs answer 404, the worker
leaves runs alone and generators get no audience block.

- Audience groups (`audience_twins`; "twin" in code, "group" in the UI), the
  Mellox Score and deeper checks (`audience_predictions`), leased runs
  (`audience_runs`, kinds `twins` / `pulse` / `tournament`), frozen real
  results (`audience_outcomes`) and calibration. Pure rules in
  `src/lib/audience/`; worker, store and ports in `src/server/audience/`; RPC
  `src/server/fns/audience.ts`; UI `src/components/app/audience/`, shown in
  Brain → Audience (`brainPath(id, "audience")`).
- **It never changes a piece.** Nothing in Audience writes to `content_items`.
  "Improve" calls the editor's own rewrite; "Use this version" becomes an
  unsaved edit. Never add a write to content from here.
- **The model proposes, pure code decides** every number (`score.ts`,
  `panel.ts`, `calibration.ts`). Model calls go only through `AudiencePorts`
  (`simulate.server.ts`); group text and the piece are wrapped as untrusted.
- **A score is for exact text and one audience** (`subject_hash`,
  `twins_fingerprint`, `SCORE_VERSION`). The UI only shows a score that still
  matches the saved row.
- **Every statement keeps its source**; a guess is labelled a guess. A person's
  statement is never overwritten, and a removed group is not brought back.
- **Honest thresholds** (top of `calibration.ts`): 100 views, 7 days, 8 posts
  to compare, 8 pairs before any correction, 2 posts per side for a pattern.
  Never lower them to make the page look fuller. Simulated people are always
  labelled as simulated.
- **Cost is bounded:** the quick score is one economy call (included,
  rate-limited); a check is at most 6 calls; a comparison at most 7. Prices are
  only in the billing catalog. A repeat click joins the running run before any
  charge.
- Worker: advanced by the **existing** `run-schedules` hook (`runDueAudience`,
  `collectOutcomesIfDue`) and `after()`; do not add a cron job. The engine is
  tested against `store.memory.ts`; keep it store-agnostic.
- `AudienceScreen` is presentational; `/audience-lab` renders it with sample
  data in development (`tests/integration/audience-lab.spec.ts`).
- Live check: `tests/live/audience.live.ts` (real model calls behind
  `AUDIENCE_LIVE_AI=yes`).

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
  `src/server/fns/competitors.ts`, UI `src/components/app/competitors/`, shown
  in Brain → Competitors (`brainPath(id, "competitors")`).
  - **Grounding:** discovery may only classify companies a search really
    returned, and an update may only reference a supplied result. Never let a
    model introduce a company or an event of its own.
  - **Discovery never tracks anyone.** It writes suggestions; a person accepts
    them, because tracking is what costs money on every later sweep.
  - **Updates are deduped by fingerprint** (unique index), and the recency
    window is derived from `updates_checked_at`, never a fixed sweep.
  - Background work is leased (`claim_competitor_jobs`) and advanced by the
    **existing** `competitor-watch` cron hook — do not add a cron job.

## Market Brain (Brain → Market)

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
  `MarketBrainProgress.tsx`, shown in Brain → Market; routes
  `src/app/api/market/{trends,intelligence,latest}`.

## Studio: carousels, trends and content memory

- **A carousel is one story, drawn by code.** Pure core in
  `src/lib/studio/carousel/`: `story.ts` (structure, a role per slide,
  `normalizeSlides`, `carouselStoryIssue`), `design.ts` (look per brand,
  colourway and motif per carousel, readable themes), `SlideArt.tsx` (the one
  slide drawing).
  - `SlideArt` is rendered by the Studio preview **and** by
    `src/server/studio/carousel-render.server.tsx` (next/og → JPEG). Keep it to
    inline styles, flexbox and numbers derived from the width, or the two drift.
  - The image model only ever makes the optional cover picture. Slide text is
    never sent to an image model.
  - `carousel-assets.server.ts` stores the slides (`meta.asset_storage_paths`,
    hash in `meta.carousel`). The publisher asks `ensureCarouselMedia` right
    before sending, so an edited slide is redrawn, never published stale. Paths
    and the stored look come from user-editable `meta`: both are re-validated.
  - Scripts the fonts can't draw (`canRenderText`) keep the old behaviour; it
    fails open and never fails a job.
- **Social trends are one shared, stored snapshot** (`social_trend_snapshots`,
  scope `global`; `src/server/studio/social-trends.server.ts`, pure half in
  `src/lib/studio/trends.ts`). Refreshed every few days from the **existing**
  run-schedules hook via the one search path. Generators only read it: a brief
  never triggers a trends search. A trend is kept only if it cites a source the
  search returned (`groundTrends`). Flag `FEATURE_FLAG_SOCIAL_TRENDS_ENABLED`.
- `src/lib/studio/playbook.ts` is the steady layer (how each platform and
  format works); review it when a platform changes.
- **New idea, same brand** (`src/lib/studio/memory.ts`): the opening style
  rotates (`pickHookStyle`), used openings are listed and checked
  (`findRepeatedOpening`), and published copy is offered as a voice reference
  only. The carousel look is fixed per brand; its colourway and motif never
  repeat the previous carousel.
- Live check: `tests/live/studio-carousel-trends.live.ts` (collecting behind
  `TRENDS_LIVE_REFRESH=yes`).

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
  - **No blind retry** — an unknown POST outcome is resolved by _reading_ the
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

## Billing and credits

Status and next steps: [docs/billing/PROGRESS.md](docs/billing/PROGRESS.md); decision
record ADR-0027.

- **Catalog** `src/lib/billing/catalog.ts` is the only source of prices, plans, limits
  and feature gates (browser-safe). Never put a price anywhere else.
- **One wallet per owner** (`billing_accounts`), shared across their brands; meters
  `credits`, `video` (100 units = 1 video), `pro_messages`, `flash_messages`.
- **Paid user actions go through `runMetered` / `beginDeferredMetered`**
  (`src/server/billing/metered.server.ts`): hold → run → capture, release on failure.
  Included work uses `requireBillingFeature` / `requireWithinLimit`. Background jobs
  use `beginAsyncCharge` → `link(kind, rowId)` (`async-charges.server.ts`) and settle
  from the job's own status; add new kinds to `billing_async_links` and `outcomeFor`.
- Notices go through `notify()` (`src/server/billing/notify.server.ts`, deduped per
  window); email only via `src/server/notify/email.server.ts` (Resend).
- Tracked prompts: `src/server/geo/tracked-prompts.server.ts`, run from the existing
  geo-scans cron; weekly checks included, "Check now" charged.
- `BILLING_ENFORCEMENT` off / shadow / on (+ per-account override). Errors are 402
  with a `code`; the client shows a toast with a button, never an automatic pop-up.
- **Social publishing never costs credits** on any plan (Post for Me); only a hidden
  monthly fair-use cap (`postsFairUse`).
- **Payments:** Stripe later. Until then "Upgrade now" creates a
  `billing_purchase_requests` row and an admin activates it at `/admin`
  (`src/server/billing/manual.server.ts`, keyed by operation id, append-only audit).
  Admins: `BILLING_ADMIN_USER_IDS`.

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

## MCP server (AI assistants)

Full reference: [docs/mcp.md](docs/mcp.md), decision record
[ADR-0029](docs/adr/0029-mcp-server.md). Flag `FEATURE_FLAG_MCP_ENABLED`
(per workspace: `FEATURE_FLAG_MCP_ENABLED_WS_<id>`), on unless `false`.

- Route `src/app/api/mcp` (Streamable HTTP, stateless); server code in
  `src/server/mcp/`; settings RPC `src/server/fns/mcp.ts`; UI
  `connectors/McpConnector.tsx` under Settings → AI assistants; consent page
  `src/app/oauth/consent`.
- **Sign-in is Supabase's OAuth server.** The token is the person's own
  Supabase JWT, so RLS applies. Never add API keys or a second token type.
- **A tool only calls existing code** through `bridge.server.ts` (`callFn` for
  server functions, `callRoute` for `/api` handlers). Never read or write the
  database or a provider from a tool; never use `supabaseAdmin` for tool data.
- **Assistant tokens work only via `/api/mcp`.** `verifyBearer` refuses a token
  with a `client_id` claim elsewhere; only the bridge may `markMcpRequest`.
- **Every call goes through `runTool`**: flag → input → membership and role →
  the workspace's switch (`mcp_workspace_settings`, off by default; changes
  need `allow_writes`) → rate limit → the tool → `mcp_tool_calls` (append-only).
- **Approval is never skipped:** scheduling and posting check
  `content_items.status === "approved"` in the tool itself.
- Not exposed, on purpose: deleting workspaces, approving or applying website
  fixes, billing, team and role changes, connecting accounts.
- A new tool: add it in `src/server/mcp/tools/`, set `minRole`, `write`,
  `destructive`; read tools are named `list_` / `get_` / `suggest_` (a test
  enforces it); a bare record id must be checked against the verified workspace.
- Live check: `tests/live/mcp.live.ts` (`MCP_LIVE_ACCESS_TOKEN` to run as a person).

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
