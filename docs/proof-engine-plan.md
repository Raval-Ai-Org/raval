# Proof Engine — build plan

Decision record: [ADR-0024](adr/0024-proof-engine-controlled-experiments.md).

Each phase ends with:

- `npm run typecheck && npm run lint && npm test && npm run build`;
- migrations applied to the real database after a dry run;
- a plain-language status note.

Nothing is committed by Claude. The changes are left in the working tree for
you to commit.

## Phase 1 — Foundation

- `supabase/migrations/20260928090000_add_proof_engine.sql`:
  - tables `experiments`, `experiment_page_groups`, `experiment_assignments`,
    `experiment_changes`, `experiment_deliveries`, `experiment_metrics_daily`,
    `experiment_metric_days`, `experiment_events`, `experiment_jobs`,
    `agency_branding`;
  - status and verdict CHECKs;
  - the design-lock trigger;
  - the `active` trigger and the partial unique index;
  - the append-only trigger on events;
  - RLS (members SELECT, service role writes);
  - `claim_experiment_jobs`;
  - the `experiment_report` share kind.
- `src/integrations/supabase/types.ts` (via `npm run db:types`).
- `src/lib/feature-flags.ts`: `isProofEngineEnabled(workspaceId)`.
- `src/server/plans.ts`: `maxConcurrentExperiments` plus the env override.
- `src/lib/experiments/state.ts` and `state.test.ts`: the transition function,
  tested for every pair.
- `src/lib/experiments/constants.ts`.
- `src/server/rate-limit.ts`: the `experiment-propose` and `experiment-action`
  tiers.

## Phase 2 — Statistics core (pure)

- `src/lib/experiments/`:
  - `rng.ts`, `eligibility.ts`, `power.ts`, `assign.ts`, `analysis.ts`,
    `bootstrap.ts`, `placebo.ts`, `verdict.ts`, `revenue.ts`, `series.ts`
    (daily aggregation, missing days, pair exclusion);
  - `simulate.ts` (a synthetic-data generator for the tests only);
  - tests for each, including the A/A, known-effect, seasonality, spike,
    missing-day and 404 cases.

## Phase 3 — Data pull

- `src/server/analytics/google/api.server.ts`:
  - `queryGsc` gets `dimensionFilterGroups`;
  - `runGa4Report` gets `dimensionFilter`, `offset` and a general `orderBys`.

  The additions are backward compatible; the dashboard sync is unchanged.
- `src/lib/experiments/ai-referrers.ts`: the one list of AI referral hosts.
- `src/lib/experiments/paths.ts`: URL to normalized path (host, trailing slash,
  query, case).
- `src/server/experiments/metrics.server.ts`: per-page GSC and GA4 pull,
  quota back-off, completeness rows.
- `src/server/experiments/store.ts`, `store.server.ts`, `store.memory.ts`:
  store-agnostic, like the analytics sync.
- `src/server/experiments/jobs.server.ts`: claim and advance within a budget;
  the backfill job.
- `tests/live/experiments-data.live.ts`: read-only, pulls real per-page data for
  the connected test site.

## Phase 4 — Page groups and eligibility

- `src/lib/experiments/groups.ts` and its test: URL-pattern clustering.
- `src/server/experiments/groups.server.ts`: GSC pages plus the repository tree
  to find template files.
- `src/server/experiments/service.server.ts`: the workspace-scoped service
  (create draft, eligibility, list, detail).
- `src/server/fns/experiments.ts`, registered in `src/server/fns/index.ts`.
- `src/lib/experiments.functions.ts`: the browser stubs.

## Phase 5 — Hypotheses and change generation

- `src/server/experiments/integration.server.ts`: detect an existing Mellox
  integration; otherwise start a GEO-agent run with an "experiment integration"
  task. Changes in `src/server/geo/agents/` are additive: a new task kind and
  prompt, reusing `runner.server.ts`.
- `src/server/experiments/propose.server.ts`: up to 3 proposals through the
  gateway.
- `src/server/experiments/changes.server.ts`: per-page values.
- `src/lib/experiments/datafile.ts` and its test: the deterministic JSON and
  its hash.
- `src/lib/experiments/grounding.ts`: an experiment-copy wrapper over
  `fixes/grounding.ts` with strict facts and a 0.6 threshold.
- `src/server/geo/agents/framework-playbooks.ts`: override-reader conventions
  per framework.

## Phase 6 — Ship and confirm live

- `src/server/experiments/deliveries.server.ts`:
  - approve by hash (reusing the `approveAndApply` pattern and
    `assertSourceOwnsHost`);
  - `commitToNewBranch` and `createPullRequest`;
  - PR sync, reusing the existing webhook plus polling.
- `src/lib/experiments/live-check.ts` and its test: HTML extraction and the
  comparison per field.
- `src/server/experiments/live-check.server.ts`: the live check and the
  contamination check through `safeFetch`.
- `src/app/api/public/hooks/experiments/route.ts`: `defineCronRoute`.
- `supabase/migrations/20260928090100_schedule_experiments.sql`.
- `src/app/api/integrations/github/webhook`: route PR events for `mellox/exp-*`
  branches.

## Phase 7 — Analysis loop and verdicts

- `src/server/experiments/analyze.server.ts`: build the series, run the pure
  analysis, CAS the status, write `result`, set the verdict only at checkpoints.
- Rollout and rollback deliveries, then close after their live check.

## Phase 8 — UI

- `src/app/w/[workspaceId]/app/experiments/page.tsx`: `AppModalShell` size
  `2xl` over `AppShell`.
- `src/components/app/experiments/`:
  - `ExperimentsRoute.tsx`, `ExperimentsPanel.tsx` (the `SurfaceLayout` rail:
    Overview, Experiments, New, Reports);
  - `Overview.tsx`, `ExperimentList.tsx`, `NewExperimentWizard.tsx` (5 steps),
    `ExperimentDetail.tsx`, `ResultCard.tsx`, `LiftChart.tsx` (Recharts),
    `PagesTable.tsx`, `ReportsList.tsx`;
  - `hooks.ts` (React Query keys include the workspace id);
  - `experiments-ui.tsx` (status chips, one component for every state).
- `src/app/app/AppShell.tsx`: the "Experiments" entry in Intelligence, shown
  only when the flag is on.
- `src/lib/app-events.ts`: `open:experiments`.

## Phase 9 — Reports and agency view

- `src/app/api/shares/route.ts`: the `experiment_report` kind. Its snapshot is
  ignored; branding comes from `agency_branding`.
- `src/app/api/public/share/[slug]/route.ts`: build the report view from
  experiment rows after the token checks, with the workspace-match check.
- `src/app/share/[slug]/ExperimentReport.tsx`: the mobile-first report.
- `src/app/share/[slug]/SharePage.tsx`: render the new kind.
- `supabase/migrations/20260928090200_workspace_overview_experiments.sql`:
  `proven_monthly_value` and `running_experiments`.
- `src/lib/agency/command-center.ts` and `src/app/agency/AgencyPage.tsx`: the
  "Proven impact" column.
- Agency branding editor: a small tile in Settings.

## Phase 10 — Documentation

- `CLAUDE.md`: a "Proof Engine" section (invariants and file map).
- `docs/README.md` index.
- `docs/proof-engine.md`: the user-facing explanation.
- `.env.example` and `docs/configuration.md`: the new flag and plan overrides.
