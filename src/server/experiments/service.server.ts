// service.server.ts — the Proof Engine lifecycle (ADR-0024 §3, §5).
//
//   create     eligibility on real pre-period data → a draft experiment; the
//              heavy part (fetch pages, split, write copy, draft the PR) runs
//              right after the response and the draft shows its progress
//   approve    draft → awaiting_approval (the design locks in the database)
//              → shipping → pull request → awaiting_deploy
//   decide     after a verdict: roll out, roll back, or keep as is
//   stop       a live test can be stopped (invalidated) and rolled back
//
// Callers (src/server/fns/experiments.ts) authenticate; every function here
// checks the role it needs, reads through the caller's RLS client first, and
// writes with the service role.
import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  CHANGE_TYPES,
  MAX_DURATION_DAYS,
  MDE_BLOCK_DAYS,
  METRICS,
  MIN_DURATION_DAYS,
  type ChangeType,
  type ExperimentMetric,
} from "@/lib/experiments/constants";
import { assignPages } from "@/lib/experiments/assign";
import type {
  DeliveryView,
  EventView,
  ExperimentDetail,
  ExperimentSummary,
  ExperimentsOverview,
  HypothesisView,
  PairView,
  ResultView,
} from "@/lib/experiments/contracts";
import {
  parseFieldValue,
  stringifyFieldValue,
  type ExperimentEntry,
  type FieldValue,
} from "@/lib/experiments/datafile";
import { checkEligibility } from "@/lib/experiments/eligibility";
import { newSeed } from "@/lib/experiments/random";
import { pageTotal, unitField } from "@/lib/experiments/series";
import { countsTowardLimit, type ExperimentStatus } from "@/lib/experiments/state";
import { getPlanLimits } from "@/server/plans";
import {
  cancelJobs,
  daysBetween,
  ExperimentError,
  loadExperiment,
  patchExperiment,
  recordEvent,
  requireEditor,
  transition,
  type AssignmentRow,
  type ChangeRow,
  type DeliveryRow,
  type ExperimentCtx,
  type ExperimentRow,
} from "./core.server";
import {
  approveAndOpen,
  buildDataFileDelivery,
  closeOpenPr,
  dataFileFor,
  storedFiles,
} from "./deliveries.server";
import { defaultApiFor } from "./google.server";
import { groupViews, loadGroup, loadSeries } from "./groups.server";
import { fileDiffs } from "./integration.server";
import { storeSeries } from "./metrics.server";
import { beforeValue, fetchPages } from "./pages.server";
import {
  brandContext,
  generateValues,
  groundValue,
  openFindingTitles,
  proposeHypotheses,
  queriesByPage,
} from "./propose.server";
import { brandingView, SHAREABLE } from "./report.server";
import {
  loadSiteSources,
  normHost,
  requireGsc,
  requireWritableSource,
  setupState,
} from "./sources.server";

/** Largest experiment: the busiest pages with data, so page fetches and copy stay bounded. */
export const MAX_EXPERIMENT_PAGES = 120;
/** Fewest usable pairs after exclusions for a test to go ahead. */
export const MIN_PAIRS = 10;

type PrepareState =
  | { state: "running"; startedAt: string }
  | { state: "ready"; at: string; excluded: number }
  | { state: "failed"; at: string; error: string };

/* ───────────────────────── views ───────────────────────── */

function prepareOf(row: ExperimentRow): PrepareState | null {
  return (((row.result ?? {}) as { prepare?: PrepareState }).prepare ??
    null) as PrepareState | null;
}

function summarize(
  row: ExperimentRow,
  groupLabels: Map<string, { label: string; pattern: string }>,
): ExperimentSummary {
  const result = (row.result ?? {}) as Partial<ResultView>;
  const group = row.page_group_id ? groupLabels.get(row.page_group_id) : undefined;
  return {
    id: row.id,
    name: row.name,
    status: row.status as ExperimentStatus,
    verdict: (row.verdict as ExperimentSummary["verdict"]) ?? null,
    changeType: row.change_type as ChangeType,
    primaryMetric: row.primary_metric as ExperimentMetric,
    groupLabel: group?.label ?? null,
    pattern: group?.pattern ?? null,
    siteHost: row.site_host,
    createdAt: row.created_at,
    liveConfirmedAt: row.live_confirmed_at,
    daysLive: row.live_confirmed_at ? daysBetween(row.live_confirmed_at) : null,
    lift: row.lift === null ? null : Number(row.lift),
    liftLow: row.lift_low === null ? null : Number(row.lift_low),
    liftHigh: row.lift_high === null ? null : Number(row.lift_high),
    earlyLift: typeof result.lift === "number" ? result.lift : null,
    estimatedMonthlyValue:
      row.estimated_monthly_value === null ? null : Number(row.estimated_monthly_value),
    valueCurrency: row.value_currency,
    invalidReason: row.invalid_reason,
  };
}

async function groupLabelMap(workspaceId: string) {
  const { data } = await supabaseAdmin
    .from("experiment_page_groups")
    .select("id, label, pattern")
    .eq("workspace_id", workspaceId);
  return new Map((data ?? []).map((g) => [g.id, { label: g.label, pattern: g.pattern }]));
}

async function planLimit(workspaceId: string) {
  const [{ data: ws }, { data: rows }] = await Promise.all([
    supabaseAdmin.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle(),
    supabaseAdmin.from("experiments").select("status").eq("workspace_id", workspaceId),
  ]);
  return {
    max: getPlanLimits(ws?.plan ?? null).maxConcurrentExperiments,
    used: (rows ?? []).filter((r) => countsTowardLimit(r.status as ExperimentStatus)).length,
  };
}

export async function overview(ctx: ExperimentCtx): Promise<ExperimentsOverview> {
  const sources = await loadSiteSources(ctx.workspaceId);
  const [groups, list, limit, branding, labels, proven] = await Promise.all([
    groupViews(ctx.workspaceId, sources),
    ctx.supabase
      .from("experiments")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    planLimit(ctx.workspaceId),
    brandingView(ctx.workspaceId),
    groupLabelMap(ctx.workspaceId),
    ctx.supabase.rpc("experiment_overview"),
  ]);
  if (list.error) throw new Error(list.error.message);
  const mine = (proven.data ?? []).find(
    (r: { workspace_id: string }) => r.workspace_id === ctx.workspaceId,
  ) as { proven_monthly_value: number | null; proven_value_currency: string | null } | undefined;
  return {
    setup: setupState(sources),
    groups,
    experiments: ((list.data ?? []) as ExperimentRow[]).map((r) => summarize(r, labels)),
    limit,
    branding,
    canEdit: ctx.canEdit,
    canManage: ctx.canManage,
    provenMonthlyValue:
      mine?.proven_monthly_value === null || mine?.proven_monthly_value === undefined
        ? null
        : Number(mine.proven_monthly_value),
    provenCurrency: mine?.proven_value_currency ?? null,
  };
}

function deliveryView(row: DeliveryRow): DeliveryView {
  const v = (row.validation ?? {}) as { problems?: string[]; explanation?: string };
  return {
    id: row.id,
    kind: row.kind as DeliveryView["kind"],
    status: row.status,
    contentHash: row.content_hash,
    baseBranch: row.base_branch,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    files: fileDiffs(storedFiles(row)),
    fields: (row.fields ?? []) as ChangeType[],
    explanation: v.explanation ?? null,
    problems: v.problems ?? [],
    error: row.error,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    mergedAt: row.merged_at,
    liveAt: row.live_at,
  };
}

export async function getDelivery(ctx: ExperimentCtx, deliveryId: string): Promise<DeliveryView> {
  const { data, error } = await ctx.supabase
    .from("experiment_deliveries")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ExperimentError("Not found", 404);
  return deliveryView(data as DeliveryRow);
}

function pairViews(
  assignments: AssignmentRow[],
  changes: ChangeRow[],
  field: ChangeType,
): PairView[] {
  const after = new Map(changes.map((c) => [c.path, c]));
  const byStratum = new Map<number, AssignmentRow[]>();
  for (const a of assignments) byStratum.set(a.stratum, [...(byStratum.get(a.stratum) ?? []), a]);
  const out: PairView[] = [];
  for (const [stratum, rows] of [...byStratum.entries()].sort((a, b) => a[0] - b[0])) {
    const t = rows.find((r) => r.arm === "treatment");
    const c = rows.find((r) => r.arm === "control");
    if (!t || !c) continue;
    const base = (a: AssignmentRow) =>
      ((a.baseline ?? {}) as { fieldValue?: string | null }).fieldValue ?? null;
    const change = after.get(t.path);
    out.push({
      stratum,
      treatment: {
        path: t.path,
        before: change?.before ?? base(t),
        after: change ? parseFieldValue(field, change.after) : null,
        excluded: t.excluded_reason ?? (t.excluded_at ? "Excluded" : null),
      },
      control: {
        path: c.path,
        before: base(c),
        excluded: c.excluded_reason ?? (c.excluded_at ? "Excluded" : null),
      },
    });
  }
  return out;
}

export async function getDetail(ctx: ExperimentCtx, id: string): Promise<ExperimentDetail> {
  const row = await loadExperiment(ctx, id);
  const [assignments, changes, deliveries, events, labels, share] = await Promise.all([
    ctx.supabase
      .from("experiment_assignments")
      .select("*")
      .eq("experiment_id", id)
      .order("stratum"),
    ctx.supabase.from("experiment_changes").select("*").eq("experiment_id", id),
    ctx.supabase
      .from("experiment_deliveries")
      .select("*")
      .eq("experiment_id", id)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("experiment_events")
      .select("id, kind, summary, created_at")
      .eq("experiment_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    groupLabelMap(ctx.workspaceId),
    ctx.supabase
      .from("client_share_items")
      .select("share_id, client_shares!inner(slug, status, workspace_id)")
      .eq("kind", "experiment_report")
      .eq("ref_id", id)
      .limit(1),
  ]);
  for (const r of [assignments, changes, deliveries, events])
    if (r.error) throw new Error(r.error.message);
  const a = (assignments.data ?? []) as AssignmentRow[];
  const status = row.status as ExperimentStatus;
  const summary = summarize(row, labels);
  const result = (row.result ?? {}) as Partial<ResultView> & { prepare?: PrepareState };
  const deliveryRows = ((deliveries.data ?? []) as DeliveryRow[]).filter(
    (d) => d.status !== "discarded",
  );
  const openDelivery = deliveryRows.find((d) =>
    ["draft", "applying", "pr_open", "merged"].includes(d.status),
  );
  const e = ctx.canEdit;
  const shareRow = (share.data ?? [])[0] as
    { share_id: string; client_shares: { slug: string; status: string } } | undefined;
  return {
    ...summary,
    hypothesis: row.hypothesis,
    repository: null,
    secondaryMetrics: (row.secondary_metrics ?? []) as ExperimentMetric[],
    prePeriod: { start: row.pre_period_start, end: row.pre_period_end },
    mdeEstimate: row.mde_estimate === null ? null : Number(row.mde_estimate),
    pairs: pairViews(a, (changes.data ?? []) as ChangeRow[], row.change_type as ChangeType),
    excludedCount: a.filter((x) => x.excluded_at).length,
    deliveries: deliveryRows.map(deliveryView),
    result: typeof result.postDays === "number" ? (result as ResultView) : null,
    prepare: result.prepare
      ? {
          state: result.prepare.state,
          error: result.prepare.state === "failed" ? result.prepare.error : null,
        }
      : null,
    events: (
      (events.data ?? []) as { id: string; kind: string; summary: string; created_at: string }[]
    ).map((ev): EventView => ({
      id: ev.id,
      kind: ev.kind,
      summary: ev.summary,
      createdAt: ev.created_at,
    })),
    canEdit: e,
    actions: {
      approve:
        e &&
        status === "draft" &&
        result.prepare?.state === "ready" &&
        openDelivery?.kind === "ship" &&
        openDelivery.status === "draft",
      discard: e && status === "draft",
      cancel:
        e &&
        ["awaiting_approval", "awaiting_deploy"].includes(status) &&
        !deliveryRows.some((d) => d.kind === "ship" && ["merged", "live"].includes(d.status)),
      rollout: e && status === "concluded" && row.verdict !== "loss",
      rollback: e && (status === "concluded" || status === "invalidated"),
      keep: e && status === "concluded",
      close: e && status === "invalidated",
      share: e && SHAREABLE.includes(status) && !!row.verdict,
    },
    shareSlug: shareRow?.client_shares?.status === "active" ? shareRow.client_shares.slug : null,
  };
}

/* ───────────────────────── suggestions ───────────────────────── */

export async function suggestHypotheses(
  ctx: ExperimentCtx,
  groupId: string,
  metric: ExperimentMetric,
): Promise<HypothesisView[]> {
  requireEditor(ctx);
  const group = await loadGroup(ctx, groupId);
  const sources = await loadSiteSources(ctx.workspaceId);
  const { source, host } = requireWritableSource(sources);
  const gsc = requireGsc(sources, host);
  const target = await dataFileFor(source.id, group.template_file);
  const allowed = target?.fields.length ? target.fields : [...CHANGE_TYPES];
  const sample = [...group.paths].slice(0, 5);
  const [pages, queries, findings, brand] = await Promise.all([
    fetchPages(`https://${host}`, sample),
    queriesByPage(defaultApiFor(gsc), gsc, host, group.pattern, new Set(sample)),
    openFindingTitles(ctx.workspaceId, host, sample),
    brandContext(ctx.workspaceId),
  ]);
  return proposeHypotheses({
    brand,
    group: { label: group.label, pattern: group.pattern },
    metric,
    allowed,
    samples: sample
      .map((p) => ({ page: pages.get(p)!, queries: queries.get(p) ?? [] }))
      .filter((s) => s.page.fields),
    findings,
  });
}

/* ───────────────────────── create ───────────────────────── */

export async function createExperiment(
  ctx: ExperimentCtx,
  input: {
    groupId: string;
    metric: ExperimentMetric;
    changeType: ChangeType;
    name: string;
    hypothesis: string;
  },
): Promise<{ id: string }> {
  requireEditor(ctx);
  if (!METRICS.includes(input.metric) || !CHANGE_TYPES.includes(input.changeType)) {
    throw new ExperimentError("Unknown metric or change type.", 400);
  }
  const group = await loadGroup(ctx, input.groupId);
  const sources = await loadSiteSources(ctx.workspaceId);
  const { source, host } = requireWritableSource(sources);
  const gsc = requireGsc(sources, host);
  if (group.source_id !== source.id) {
    throw new ExperimentError(
      "This group belongs to a different repository. Refresh the groups.",
      409,
    );
  }
  const target = await dataFileFor(source.id, group.template_file);
  if (!target) throw new ExperimentError("Set up these pages for experiments first.", 409);
  if (!target.fields.includes(input.changeType)) {
    throw new ExperimentError(
      `These pages can't change their ${input.changeType.replace("_", " ")} yet. Pick another change or set it up again.`,
      409,
    );
  }
  const limit = await planLimit(ctx.workspaceId);
  if (limit.used >= limit.max) {
    throw new ExperimentError(
      `Your plan allows ${limit.max} experiment${limit.max === 1 ? "" : "s"} at a time. Finish one first.`,
      409,
    );
  }

  // Pages already in another active experiment can't join.
  const { data: busy } = await supabaseAdmin
    .from("experiment_assignments")
    .select("path")
    .eq("workspace_id", ctx.workspaceId)
    .eq("site_host", host)
    .eq("active", true);
  const busySet = new Set((busy ?? []).map((b) => b.path));
  const candidates = group.paths.filter((p) => !busySet.has(p));
  const loaded = await loadSeries({
    sources,
    host,
    pattern: group.pattern,
    paths: candidates,
    metric: input.metric,
  });
  const field = unitField(input.metric);
  const ranked = candidates
    .map((path) => ({ path, value: pageTotal(loaded.series, path, loaded.preDates, field) }))
    .filter((p) => loaded.preDates.some((d) => (loaded.series[p.path]?.[d]?.impressions ?? 0) > 0))
    .sort((a, b) => b.value - a.value || (a.path < b.path ? -1 : 1))
    .slice(0, MAX_EXPERIMENT_PAGES);
  const eligibility = checkEligibility({
    metric: input.metric,
    paths: ranked.map((r) => r.path),
    series: loaded.series,
    dates: loaded.preDates,
  });
  if (!eligibility.eligible) throw new ExperimentError(eligibility.reasons[0].message, 422);

  const { data, error } = await supabaseAdmin
    .from("experiments")
    .insert({
      workspace_id: ctx.workspaceId,
      source_id: source.id,
      site_host: host,
      gsc_source_id: gsc.id,
      ga4_source_id: sources.ga4?.id ?? null,
      page_group_id: group.id,
      name: input.name.trim().slice(0, 160),
      hypothesis: input.hypothesis.trim().slice(0, 2000),
      change_type: input.changeType,
      primary_metric: input.metric,
      secondary_metrics: [],
      status: "draft",
      pre_period_start: loaded.preDates[0],
      pre_period_end: loaded.preDates[loaded.preDates.length - 1],
      planned_min_days: MIN_DURATION_DAYS,
      planned_max_days: MAX_DURATION_DAYS,
      mde_estimate: eligibility.mde[String(MDE_BLOCK_DAYS)],
      created_by: ctx.userId,
      result: { prepare: { state: "running", startedAt: new Date().toISOString() } } as Json,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const experiment = data as ExperimentRow;
  await recordEvent(
    experiment,
    "created",
    `Draft created for ${ranked.length} pages (${group.label}).`,
    {
      pages: ranked.length,
      mde28: eligibility.mde[String(MDE_BLOCK_DAYS)],
    },
    ctx.userId,
  );

  after(() =>
    prepareExperiment(experiment.id, {
      ranked,
      series: loaded.series,
      preDates: loaded.preDates,
      ga4Complete: loaded.ga4.available && !loaded.ga4.deferred,
      userId: ctx.userId,
    }).catch((e) =>
      console.error("[experiments] prepare failed", e instanceof Error ? e.message : e),
    ),
  );
  return { id: experiment.id };
}

/**
 * Fetch the pages, split them, write the copy and draft the ship PR. Safe to
 * re-run on a draft: it replaces its own rows.
 */
export async function prepareExperiment(
  experimentId: string,
  pre?: {
    ranked: { path: string; value: number }[];
    series: Awaited<ReturnType<typeof loadSeries>>["series"];
    preDates: string[];
    ga4Complete: boolean;
    userId: string | null;
  },
) {
  const { data } = await supabaseAdmin
    .from("experiments")
    .select("*")
    .eq("id", experimentId)
    .maybeSingle();
  const experiment = data as ExperimentRow | null;
  if (!experiment || experiment.status !== "draft") return;
  const fail = async (message: string) => {
    await patchExperiment(experiment.id, {
      result: {
        prepare: { state: "failed", at: new Date().toISOString(), error: message.slice(0, 400) },
      } as Json,
    });
    await recordEvent(experiment, "prepare_failed", message);
  };
  try {
    const field = experiment.change_type as ChangeType;
    const metric = experiment.primary_metric as ExperimentMetric;
    const sources = await loadSiteSources(experiment.workspace_id);
    const group = experiment.page_group_id
      ? ((
          await supabaseAdmin
            .from("experiment_page_groups")
            .select("*")
            .eq("id", experiment.page_group_id)
            .maybeSingle()
        ).data as {
          pattern: string;
          paths: string[];
          template_file: string | null;
        } | null)
      : null;
    if (!group) return fail("The page group was removed. Start a new experiment.");

    let ranked = pre?.ranked;
    let series = pre?.series;
    let preDates = pre?.preDates;
    let ga4Complete = pre?.ga4Complete ?? false;
    if (!ranked || !series || !preDates) {
      // A retry: the same pre-period the draft was created with.
      const loaded = await loadSeries({
        sources,
        host: experiment.site_host,
        pattern: group.pattern,
        paths: group.paths,
        metric,
      });
      series = loaded.series;
      preDates = loaded.preDates.filter(
        (d) => d >= (experiment.pre_period_start ?? "") && d <= (experiment.pre_period_end ?? ""),
      );
      ga4Complete = loaded.ga4.available && !loaded.ga4.deferred;
      const f = unitField(metric);
      ranked = group.paths
        .map((path) => ({ path, value: pageTotal(series!, path, preDates!, f) }))
        .filter((p) => preDates!.some((d) => (series![p.path]?.[d]?.impressions ?? 0) > 0))
        .sort((a, b) => b.value - a.value || (a.path < b.path ? -1 : 1))
        .slice(0, MAX_EXPERIMENT_PAGES);
    }

    // Replace anything a previous attempt left.
    await supabaseAdmin.from("experiment_changes").delete().eq("experiment_id", experiment.id);
    await supabaseAdmin.from("experiment_assignments").delete().eq("experiment_id", experiment.id);

    const origin = `https://${experiment.site_host}`;
    const pages = await fetchPages(
      origin,
      ranked.map((r) => r.path),
    );
    const unusable = ranked.filter((r) => {
      const p = pages.get(r.path)!;
      return !p.fields || p.canonicalElsewhere;
    });
    const usable = ranked.filter((r) => !unusable.includes(r));
    const seed = newSeed();
    const split = assignPages(usable, seed);
    if (!split.balanced) {
      return fail(
        "Mellox couldn't split these pages into two halves with similar traffic. Try a larger group.",
      );
    }

    const gsc = requireGsc(sources, experiment.site_host);
    const treatment = split.pairs.map((p) => p.treatment);
    const queries = await queriesByPage(
      defaultApiFor(gsc),
      gsc,
      experiment.site_host,
      group.pattern,
      new Set(treatment),
    );
    const brand = await brandContext(experiment.workspace_id);
    const values = await generateValues({
      field,
      hypothesis: experiment.hypothesis,
      brand,
      inputs: treatment.map((path) => ({
        page: pages.get(path)!,
        queries: queries.get(path) ?? [],
      })),
    });
    const valueByPath = new Map(values.map((v) => [v.path, v]));
    const usablePairs = split.pairs.filter((p) => valueByPath.get(p.treatment)?.ok);
    if (usablePairs.length < MIN_PAIRS) {
      const firstReason = values.find((v) => !v.ok);
      return fail(
        `Only ${usablePairs.length} pages got copy that passed the fact checks (${MIN_PAIRS} needed).${firstReason && !firstReason.ok ? ` Example: ${firstReason.reason}` : ""}`,
      );
    }

    const rows: Record<string, unknown>[] = [];
    const baseline = (path: string) => ({
      pre: ranked!.find((r) => r.path === path)?.value ?? 0,
      fieldValue: beforeValue(pages.get(path)!, field),
    });
    for (const p of split.pairs) {
      const v = valueByPath.get(p.treatment);
      const excluded =
        v && !v.ok ? `No copy passed the fact checks: ${v.reason}`.slice(0, 300) : null;
      for (const [arm, path] of [
        ["treatment", p.treatment],
        ["control", p.control],
      ] as const) {
        rows.push({
          experiment_id: experiment.id,
          workspace_id: experiment.workspace_id,
          site_host: experiment.site_host,
          page_url: new URL(path, origin).toString(),
          path,
          arm,
          stratum: p.stratum,
          baseline: baseline(path),
          excluded_at: excluded ? new Date().toISOString() : null,
          excluded_reason: excluded,
        });
      }
    }
    const { error: aErr } = await supabaseAdmin
      .from("experiment_assignments")
      .insert(rows as never);
    if (aErr) {
      if (aErr.code === "23505")
        return fail("Some of these pages were just added to another experiment. Start again.");
      throw new Error(aErr.message);
    }
    const changes = usablePairs.map((p) => {
      const v = valueByPath.get(p.treatment) as {
        ok: true;
        value: FieldValue;
        grounding: { checked: number };
      };
      return {
        experiment_id: experiment.id,
        workspace_id: experiment.workspace_id,
        path: p.treatment,
        field,
        before: beforeValue(pages.get(p.treatment)!, field),
        after: stringifyFieldValue(v.value),
        grounding: { ok: true, checked: v.grounding.checked } as Json,
      };
    });
    const { error: cErr } = await supabaseAdmin.from("experiment_changes").insert(changes);
    if (cErr) throw new Error(cErr.message);

    await storeSeries({
      experiment,
      assignments: rows as unknown as Pick<AssignmentRow, "path" | "arm">[],
      series,
      dates: preDates,
      ga4Complete,
    });
    await patchExperiment(experiment.id, {
      assignment_seed: split.seed,
      assignment_attempts: split.attempts,
    });
    await buildDataFileDelivery({
      experiment,
      kind: "ship",
      entry: entryFor(
        field,
        changes.map((c) => ({ path: c.path, after: c.after })),
      ),
      templateFile: group.template_file,
      userId: pre?.userId ?? null,
    });
    const excludedCount = split.pairs.length - usablePairs.length;
    await patchExperiment(experiment.id, {
      result: {
        prepare: { state: "ready", at: new Date().toISOString(), excluded: excludedCount },
      } as Json,
    });
    await recordEvent(
      experiment,
      "prepared",
      `Split ${usablePairs.length * 2} pages into ${usablePairs.length} test and ${usablePairs.length} comparison pages${unusable.length ? `; ${unusable.length} pages couldn't be read and were left out` : ""}${excludedCount ? `; ${excludedCount} pairs were left out because no copy passed the fact checks` : ""}.`,
      {
        pairs: usablePairs.length,
        unusable: unusable.map((u) => u.path).slice(0, 20),
        seed: split.seed,
        attempts: split.attempts,
      },
    );
  } catch (error) {
    await fail(error instanceof Error ? error.message : "Preparing the experiment failed.");
  }
}

function entryFor(field: ChangeType, changes: { path: string; after: string }[]): ExperimentEntry {
  const pages: Record<string, FieldValue> = {};
  for (const c of changes) {
    const v = parseFieldValue(field, c.after);
    if (v !== null) pages[c.path] = v;
  }
  return { field, pages };
}

export async function retryPrepare(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  if (row.status !== "draft") throw new ExperimentError("Only a draft can be prepared again.", 409);
  const state = prepareOf(row);
  if (state?.state === "running" && Date.now() - Date.parse(state.startedAt) < 10 * 60_000) {
    throw new ExperimentError("This draft is still being prepared.", 409);
  }
  await patchExperiment(row.id, {
    result: { prepare: { state: "running", startedAt: new Date().toISOString() } } as Json,
  });
  after(() => prepareExperiment(row.id).catch(() => null));
  return { ok: true };
}

/* ───────────────────────── edit a value (draft) ───────────────────────── */

export async function editValue(
  ctx: ExperimentCtx,
  input: { experimentId: string; path: string; value: string },
) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, input.experimentId);
  if (row.status !== "draft")
    throw new ExperimentError("The copy is locked once the experiment is approved.", 409);
  const field = row.change_type as ChangeType;
  const { data: change } = await ctx.supabase
    .from("experiment_changes")
    .select("*")
    .eq("experiment_id", row.id)
    .eq("path", input.path)
    .maybeSingle();
  if (!change) throw new ExperimentError("That page isn't a test page in this experiment.", 404);
  const value = parseFieldValue(field, input.value);
  if (value === null) throw new ExperimentError("That value couldn't be read.", 400);
  const pages = await fetchPages(`https://${row.site_host}`, [input.path]);
  const page = pages.get(input.path)!;
  const brand = await brandContext(row.workspace_id);
  // A person's own wording is allowed; invented facts still aren't.
  const grounded = groundValue(field, value, [
    page.text,
    change.before ?? "",
    ...brand.corpus,
    input.value.replace(/\d[\d,.]*/g, ""),
  ]);
  if (!grounded.ok) throw new ExperimentError(grounded.reason, 422);
  const { error } = await supabaseAdmin
    .from("experiment_changes")
    .update({
      after: stringifyFieldValue(value),
      grounding: { ok: true, edited: true, by: ctx.userId } as Json,
    })
    .eq("id", change.id);
  if (error) throw new Error(error.message);
  await recordEvent(row, "copy_edited", `Copy for ${input.path} was edited.`, {}, ctx.userId);
  return rebuildShip(ctx, row);
}

async function rebuildShip(ctx: ExperimentCtx, row: ExperimentRow) {
  const { data: changes } = await supabaseAdmin
    .from("experiment_changes")
    .select("path, after")
    .eq("experiment_id", row.id);
  const { data: excluded } = await supabaseAdmin
    .from("experiment_assignments")
    .select("path")
    .eq("experiment_id", row.id)
    .not("excluded_at", "is", null);
  const skip = new Set((excluded ?? []).map((e) => e.path));
  const group = row.page_group_id ? await loadGroup(ctx, row.page_group_id) : null;
  const delivery = await buildDataFileDelivery({
    experiment: row,
    kind: "ship",
    entry: entryFor(
      row.change_type as ChangeType,
      (changes ?? []).filter((c) => !skip.has(c.path)),
    ),
    templateFile: group?.template_file ?? null,
    userId: ctx.userId,
  });
  return deliveryView(delivery);
}

/** Re-draft the ship PR against the latest main branch (after "base moved"). */
export async function refreshShip(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  if (row.status === "awaiting_approval") {
    await transition(
      row,
      "awaiting_approval",
      "draft",
      {},
      {
        kind: "reopened",
        summary: "Pull request draft refreshed against the latest code.",
        actorId: ctx.userId,
      },
    );
  } else if (row.status !== "draft") {
    throw new ExperimentError("This experiment is past the draft stage.", 409);
  }
  return rebuildShip(ctx, { ...row, status: "draft" });
}

/* ───────────────────────── approve & ship ───────────────────────── */

export async function approveShip(
  ctx: ExperimentCtx,
  input: { experimentId: string; deliveryId: string; contentHash: string },
) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, input.experimentId);
  if (row.status !== "draft" && row.status !== "awaiting_approval") {
    throw new ExperimentError("This experiment isn't waiting for approval.", 409);
  }
  if (prepareOf(row)?.state !== "ready")
    throw new ExperimentError("This draft isn't ready yet.", 409);
  const limit = await planLimit(ctx.workspaceId);
  if (row.status === "draft" && limit.used >= limit.max) {
    throw new ExperimentError(
      `Your plan allows ${limit.max} experiment${limit.max === 1 ? "" : "s"} at a time.`,
      409,
    );
  }
  let current = row;
  if (row.status === "draft") {
    const locked = await transition(
      row,
      "draft",
      "awaiting_approval",
      {},
      {
        kind: "submitted",
        summary: "Design locked: metric, pages, split and copy can no longer change.",
        actorId: ctx.userId,
      },
    );
    if (!locked) throw new ExperimentError("Someone else changed this experiment. Reload it.", 409);
    current = locked;
  }
  const shipping = await transition(current, "awaiting_approval", "shipping", {
    approved_by: ctx.userId,
    approved_at: new Date().toISOString(),
  });
  if (!shipping) throw new ExperimentError("This experiment is already being shipped.", 409);
  try {
    await approveAndOpen(ctx, input.deliveryId, input.contentHash);
  } catch (error) {
    await transition(
      shipping,
      "shipping",
      "awaiting_approval",
      {},
      {
        kind: "ship_failed",
        summary:
          error instanceof Error ? error.message.slice(0, 400) : "Opening the pull request failed.",
      },
    );
    throw error;
  }
  const moved = await transition(
    shipping,
    "shipping",
    "awaiting_deploy",
    { approved_patch_hash: input.contentHash, shipped_at: new Date().toISOString() },
    {
      kind: "shipped",
      summary: "Approved. Waiting for the pull request to be merged and deployed.",
      actorId: ctx.userId,
    },
  );
  return { ok: !!moved };
}

/* ───────────────────────── cancel / stop / discard ───────────────────────── */

export async function discardDraft(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  if (row.status !== "draft") throw new ExperimentError("Only a draft can be deleted.", 409);
  const { error } = await supabaseAdmin
    .from("experiments")
    .delete()
    .eq("id", row.id)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function cancelExperiment(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  const { data: ships } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("*")
    .eq("experiment_id", row.id)
    .eq("kind", "ship");
  const rows = (ships ?? []) as DeliveryRow[];
  if (rows.some((d) => ["merged", "live"].includes(d.status))) {
    throw new ExperimentError(
      "The change was already merged. Stop the test and roll it back instead.",
      409,
    );
  }
  const moved = await transition(
    row,
    ["awaiting_approval", "awaiting_deploy"],
    "cancelled",
    { cancelled_at: new Date().toISOString() },
    {
      kind: "cancelled",
      summary: "Cancelled before the change went live.",
      actorId: ctx.userId,
    },
  );
  if (!moved) throw new ExperimentError("This experiment can't be cancelled now.", 409);
  for (const d of rows) await closeOpenPr(d, ctx.userId);
  await supabaseAdmin
    .from("experiment_deliveries")
    .update({ status: "discarded" })
    .eq("experiment_id", row.id)
    .eq("status", "draft");
  await cancelJobs(row.id);
  return { ok: true };
}

/** Stop a live test: its numbers won't be used. The change may still be on the site. */
export async function stopExperiment(ctx: ExperimentCtx, id: string, reason: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  const why = `Stopped by a teammate${reason.trim() ? `: ${reason.trim()}` : "."}`.slice(0, 500);
  const moved = await transition(
    row,
    ["awaiting_deploy", "running"],
    "invalidated",
    {
      invalidated_at: new Date().toISOString(),
      invalid_reason: why,
    },
    { kind: "invalidated", summary: why, actorId: ctx.userId },
  );
  if (!moved) throw new ExperimentError("This experiment can't be stopped now.", 409);
  await cancelJobs(row.id, ["pull_metrics", "analyze", "check_contamination", "check_live"]);
  return { ok: true };
}

/* ───────────────────────── after a result ───────────────────────── */

export async function prepareDecision(
  ctx: ExperimentCtx,
  id: string,
  kind: "rollout" | "rollback",
) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  const field = row.change_type as ChangeType;
  if (kind === "rollout") {
    if (row.status !== "concluded")
      throw new ExperimentError("Roll out is available once there is a result.", 409);
    if (row.verdict === "loss")
      throw new ExperimentError("This change made things worse; roll it back instead.", 409);
  } else if (!["concluded", "invalidated"].includes(row.status)) {
    throw new ExperimentError("There's nothing to roll back yet.", 409);
  }
  const group = row.page_group_id ? await loadGroup(ctx, row.page_group_id) : null;
  if (kind === "rollback") {
    const d = await buildDataFileDelivery({
      experiment: row,
      kind,
      entry: null,
      templateFile: group?.template_file ?? null,
      userId: ctx.userId,
    });
    return deliveryView(d);
  }
  // Rollout: every page of the group gets the change, written for that page.
  const { data: assignments } = await supabaseAdmin
    .from("experiment_assignments")
    .select("path, arm, excluded_at")
    .eq("experiment_id", row.id);
  const { data: changes } = await supabaseAdmin
    .from("experiment_changes")
    .select("path, after")
    .eq("experiment_id", row.id);
  const have = new Map((changes ?? []).map((c) => [c.path, c.after]));
  const need = (assignments ?? []).filter((a) => !have.has(a.path)).map((a) => a.path);
  const origin = `https://${row.site_host}`;
  const sources = await loadSiteSources(row.workspace_id);
  const gsc = requireGsc(sources, row.site_host);
  const [pages, queries, brand] = await Promise.all([
    fetchPages(origin, need),
    queriesByPage(defaultApiFor(gsc), gsc, row.site_host, group?.pattern ?? "/", new Set(need)),
    brandContext(row.workspace_id),
  ]);
  const readable = need.filter((p) => pages.get(p)?.fields);
  const values = await generateValues({
    field,
    hypothesis: row.hypothesis,
    brand,
    inputs: readable.map((p) => ({ page: pages.get(p)!, queries: queries.get(p) ?? [] })),
  });
  const all = [...(changes ?? []).map((c) => ({ path: c.path, after: c.after }))];
  for (const v of values) if (v.ok) all.push({ path: v.path, after: stringifyFieldValue(v.value) });
  const skipped = need.length - values.filter((v) => v.ok).length;
  const d = await buildDataFileDelivery({
    experiment: row,
    kind,
    entry: entryFor(field, all),
    templateFile: group?.template_file ?? null,
    userId: ctx.userId,
  });
  if (skipped) {
    await recordEvent(
      row,
      "rollout_prepared",
      `Roll-out drafted for ${all.length} pages; ${skipped} page(s) were skipped because they couldn't be read or no copy passed the fact checks.`,
      {},
      ctx.userId,
    );
  }
  return deliveryView(d);
}

export async function approveDecision(
  ctx: ExperimentCtx,
  input: { experimentId: string; deliveryId: string; contentHash: string },
) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, input.experimentId);
  const { data: d } = await ctx.supabase
    .from("experiment_deliveries")
    .select("kind, experiment_id")
    .eq("id", input.deliveryId)
    .maybeSingle();
  if (!d || d.experiment_id !== row.id || (d.kind !== "rollout" && d.kind !== "rollback")) {
    throw new ExperimentError("Not found", 404);
  }
  const to = d.kind === "rollout" ? "rolling_out" : "rolling_back";
  const from = d.kind === "rollout" ? ["concluded"] : ["concluded", "invalidated"];
  const moved = await transition(
    row,
    from as ExperimentStatus[],
    to,
    {},
    {
      kind: d.kind === "rollout" ? "rollout_approved" : "rollback_approved",
      summary: d.kind === "rollout" ? "Roll-out approved." : "Roll-back approved.",
      actorId: ctx.userId,
    },
  );
  if (!moved) throw new ExperimentError("This experiment moved on. Reload it.", 409);
  try {
    await approveAndOpen(ctx, input.deliveryId, input.contentHash);
  } catch (error) {
    await transition(moved, to, row.status === "invalidated" ? "invalidated" : "concluded").catch(
      () => null,
    );
    throw error;
  }
  return { ok: true };
}

/** Keep the tested change on the test pages only and close. */
export async function keepAsIs(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  const moved = await transition(
    row,
    "concluded",
    "closed",
    { closed_at: new Date().toISOString(), closed_via: "kept" },
    {
      kind: "closed",
      summary:
        "Closed and kept as it is: the test pages keep the new copy, the others stay unchanged.",
      actorId: ctx.userId,
    },
  );
  if (!moved) throw new ExperimentError("This experiment can't be closed now.", 409);
  return { ok: true };
}

/** Close a stopped experiment without rolling back. */
export async function closeStopped(ctx: ExperimentCtx, id: string) {
  requireEditor(ctx);
  const row = await loadExperiment(ctx, id);
  const moved = await transition(
    row,
    "invalidated",
    "closed",
    { closed_at: new Date().toISOString(), closed_via: null },
    {
      kind: "closed",
      summary:
        "Closed without a result. Any copy already on the site stays until it's rolled back.",
      actorId: ctx.userId,
    },
  );
  if (!moved) throw new ExperimentError("This experiment can't be closed now.", 409);
  await cancelJobs(row.id);
  return { ok: true };
}

export { normHost };
