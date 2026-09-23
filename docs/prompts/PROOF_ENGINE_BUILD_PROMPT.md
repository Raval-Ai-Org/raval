# Build "Proof Engine" in Mellox AI

You are working in the Mellox AI repository. Read `CLAUDE.md`, `MELLOX_AI_MASTER_CONTEXT.md`, `docs/design-system.md`, `docs/adr/0012-geo-fix-pull-requests-and-verification.md`, `docs/adr/0013-geo-coding-agent-and-repo-ownership.md` and `docs/adr/0014-canonical-workspaces.md` before doing anything else. Every convention in `CLAUDE.md` applies to this work without exception.

Work in this order: **investigate, write the plan and ADR, stop for my approval, then build phase by phase.** Do not write feature code before I approve the plan.

---

## 1. What we are building and why

**Proof Engine** turns every website change Mellox makes into a controlled experiment and proves, in plain numbers, whether it worked.

The customer is a marketing agency (and later, in-house brand teams). Agencies lose clients because they cannot connect their work to revenue. In the 2026 AgencyAnalytics benchmark, 55% of agencies say clients regularly ask "can you connect marketing performance to revenue?" and 32% of lost clients leave over "lack of perceived value". Proof Engine gives the agency a report it can hand to its client that says, for example:

> "Rewriting the titles on 40 product pages caused +14% organic clicks versus 40 matched pages we left alone. Estimated value: $3,200/month. Confidence: high."

The one-sentence product: **Mellox's agent proposes a change, ships it as a real code or CMS change to half of a group of similar pages, leaves the other half untouched as a control, measures both for a few weeks using the client's own Google data, calculates the causal lift, and tells the agency to roll it out or roll it back.**

What makes this different from competitors, and must stay true in the implementation:

1. Changes ship as **real code or CMS edits** through our existing connectors, not a JavaScript overlay.
2. Every result is measured against a **control group**, not a before/after comparison.
3. Results are expressed in **clicks, conversions and money**, with an honest confidence level.
4. Output is a **client-ready report** the agency can share under a link.

---

## 2. Non-negotiable rules

These come on top of `CLAUDE.md`. If anything here conflicts with `CLAUDE.md`, `CLAUDE.md` wins and you tell me about the conflict.

- **Never fabricate data.** No placeholder numbers, no mocked results in production paths, no "sample" data shown as if it were real. If data is missing, the UI says so.
- **Never claim a result the statistics do not support.** A result is only "win" or "loss" when it passes the rules in section 6. Everything else is "running", "early read" or "inconclusive".
- **The primary metric is locked when the experiment starts.** It cannot be changed afterwards (prevents cherry-picking a metric that happened to go up). Enforce this in the database.
- **Never merge or push to a base branch.** Rollout and rollback are new pull requests through `src/server/connectors/github/git.server.ts`, exactly like GEO fixes. The client merges.
- **Ownership first.** No experiment on a site unless `assertSourceOwnsHost` (see `src/server/geo/fixes/service.server.ts` and `src/lib/connectors/ownership.ts`) proves the connected source builds that host.
- **Approval binds the exact patch hash**, reusing the GEO fix approval pattern.
- **One running experiment per page.** Enforce with a database constraint, not only in code.
- **Server owns all state.** Browsers never write experiment status, assignments, metrics or results. RLS must refuse it, the same way `geo_finding_states.state = 'resolved'` is refused.
- **Paid AI calls only through the gateways** (`anthropic-gateway.server.ts` / `ai-gateway.server.ts`) with a declared rate-limit tier.
- **No new queue service, no new search path, no new cron kernel.** Use leased job rows, `defineCronRoute`, and the existing Google API client.
- **Feature flag:** `FEATURE_FLAG_PROOF_ENGINE_ENABLED`, off by default, with the per-workspace override pattern used in `src/lib/feature-flags.ts`. When off, the surface is hidden and routes return 404.
- Do not touch the public landing page (`src/app/page.tsx`).

---

## 3. Phase 0: investigate and plan (stop after this phase)

Read and understand these before planning. Report back what you found, especially anything that contradicts my assumptions below.

**Data sources**
- `src/server/analytics/google/api.server.ts`: the GA4 Data API and Search Console client. My understanding: `queryGsc` does not support `dimensionFilterGroups`, and `runGa4Report` does not support `dimensionFilter` or revenue metrics yet. Confirm.
- `src/server/analytics/sync/*`: the existing sync stores **top-N** dimension rows (`replaceDimensionRows`). My assumption is that this is not enough for experiments, because we need complete daily numbers for every page in the experiment, including low-traffic ones. Confirm, and plan a dedicated per-page pull rather than changing how the dashboard sync works.
- `supabase/migrations/20260922090000_add_google_analytics_connector.sql` and `20260922090200_add_analytics_aggregates.sql`: the source/connection tables.

**Shipping changes**
- `src/server/connectors/github/git.server.ts` (`commitToNewBranch`, `createPullRequest`, `getPullRequest`, `listDeployments`), `src/server/geo/fixes/*` (proposal → approve → PR → verify), `src/server/geo/agents/*` (the coding agent and `claudeToolLoop`).
- `src/server/connectors/wordpress/*` and `src/server/connectors/webflow/*`: find out whether each can edit a single page or CMS item's title, meta description and body. Report exactly what each supports.

**Sharing, agency and UI**
- `src/app/api/shares/route.ts`, `src/app/share/[slug]/*`, `src/server/shares/link-token.server.ts`.
- `src/lib/agency/command-center.ts`, `src/app/agency/*`.
- `src/components/app/surface/SurfaceLayout.tsx`, `AppModalShell.tsx`, the Backlinks and Competitors surfaces as reference implementations, and how the sidebar entries are declared.
- `src/server/plans.ts` for plan limits.

**Deliverables for Phase 0**
1. A short findings report: what exists, what is missing, and any risks.
2. `docs/adr/00XX-proof-engine-controlled-experiments.md` (use the next free ADR number) covering: the problem, the decision, the data model, the statistics method, the ship/rollout/rollback flow, the invariants, and what is out of scope for v1.
3. A phase-by-phase task list with the files you will create or change.

**Then stop and wait for my approval.**

---

## 4. Scope of v1

**In scope**
- Sites connected through **GitHub** (required for v1), plus **WordPress** if Phase 0 shows it can edit single pages safely. Webflow only if its connector already supports per-item writes; otherwise list it as v2.
- Change types:
  1. Page title tag
  2. Meta description
  3. H1
  4. Intro paragraph (first 1 to 3 sentences of main content)
  5. FAQ block with matching `FAQPage` JSON-LD
  6. Primary call-to-action text
- Metrics: Search Console clicks, impressions and CTR; GA4 sessions, key events (conversions) and revenue by landing page; AI-referral sessions (sessions whose source is chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com, claude.ai and similar; keep the list in one config file).
- Client-facing report via share link, white-labeled with the agency's name and logo.

**Out of scope for v1** (write these in the ADR as future work)
- AI citation rate as a primary metric (the probes are paid and flagged off; it can be a secondary metric only if `isGeoProbesEnabled` is on).
- Multi-variant tests (A/B/C). v1 is one change versus control.
- Automatic merging of anything.
- Outcome-based billing. Record the data needed for it, but do not build billing.

---

## 5. Data model

Design the exact schema in Phase 0, but it must cover the following. Follow the migration rules in `CLAUDE.md`: idempotent, RLS on every table, workspace-scoped, service-role writes only from workers.

- **`experiments`**: id, workspace_id, source_id (connected site), analytics_source ids (GSC and GA4), name, hypothesis (plain text), change_type, page_group_id, primary_metric (locked once status leaves `draft`, enforced by trigger), secondary_metrics, status, pre_period start/end, planned duration, minimum detectable effect, created_by, approved_by, approved_patch_hash, timestamps for each state transition, result summary JSON, result verdict.
  - Status lifecycle: `draft → awaiting_approval → shipping → awaiting_deploy → running → analyzing → concluded (win | loss | inconclusive) → rolling_out | rolling_back → closed`, plus `invalidated` and `cancelled`. Encode allowed transitions in one pure function, tested, and a database CHECK on the status values.
- **`experiment_page_groups`**: the cluster of comparable pages (for example "product pages under /products/"), with the detection rule and page count.
- **`experiment_assignments`**: experiment_id, page_url, normalized path, arm (`treatment` | `control`), stratum, pre-period baseline numbers. Unique on (experiment_id, path). Partial unique index so a path can only be in one experiment that is not closed/cancelled.
- **`experiment_changes`**: per treatment page, the before and after content, the file path or CMS item id, and the patch hash. Also the PR number/URL or CMS revision id for ship, rollout and rollback.
- **`experiment_metrics_daily`**: experiment_id, date, path, arm, clicks, impressions, position_weighted, sessions, key_events, revenue, ai_referral_sessions. Unique on (experiment_id, date, path).
- **`experiment_events`**: append-only audit timeline (state changes, PR opened, deploy detected, contamination detected, analysis run). Real events only, never model reasoning, same rule as `geo_agent_events`.
- **`experiment_jobs`** (or reuse a generic job table if one fits): leased rows for "pull metrics", "check deploy", "analyze", claimed with SKIP LOCKED like the other workers.
- Agency branding for white-label reports: check whether the workspace or agency already stores a display name and logo. If not, add the smallest possible fields.

Regenerate types with `npm run db:types` and run `npm run db:verify`.

---

## 6. The statistics (the part that must be right)

Put all of this in a **pure, fully tested module** at `src/lib/experiments/` with no database or network access. It is the core of the product's credibility.

### 6.1 Eligibility (before an experiment can be created)
- Page group must have at least **30 pages** with Search Console data in the last 56 days (make this a named constant). Fewer than that: refuse with a clear reason.
- Pre-period of **56 days** of complete data (use `lastCompleteDay` semantics; Search Console data lags about 2 to 3 days and must be `dataState: "final"`).
- Group must have enough traffic for the chosen metric that a realistic lift is detectable. Implement a simple **power estimate** from pre-period variance: given the pages and daily noise, what minimum lift can we detect in 21 and 28 days? Show it to the user ("With these pages we can reliably detect a change of about 8% or more in 28 days"). If the minimum detectable effect is above 25%, block creation and explain why.

### 6.2 Assignment
- **Stratified randomization:** sort pages by pre-period value of the primary metric, form consecutive pairs (or blocks), and randomly assign one page per pair to treatment. Use a seeded RNG and store the seed so the assignment is reproducible.
- Check balance: the treatment and control totals in the pre-period must be within a tolerance (for example 5%). If not, re-draw with a new seed, up to N times, and record which seed was used.

### 6.3 Analysis
- Primary method: **difference-in-differences on the group-level daily series**, expressed as a ratio. Fit the relationship between treatment and control during the pre-period, forecast what treatment would have done in the post-period without the change, and report the lift as (actual − forecast) / forecast.
- Confidence interval: **block bootstrap over days** (blocks of 7 days to respect weekly seasonality).
- Significance check: a **placebo/permutation test**. Re-run the same analysis with random fake assignments on the same data many times; the real effect must be more extreme than 95% of the placebos.
- Verdict rules:
  - `win`: minimum duration reached (default 21 days after deploy is confirmed), the 95% interval is entirely above zero, and the placebo test passes.
  - `loss`: same, but entirely below zero.
  - `inconclusive`: maximum duration (default 42 days) reached without a win or loss.
  - Before minimum duration: show an **"early read"** with a warning that it can change. Never show a verdict early.
- Revenue estimate: `lift in primary metric × revenue per unit from GA4 pre-period` for the treatment pages, shown as a monthly figure and **always labeled "estimated"**. If GA4 has no revenue data, show conversions or clicks only and say why.

### 6.4 Required tests
- **A/A simulation:** on synthetic data with no real effect, over many simulated experiments, the false "win or loss" rate must be at or below about 5%.
- **Known-effect recovery:** inject a +15% lift; the analysis must detect it and the interval must contain 15%.
- Seasonality: weekly patterns and a site-wide traffic spike affecting both arms must not create a false win.
- Missing days, zero-traffic pages, a page that disappears (404) mid-experiment.
- Eligibility refusals, balance re-draws, reproducible assignment from a seed.
- The status transition function (every allowed and disallowed transition).

---

## 7. The system flow (server side)

Follow the GEO fix workflow as the template. All steps are workspace-scoped, role-gated (`minRole: "editor"` for anything with side effects) and audited.

1. **Discover page groups.** From the site's Search Console page data plus a crawl of the connected source, cluster pages by URL pattern and template (for GitHub: the route or template file that renders them). Store as `experiment_page_groups`.
2. **Propose hypotheses.** For a chosen group, the agent (through the Anthropic gateway, metered, grounded with `fixes/grounding.ts` rules, no invented facts) proposes up to 3 concrete changes, using Brand DNA, existing GEO findings for those pages, and the pages' Search Console queries. Each proposal states the change type, a plain-English hypothesis and example before/after on 2 pages.
3. **Assign and prepare.** Run eligibility and assignment. Generate the change for **every** treatment page. For templated sites, prefer a small, reviewable approach, for example a data file listing treatment paths and their new values that the template reads, rather than editing dozens of files. Decide the best pattern per framework in Phase 0 and explain it in the ADR. Control pages must not change.
4. **Approve.** Editor reviews the diff and assignment. Approval binds the patch hash.
5. **Ship.** Open a PR (GitHub) or apply CMS edits (WordPress, if in scope). Status `awaiting_deploy`.
6. **Confirm it is live.** A leased job fetches a sample of treatment pages and control pages through `src/server/safe-fetch.ts`. Treatment pages must contain the new content; control pages must not. Only then set the experiment start date to the confirmed live date. If the PR is closed unmerged, the experiment is `cancelled`.
7. **Measure daily.** A leased job pulls per-page daily data for every assigned path from Search Console (add page filtering or paginate `[date, page]` queries and keep only our paths) and GA4 (add `dimensionFilter`, `landingPagePlusQueryString`, `sessionSource`, and revenue metrics; respect `tokensRemainingToday` quotas and back off). Upsert into `experiment_metrics_daily`.
8. **Watch for contamination.** Weekly re-fetch of a sample of control pages: if the change appears on control pages (for example the client rolled it out early), mark the experiment `invalidated` with the reason. Also invalidate if the site's connection is lost for more than N days.
9. **Analyze.** After each daily pull, run the pure analysis. Write the result summary and, once rules allow, the verdict.
10. **Roll out or roll back.** On `win`, prepare a rollout PR that applies the change to the control pages too (approval required). On `loss`, prepare a revert PR for the treatment pages (approval required). On `inconclusive`, let the user choose either.
11. **Report.** Generate a report that can be shared through the existing share-link system (add an `experiment_report` kind). Public share pages must show only the report, never other workspace data, and must go through the existing share token checks.

Cron: one hook, for example `/api/public/hooks/experiments`, built with `defineCronRoute`, scheduled by a migration that follows the pattern of `20260922090100_schedule_analytics_sync.sql`. It claims and advances due jobs within a time budget.

---

## 8. The user experience

I am not a designer, so make the UX decisions yourself, following `docs/design-system.md` strictly: `AppModalShell` (size `2xl`), `SurfaceLayout` rail, `Tile`, `Stat`, one lime primary action per screen, pill buttons, icons from `@/components/icons`, `EmptyState` / `ErrorState` / `Skeleton`, plain short copy, no explanatory paragraphs. Use the Backlinks and Competitors surfaces as your visual reference.

**Name in the product:** "Experiments" in the sidebar (Intelligence group), page title "Proof".

**Route:** `/w/<id>/app/experiments`, built with `src/lib/workspace/paths.ts`.

**Rail sections**

1. **Overview**
   - Stats: proven extra clicks per month, estimated extra revenue per month (labeled estimated), experiments won / running / total.
   - List of running experiments with a small progress bar ("Day 12 of 21") and the current early read.
   - Empty state when nothing exists yet: one sentence and a "Start an experiment" button.
   - If Google or a site connector is missing: a checklist tile showing what to connect, with buttons to the existing connect flows.

2. **Experiments** (list): name, page group, change type, status chip, lift with interval, verdict. Filter by status.

3. **New experiment** (a 5-step wizard in the same window, with a step indicator):
   1. **Site:** pick the connected site. Show whether Search Console and GA4 are connected and the eligibility check result.
   2. **Pages:** pick a page group. Each option shows page count, monthly clicks, and the "we can detect about X% change in Y days" estimate. Ineligible groups are shown disabled with the reason.
   3. **Change:** the agent's up to 3 proposals as selectable cards, each with the hypothesis and a before/after example. Option to write your own hypothesis (still generated and grounded by the agent).
   4. **Review:** side-by-side diff for 2 sample pages, the split ("20 pages get the change, 20 stay the same"), the locked primary metric, expected duration, and the files or CMS items that will change.
   5. **Approve:** one lime button, "Approve and open pull request". Then show the PR link and the next step ("Merge the pull request. We will start measuring as soon as the change is live.").

4. **Experiment detail**
   - Header: name, status chip, verdict when available.
   - Status timeline (from `experiment_events`): created, approved, PR opened, live confirmed, day N, concluded.
   - Main chart: daily primary metric, treatment vs control, with the pre-period shaded and the start date marked. A second small chart for cumulative lift with its confidence band. Use the `dataviz` guidance and existing chart components if the app has them.
   - Result card in plain language: "Titles rewritten on 20 pages → +14% clicks (range +6% to +22%). Confidence: high. Estimated value: $3,200/month." During the run: "Early read, may change."
   - Actions depending on state: "Roll out to all pages", "Roll back", "Share report", "Cancel experiment".
   - Pages table: each page, its arm, before/after content, and its own numbers.

5. **Reports**: list of shared reports with copy link and revoke.

**Client report page** (public share link): agency logo and name at the top, the result card, the chart, what changed with 2 examples, the method in one sentence ("We changed 20 pages and compared them with 20 similar pages we left alone"), and the date range. No Mellox upsell and nothing from the rest of the workspace. Must look good on a phone.

**Agency command center:** add a "Proven impact" column per client workspace (sum of estimated monthly value from won experiments, labeled estimated) and a count of running experiments.

**Plan limits:** add concurrent-experiment limits to `src/server/plans.ts` (suggest starter 1, growth 3, agency 15) and show a friendly limit message.

Every state needs its UI: loading, empty, error, not eligible, waiting for merge, waiting for deploy, running, early read, concluded, invalidated, cancelled.

---

## 9. Phases (after I approve the plan)

Finish each phase fully, including tests, before the next. At the end of each phase: run `npm run typecheck && npm run lint && npm test && npm run build`, and tell me in plain language what now works, what does not yet, and anything you could not verify.

1. **Foundation:** migration(s), types, feature flag, plan limits, status transition function, ADR committed.
2. **Statistics core:** `src/lib/experiments/` with every test in section 6.4 passing.
3. **Data pull:** Google API extensions (page filtering, GA4 filters and revenue, AI-referral sources), per-page metrics job, backfill of pre-period data, live test in `tests/live/` that only reads.
4. **Page groups and eligibility:** clustering, eligibility and power estimate, exposed through RPC in `src/server/fns/experiments.ts` with stubs in `src/lib/experiments.functions.ts`.
5. **Hypotheses and change generation:** agent proposals, grounding, per-page changes, template/data-file strategy, validation.
6. **Ship and confirm live:** approval with patch hash, PR creation, deploy/live confirmation, contamination checks, cron hook and schedule migration.
7. **Analysis loop and verdicts:** daily analysis, verdict rules, rollout and rollback PRs.
8. **UI:** the full surface from section 8, sidebar entry, every state.
9. **Reports and agency view:** share-link report, white-label branding, command center column.
10. **Documentation:** update `CLAUDE.md` with a "Proof Engine" section in the same style as the others (invariants and file map), `docs/README.md` index, and a short user-facing explanation in the relevant docs file.

---

## 10. Definition of done

- All unit tests pass, including the A/A simulation and known-effect recovery.
- `npm run typecheck && npm run lint && npm test && npm run build` pass.
- `npm run db:verify` passes and the migrations are applied to the real database following the "Verifying work" section of `CLAUDE.md`.
- A live read-only test pulls real per-page Search Console and GA4 data for a connected test site.
- The full flow was exercised end to end on a real test repository I own: create experiment → approve → PR opened → merged → live confirmed → metrics pulled → analysis runs → report shared. If any step could not be exercised (for example because it needs 21 days of real time), say so plainly, and show the step working on a backdated or simulated timeline **clearly labeled as a test**, never in production data.
- With the flag off, nothing about the feature is visible or reachable.
- A short final summary for me in plain language: what was built, how to turn it on, what I need to configure (env vars, Google scopes, GitHub permissions), known limitations, and the three most important risks.

Ask me questions whenever a decision is genuinely mine to make (pricing, naming, what the client report says). For everything else, choose the option most consistent with the existing codebase and explain your choice briefly.
