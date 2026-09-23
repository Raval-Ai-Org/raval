# ADR-0024: Proof Engine — website changes as controlled experiments

- Status: Accepted
- Date: 2026-09-24
- Builds on: ADR-0011 (GitHub connector), ADR-0012 (fix PRs and verification),
  ADR-0013 (coding agent and repository ownership), ADR-0014 (canonical workspaces)

## Context

Agencies lose clients because they can't connect their work to results. Mellox
already ships real website changes (GEO fix pull requests) but never measures
whether a change worked. Before/after comparisons can't answer that: seasonality,
algorithm updates and site-wide traffic swings move every page at once.

Proof Engine turns a change into an experiment. The change ships to half of a
group of similar pages, the other half stays untouched as a control, and the
lift is the difference between the two, measured with the client's own Google
data. The output is a client-ready report the agency can share under a link.

## What the codebase gave us (Phase 0 findings that shaped this decision)

- **Search Console / GA4 client** (`src/server/analytics/google/api.server.ts`):
  `queryGsc` sends no `dimensionFilterGroups`; `runGa4Report` sends no
  `dimensionFilter`, no `offset` and can only order by sessions. Metric names are
  free strings, so revenue metrics (`totalRevenue`, `purchaseRevenue`) can be
  requested today, but nothing requests or stores them. The OAuth scopes
  (`analytics.readonly`, `webmasters.readonly`) are already enough; no new consent.
- **Dashboard sync is not usable for experiments.** It keeps the top 100 pages per
  day (`topPerDay`, `GSC_DIMENSIONS.page.topN`, `GA4_DIMENSIONS.landing_page.topN`)
  and replaces those rows on every fetch. Low-traffic experiment pages fall out,
  and a page missing from a top-N list is indistinguishable from a zero day. A
  dedicated per-page pull is required; the dashboard sync stays unchanged.
- **One GA4 property and one Search Console site per workspace**
  (`analytics_sources_workspace_kind_unique`). An experiment records both source
  ids so a later property change is detected, not silently mixed in.
- **GitHub write path** (`git.server.ts`): `mellox/` branches only, parent pinned to
  the reviewed base commit, `checkRepoPath` allowlist, and a hard ceiling of
  `MAX_FILES_PER_BATCH = 12` files per pull request. A 30-page group has at least
  15 treatment pages, so **editing one file per page cannot fit in one PR**; the
  data-file strategy below is required, not optional.
- **Ownership** (`assertSourceOwnsHost`, `ownership.ts`) exists only for GitHub
  `workspace_sources` rows. WordPress and Webflow have no ownership proof.
- **WordPress** (`src/server/connectors/wordpress/*`): self-hosted sites connected
  with an application password can `updatePost`/`updatePage` with any body. But:
  - reads never request `context=edit`, so Mellox only sees rendered HTML;
    writing it back would destroy Gutenberg block markup;
  - core WordPress has no meta description, and the `<title>` tag is the post
    title (which most themes also render as the H1), so title and H1 can't be
    changed independently; Yoast and Rank Math don't expose their fields as
    writable REST meta by default;
  - the WordPress.com OAuth connection has read calls only;
  - no revision id is captured, so a precise rollback isn't possible yet.

  **WordPress can't yet edit single pages safely. It moves to v2.**
- **Webflow** requests `sites:read pages:read cms:read` only and has no write
  calls. It moves to v2, as the brief anticipated.
- **Sharing**: `client_share_items` rows can be inserted and updated by any
  workspace member through RLS, including `snapshot`. An experiment report
  therefore can't trust a stored snapshot; the public page renders it from
  server-owned experiment rows.
- **Agency branding**: there's no agency entity. The only logo in the data is the
  client brand's own (`workspace_overview().logo_url` from Brand DNA).
  `client_shares.branding` (jsonb) exists and is rendered by the share page.
- **Grounding** (`fixes/grounding.ts`): facts (numbers, prices, dates, URLs,
  names) must appear in the corpus, and ≥ 85% of added words must be known. The
  second rule would reject most real title and description rewrites, because
  their point is new wording.

## Decision

### 1. Scope of v1

- **Sites:** GitHub-connected repositories whose ownership of the host is verified
  (`assertSourceOwnsHost`), rendered server-side (the change must appear in the
  HTML Mellox fetches without JavaScript), on a framework where a data-file
  integration is possible (next section). Static HTML sites (one file per page)
  and client-rendered SPAs are ineligible in v1, with that reason shown.
- **Change types:** `title`, `meta_description`, `h1`, `intro`, `faq` (visible
  block plus matching `FAQPage` JSON-LD), `cta_text`. Which types a site supports
  is decided by the integration check per site, not assumed.
- **One change versus control.** No multi-variant tests.
- **Metrics:**
  - Search Console clicks, impressions, CTR and position;
  - GA4 organic landing sessions, key events and revenue by landing page;
  - AI-referral sessions, from a source list kept in one file,
    `src/lib/experiments/ai-referrers.ts`.

### 2. How changes ship: an experiment data file plus a one-time integration

A repository gets a **one-time integration PR**, written by the GEO coding agent
(`claudeToolLoop`, read-only tools, plan approval, exact-patch approval). It
does two things:

- adds a small reader module (for example `src/mellox/experiments.ts`) that loads
  `mellox-experiments/*.json` at build/render time;
- edits the page template(s) of the group so each supported field uses the
  override for the current path when one exists, and the existing value
  otherwise.

After that, **every experiment is one JSON file**:

```json
// mellox-experiments/<experiment-id>.json
{ "version": 1, "experiment": "<id>", "pages": { "/products/a": { "title": "…" } } }
```

- *Ship* writes the file with the treatment paths.
- *Rollout* rewrites it with every path, making the change permanent.
- *Rollback* deletes the file.

Each is its own PR with its own approval; Mellox never merges. The JSON is
generated deterministically from approved values, so review is trivial and the
content hash is exact. Control paths never appear in the file until rollout.

Per-framework integration points (the agent follows `framework-playbooks.ts`):

| Framework | Where the override is read |
| --- | --- |
| Next.js App Router | `generateMetadata` and the page component |
| Next.js Pages Router | `getStaticProps` / `getServerSideProps` |
| Astro, Nuxt, SvelteKit, Remix | the route's frontmatter, `useHead`, `+page.server` or `meta` |
| Gatsby | `Head` export |

If the agent can't make the integration safely, the site is not eligible, and
the reason is shown.

This is real code rendered into the HTML, not a client-side overlay. The live
check (§5, step 6) proves it by fetching raw HTML.

### 3. The experiment state machine

```text
draft → awaiting_approval → shipping → awaiting_deploy → running → analyzing
      → concluded (verdict win | loss | inconclusive)
      → rolling_out | rolling_back → closed
```

Plus `invalidated` and `cancelled`.

- `analyzing` is the short state while a daily analysis runs. A run that isn't
  concluded returns to `running`.
- Allowed transitions live in one pure function, `src/lib/experiments/state.ts`,
  tested for every pair. The database has a CHECK on the values.
- Status writes are compare-and-set on the expected current status.

### 4. Data model

One migration, `20260928090000_add_proof_engine.sql`: idempotent, RLS on every
table, workspace-scoped, members `SELECT` only, and every write by the service
role from workers or server functions.

- **`experiments`**
  - `id`, `workspace_id`, `source_id` (the GitHub `workspace_sources` row),
    `gsc_source_id`, `ga4_source_id` (nullable), `page_group_id`;
  - `name`, `hypothesis`, `change_type`;
  - `primary_metric`, `secondary_metrics[]`;
  - `status`, `verdict` (`win`, `loss`, `inconclusive` or null);
  - `pre_period_start`, `pre_period_end`, `planned_min_days` (21),
    `planned_max_days` (42), `mde_estimate`;
  - `assignment_seed`, `assignment_attempts`;
  - `created_by`, `approved_by`, `approved_patch_hash`;
  - timestamps `approved_at`, `shipped_at`, `live_confirmed_at` (= day 0),
    `concluded_at`, `closed_at`, `invalidated_at`, `cancelled_at`;
  - `invalid_reason`, `result` (jsonb, the latest analysis summary);
    `revenue_basis` (jsonb, the data needed for later outcome-based billing).
  - A trigger refuses any change to `primary_metric`, `secondary_metrics`,
    `change_type`, `page_group_id`, the pre-period dates and `assignment_seed`
    once `status <> 'draft'`.
- **`experiment_page_groups`**: `workspace_id`, `source_id`, `label`, `rule`
  (jsonb: URL pattern and template file), `page_count`, `paths[]`,
  `monthly_clicks`, `eligibility` (jsonb), `detected_at`.
- **`experiment_assignments`**
  - `experiment_id`, `workspace_id`, `site_host`, `page_url`, `path`
    (normalized), `arm` (`treatment` or `control`), `stratum` (pair index);
  - `baseline` (jsonb, pre-period totals per metric);
  - `excluded_at`, `excluded_reason`;
  - `active` (maintained by a trigger from the experiment's status).
  - Constraints: unique `(experiment_id, path)`, and a **partial unique index on
    `(workspace_id, site_host, path) WHERE active`**. Across all running,
    shipping and concluded experiments, a page is in at most one. `active` turns
    false only at `closed` or `cancelled`. An invalidated experiment keeps its
    pages until someone closes it, because its change may still be live.
- **`experiment_changes`**: one per treatment page: `path`, `field`, `before`,
  `after`, `grounding` (jsonb).
- **`experiment_deliveries`**
  - `experiment_id`, `kind` (`integration`, `ship`, `rollout`, `rollback`);
  - `files` (jsonb: paths and contents), `content_hash`, `base_sha`,
    `head_branch`;
  - `pr_number`, `pr_url`, `pr_state`, `approved_by`, `approved_at`,
    `merged_at`, `status`.
  - Approval binds `content_hash`, exactly as `approveAndApply` does for GEO fixes.
- **`experiment_metrics_daily`**
  - `experiment_id`, `date`, `path`, `arm`;
  - `clicks`, `impressions`, `position_weighted`;
  - `sessions`, `key_events`, `revenue`, `ai_referral_sessions`.
  - Unique `(experiment_id, date, path)`.
- **`experiment_metric_days`**: `experiment_id`, `date`, `source` (`gsc` or
  `ga4`), `complete`, `pulled_at`. This separates "the page had 0 clicks" from
  "we have no data for that day": Search Console omits zero rows, so absence is
  only zero when the day itself is complete.
- **`experiment_events`**: an append-only audit timeline (state changes, PR
  opened or merged, live confirmed, contamination, analysis run, page excluded).
  Real events only, never model reasoning. A trigger refuses UPDATE and DELETE.
- **`experiment_jobs`**: leased rows `(experiment_id, kind, next_attempt_at,
  lease_until, locked_by, attempts, max_attempts, last_error)`.
  - `kind` is one of `backfill`, `pull_metrics`, `check_live`,
    `check_contamination`, `analyze`, `sync_pr`.
  - Claimed with `claim_experiment_jobs` (`FOR UPDATE SKIP LOCKED`).
- **`workspace_report_branding`**: `workspace_id` (primary key), `display_name`,
  `logo_path` (Storage, under `workspace/<id>/assets/branding/`, so the
  existing storage tenancy rule applies). Set per workspace by
  an admin or owner through a server function; members read it. When it's empty
  the report falls back to the workspace name. It's the smallest fit, since no
  agency entity exists.
- **`client_share_items.kind`** gains `experiment_report` (the column is free
  text; only the route's Zod enum changes).
- **`experiment_overview()`** (`SECURITY INVOKER`) returns, per workspace the
  caller belongs to, `proven_monthly_value`, `proven_value_currency`,
  `won_experiments` and `running_experiments` for the command center. It is a
  separate function so `workspace_overview()` and its migration stay untouched.
- A disconnected repository sets `experiments.source_id` and
  `experiment_deliveries.source_id` to NULL rather than deleting history or
  blocking the disconnect; the experiment is then invalidated by the worker.
- Assignments and changes are frozen by a trigger once the experiment leaves
  `draft` (only exclusion fields and `active` may change); the approved patch
  hash, `live_confirmed_at` and the verdict are final once set.

The feature flag is `FEATURE_FLAG_PROOF_ENGINE_ENABLED`, off by default, with
`_WS_<id>` overrides (`isProofEngineEnabled` in `src/lib/feature-flags.ts`).
When it's off:

- routes and RPCs return 404;
- the sidebar entry and command-center columns are hidden;
- the cron hook skips the workspace.

Plan limits add `maxConcurrentExperiments` to `src/server/plans.ts`: starter 1,
growth 3, agency 15, overridable with `PLAN_<ID>_MAX_EXPERIMENTS`. "Concurrent"
means every status from `awaiting_approval` through `concluded`.

### 5. Flow

1. **Page groups.** Search Console `[page]` rows for the last 56 days are
   clustered by URL pattern: segments that vary become wildcards, for example
   `/products/*`. Each pattern is cross-checked against the repository tree to
   find the route or template file that renders it. Pure clustering lives in
   `src/lib/experiments/groups.ts`.
2. **Proposals.** The agent proposes up to 3 changes through the Anthropic
   gateway (metered, rate-limit tier `experiment-propose`). Its inputs:
   - Brand DNA;
   - open GEO findings for the group's pages;
   - the pages' own text;
   - their top Search Console queries.

   Grounding uses `groundingCheck` with a corpus of site text, Brand DNA and the
   page's own queries. **Facts stay strict** (numbers, prices, dates, names, URLs
   must exist in the corpus). The 85% known-word threshold is lowered for
   experiment copy (to 0.6, a named constant), because new wording is the point.
3. **Assign and prepare.** Eligibility → stratified assignment (§6) → a
   per-treatment-page value generated by the agent, grounded per page → the
   deterministic JSON file → `validate.ts` checks and a content hash.
4. **Approve.** An editor reviews the diff and the split. Approval binds the hash
   (409 if it changed or the base branch moved).
5. **Ship.** A `mellox/exp-<short-id>` branch and a PR through `git.server.ts`.
   Status becomes `awaiting_deploy`. A PR that is closed without merging cancels
   the experiment.
6. **Live check.** A leased `check_live` job, every 15 minutes for up to 7 days
   after merge, fetches up to 10 treatment and 10 control pages through
   `safeFetch`. Every sampled treatment page must show the new value in raw HTML,
   and no control page may. Then `live_confirmed_at` is set and the experiment
   becomes `running`. Seven days without confirmation leaves it in
   `awaiting_deploy` with a visible reason.
7. **Measure.** A daily `pull_metrics` job:
   - **Search Console:** a `[date, page]` query with a `dimensionFilterGroups`
     `contains` filter on the group's common prefix, paginated at 25,000 rows,
     keeping only assigned paths.
   - **GA4:** `[date, landingPage, sessionSource, sessionDefaultChannelGroup]`
     with an `inListFilter` on the assigned paths, metrics `sessions`,
     `keyEvents`, `totalRevenue`, paginated with `offset`.
     `tokensRemainingToday` below a floor defers the job to the next day.
     `landingPage` (path only) is used rather than `landingPagePlusQueryString`,
     so query-string variants don't split a page.
   - Days are pulled up to `lastCompleteDay` (Search Console final data, about
     3 days behind).
8. **Contamination.** A weekly `check_contamination` job re-fetches a sample of
   control pages; the treatment value on a control page means `invalidated`.
   Invalidation also happens when:
   - the Search Console source is `access_lost` for more than 7 days;
   - the source ids change;
   - the repository loses ownership verification.
9. **Analyze** after each pull (§6). The result is written; a verdict only at a
   checkpoint that passes the rules.
10. **Roll out or roll back.**
    - On `win`, a rollout PR (approval required).
    - On `loss`, a rollback PR.
    - On `inconclusive`, the user chooses either.
    - After the delivery is merged and live-checked, the experiment is `closed`.
11. **Report.** A share item of kind `experiment_report`, rendered from the
    experiment rows at view time by `src/app/api/public/share/[slug]/route.ts`,
    after the existing token and password checks. It checks that the
    experiment's `workspace_id` equals the share's, and returns only report
    fields.

Supporting changes:

- **Branches.** `isMelloxBranch` (`src/server/connectors/github/paths.ts`) is
  widened to accept `mellox/exp-<slug>-<6 alphanumerics>` besides
  `mellox/geo-…`; `experimentBranchName` builds them. Every other rule of
  `commitToNewBranch` (parent pinned, `checkRepoPath`, never the base branch)
  is unchanged. `mellox-experiments/*.json` already passes `checkRepoPath`.
- **Rate-limit tiers.** `experiment-propose` (10 per hour, paid proposals and
  per-page generation), `experiment-action` (40 per hour, create, assign,
  cancel). Ship, rollout and rollback PRs use the existing `connector-write`.
- **Flag in the browser.** Flags are server-only and nothing in the sidebar
  was gated before. A small RPC, `experiments/getAvailability`, tells the
  shell whether to show the entry; every other experiment RPC and route
  returns 404 when the flag is off.
- **Report page.** `SharePage.tsx` gets a dedicated renderer for
  `experiment_report`: no approve/reject bar, the workspace's report branding
  at the top, and a small "Powered by Mellox" line at the bottom, with no
  other Mellox marks. It works at phone width.
- **GA4 dimension.** The brief named `landingPagePlusQueryString`; v1 uses
  `landingPage` (path only) so query-string variants don't split one page into
  several rows.

One cron hook, `/api/public/hooks/experiments` (`defineCronRoute`, every 5
minutes, scheduled by `20260928090200_schedule_experiments.sql` following
`20260922090100_schedule_analytics_sync.sql`), claims due jobs within a time
budget. PR state also advances from the existing GitHub webhook.

### 6. Statistics (`src/lib/experiments/`, pure, no I/O)

| File | What it does |
| --- | --- |
| `eligibility.ts` | minimum pages, complete pre-period, power estimate |
| `assign.ts` | stratified pairs, seeded RNG, balance check and re-draws |
| `analysis.ts` | the lift estimate and its interval |
| `placebo.ts` | the randomization test |
| `verdict.ts` | the rules that turn a result into a verdict |
| `revenue.ts` | the estimated monthly value |
| `state.ts` | allowed status transitions |
| `constants.ts` | every threshold as a named constant |

- **Eligibility.**
  - `MIN_PAGES = 30` pages with Search Console data in the last
    `PRE_PERIOD_DAYS = 56` complete days.
  - No single page may hold more than 40% of the group's pre-period primary
    metric; one page must not decide the result.
  - **Power:** from the pre-period, take the daily log ratio of two halves of the
    group under many random pair splits, and estimate the standard error of the
    lift over `w` days with 7-day blocks. Then
    `MDE(w) = (2.36 + 0.84) × SE(w)`, reported for w = 21 and 28. The first term
    is the two-sided z for the per-look α = 0.0182; the second gives 80% power.
    `MDE(28) > 25%` blocks creation, with the number shown.
- **Assignment.**
  - Sort pages by pre-period primary metric, pair neighbours, and put one page of
    each pair in treatment using mulberry32 with a stored seed.
  - An odd page is left out of both arms and recorded as excluded.
  - Balance: `|ΣT − ΣC| / ΣC ≤ 5%` on the primary metric. Otherwise re-draw with
    `seed + k`, up to 50 attempts; the used seed and attempt count are stored.
  - Assignment is a pure function of pages and seed.
- **Estimate (difference-in-differences as a ratio).**
  1. Take daily arm totals `T_d`, `C_d`.
  2. The pre-period ratio `r = ΣT_pre / ΣC_pre`.
  3. The counterfactual `F_d = r · C_d`.
  4. `lift = Σ(T_post) / Σ(F_post) − 1`.
  5. Shocks common to both arms (weekly cycles, algorithm updates, site-wide
     spikes) cancel. A regression fit `T = α + βC` was considered and rejected:
     with 56 points it overfits weekly noise and can go negative.
- **Interval.** A moving-block bootstrap over days (block 7), resampling
  `(T_d, C_d)` pairs within pre and within post, `B = 2,000`, percentile interval.
- **Placebo test.** For the within-pair design, swapping arms inside each pair is
  the design's exact randomization distribution. Draw 1,000 random swap patterns
  (or all of them when 2^pairs ≤ 1,000), recompute the lift, and take the
  two-sided p-value as the share of placebos at least as extreme.
- **Verdicts and repeated looks.** The data is analysed daily for the "early
  read", but a verdict is only evaluated at fixed checkpoints: days 21, 28, 35
  and 42 after `live_confirmed_at`.
  - Checking four times at 95% would make false wins about 12% likely, which
    breaks the A/A requirement.
  - So each checkpoint uses a Pocock-adjusted level: α = 0.0182 per look, an
    overall 5%.
  - **win**: at a checkpoint, the adjusted interval is entirely above 0 and the
    placebo p < 0.0182.
  - **loss**: the same, entirely below 0.
  - **inconclusive**: day 42 without either.
  - Before day 21: "early read, may change", never a verdict.
  - The UI shows the 95% interval as the range.
  - The literal rule "95% interval at any time after day 21" was considered
    and rejected: with daily looks it gives false wins far above 5%, which
    fails the A/A requirement.
- **Data quality.**
  - Days not complete for the needed source are dropped from both arms.
  - A page that 404s or disappears mid-experiment is excluded together with its
    pair partner from the whole analysis, and the event is logged.
  - Zero-traffic pages stay in (their pair still carries information).
- **Revenue.** `extra units/month = (Σ T_post − Σ F_post) / post days × 30.4`.
  - Value = extra units × (pre-period GA4 revenue ÷ pre-period primary units)
    on the treatment pages, labelled "estimated".
  - With no GA4 revenue, key events or clicks are shown, with the reason.
  - `revenue_basis` stores the inputs, so outcome billing can be computed later
    without re-deriving anything.
- **Tests** (Vitest, seeded):
  - A/A: 2,000 simulated experiments, false win or loss ≤ 5.5%;
  - known +15% effect recovered, with the interval containing 15%;
  - a weekly cycle and a site-wide spike produce no false win;
  - missing days, zero-traffic pages, a mid-run 404;
  - eligibility refusals, balance re-draws, seed reproducibility;
  - every state transition.

### 7. Invariants

- Nothing is shown that the data doesn't support. No placeholders, no sample
  data; missing data is said out loud.
- `primary_metric` and the design are locked by the database after `draft`.
- A page is in at most one active experiment (partial unique index).
- Browsers never write experiment status, assignments, metrics, results or
  events. There are no browser write policies at all; RLS gives members SELECT
  only, like `geo_finding_states` resolution.
- No PR is merged and no base branch is touched. Ship, rollout and rollback are
  `mellox/` PRs. Every delivery needs ownership proven within 7 days and an
  approval bound to the exact content hash.
- Only the live check starts the clock; only the analysis at a checkpoint sets a
  verdict.
- Paid calls go through `anthropic-gateway.server.ts` with declared rate-limit
  tiers.
- There is no new queue, search path or cron kernel.

### 8. Out of scope for v1 (future work)

- WordPress (needs `context=edit` reads, block-safe edits, SEO-plugin fields,
  revision capture).
- Webflow (needs write scopes).
- Static HTML and SPA sites.
- AI citation rate as the primary metric. It's allowed as a secondary metric only
  when `isGeoProbesEnabled`.
- Multi-variant tests.
- Automatic merging.
- Outcome-based billing. The data is recorded in `revenue_basis`.

## Decisions made with the product owner

- Verdicts only at fixed checkpoints (days 21, 28, 35, 42) with a
  Pocock-adjusted level; daily early reads never carry a verdict.
- Report branding is per workspace (`workspace_report_branding`).
- The client report keeps a small "Powered by Mellox" footer and nothing else
  from Mellox.

## Open questions

- The GitHub test repository for the end-to-end check, with Search Console and
  GA4 connected to its workspace. The GitHub App needs Contents: write and Pull
  requests: write (already required by ADR-0012).

## Consequences and risks

1. **Many sites won't be eligible.** Thirty comparable pages with measurable
   traffic is a real bar; small sites will see "not enough traffic" rather than a
   weak test. That's intended, but it limits early adoption.
2. **Google's own behaviour is part of the measurement.**
   - Changes take effect only after Google re-crawls the page.
   - Google rewrites many titles in results, so a title test measures what
     searchers actually saw.
   - Internal links between treatment and control pages can leak effects.

   The report states what was changed on the site, not what Google displayed.
3. **The one-time integration is the riskiest code change.** It edits a template
   on the client's site. It goes through the full agent pipeline (read-only
   investigation, plan approval, patch approval, validation, grounding), but it
   is still a template edit the client must review.
4. Search Console attributes clicks to the canonical URL. Pages whose canonical
   points elsewhere are excluded at assignment.
