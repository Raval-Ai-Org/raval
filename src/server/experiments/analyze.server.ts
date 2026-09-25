// analyze.server.ts — run the pure evaluation (src/lib/experiments/evaluate.ts)
// on stored data and write the outcome (ADR-0024 §5 step 9, §6).
//
// A daily "early read" is written every time. A verdict is written only when
// a checkpoint (days 21/28/35/42 of complete data after the live date) passes
// the rules; the database then keeps it final.
import "server-only";
import type { Json } from "@/integrations/supabase/types";
import { GSC_METRICS, type ExperimentMetric } from "@/lib/experiments/constants";
import type { ResultView } from "@/lib/experiments/contracts";
import { evaluateExperiment } from "@/lib/experiments/evaluate";
import { estimateMonthlyValue } from "@/lib/experiments/revenue";
import { pageTotal, unitField, unitOf } from "@/lib/experiments/series";
import { nextCheckpoint } from "@/lib/experiments/verdict";
import {
  patchExperiment,
  recordEvent,
  transition,
  type AssignmentRow,
  type ExperimentRow,
} from "./core.server";
import { loadStoredSeries } from "./metrics.server";

export function pairsFrom(assignments: AssignmentRow[]) {
  const byStratum = new Map<number, AssignmentRow[]>();
  for (const a of assignments) byStratum.set(a.stratum, [...(byStratum.get(a.stratum) ?? []), a]);
  const pairs: { stratum: number; treatment: string; control: string }[] = [];
  for (const [stratum, rows] of [...byStratum.entries()].sort((a, b) => a[0] - b[0])) {
    const t = rows.find((r) => r.arm === "treatment");
    const c = rows.find((r) => r.arm === "control");
    if (!t || !c || t.excluded_at || c.excluded_at) continue;
    pairs.push({ stratum, treatment: t.path, control: c.path });
  }
  return pairs;
}

export async function analyzeStored(
  experiment: ExperimentRow,
  assignments: AssignmentRow[],
  opts: { currency: string | null } = { currency: null },
) {
  const metric = experiment.primary_metric as ExperimentMetric;
  const { series, complete } = await loadStoredSeries(experiment.id);
  // A GA4 metric needs GA4's complete days; Search Console metrics need its own.
  const days = GSC_METRICS.includes(metric) ? complete.gsc : complete.ga4;
  const liveDay = experiment.live_confirmed_at?.slice(0, 10) ?? null;
  const preDates = [...days]
    .filter(
      (d) => d >= (experiment.pre_period_start ?? "") && d <= (experiment.pre_period_end ?? ""),
    )
    .sort();
  const postDates = liveDay ? [...days].filter((d) => d > liveDay).sort() : [];
  const pairs = pairsFrom(assignments);
  const evaluation = evaluateExperiment(
    { metric, pairs, series, preDates, postDates },
    experiment.last_checkpoint_day,
    { seed: Number(experiment.assignment_seed ?? 0) },
  );

  const treatmentPaths = pairs.map((p) => p.treatment);
  const field = unitField(metric);
  const preRevenue = treatmentPaths.reduce(
    (s, p) => s + pageTotal(series, p, preDates, "revenue"),
    0,
  );
  const preUnits = treatmentPaths.reduce((s, p) => s + pageTotal(series, p, preDates, field), 0);
  const early = evaluation.early;
  const value =
    early.extraPerDay !== null
      ? estimateMonthlyValue({
          metric,
          extraPerDay: early.extraPerDay,
          preRevenue,
          preUnits,
          currency: opts.currency,
        })
      : null;

  const view: ResultView = {
    asOf: new Date().toISOString(),
    preDays: early.preDays,
    postDays: early.postDays,
    pairs: early.pairs,
    lift: early.lift,
    ci95: early.ci95,
    ciAdjusted: early.ciAdjusted,
    placeboP: early.placeboP,
    daily: early.daily,
    checkpoints: [
      ...(((experiment.result ?? {}) as { checkpoints?: ResultView["checkpoints"] }).checkpoints ??
        []),
      ...evaluation.checkpoints.map((c) => ({ day: c.day, verdict: c.verdict, reason: c.reason })),
    ],
    nextCheckpoint: nextCheckpoint(early.postDays),
    extraPerMonth: value ? value.monthlyUnits : null,
    unit: unitOf(metric),
    monthlyValue: value?.monthlyValue ?? null,
    currency: value?.currency ?? null,
    valueNote: value?.reason ?? null,
    reason: early.reason,
  };
  return { evaluation, view, preRevenue, preUnits };
}

/** One analysis pass for a running experiment. */
export async function runAnalysis(
  experiment: ExperimentRow,
  assignments: AssignmentRow[],
  currency: string | null,
): Promise<"concluded" | "running" | "skipped"> {
  const claimed = await transition(experiment, "running", "analyzing");
  if (!claimed) return "skipped";
  try {
    const { evaluation, view, preRevenue, preUnits } = await analyzeStored(claimed, assignments, {
      currency,
    });
    const previous = (claimed.result ?? {}) as Record<string, unknown>;
    const resultJson = { ...previous, ...view } as unknown as Json;
    const final = evaluation.final;
    if (final && final.verdict) {
      const r = final.result;
      const metric = claimed.primary_metric as ExperimentMetric;
      const value =
        r.extraPerDay !== null
          ? estimateMonthlyValue({
              metric,
              extraPerDay: r.extraPerDay,
              preRevenue,
              preUnits,
              currency,
            })
          : null;
      const concluded = await transition(
        claimed,
        "analyzing",
        "concluded",
        {
          verdict: final.verdict,
          concluded_at: new Date().toISOString(),
          last_checkpoint_day: final.day,
          lift: r.lift,
          lift_low: r.ci95?.[0] ?? null,
          lift_high: r.ci95?.[1] ?? null,
          estimated_monthly_units: value?.monthlyUnits ?? null,
          estimated_monthly_value: value?.monthlyValue ?? null,
          value_currency: value?.currency ?? null,
          revenue_basis: (value?.basis ?? {}) as unknown as Json,
          result: {
            ...(resultJson as object),
            verdictResult: {
              day: final.day,
              lift: r.lift,
              ci95: r.ci95,
              ciAdjusted: r.ciAdjusted,
              placeboP: r.placeboP,
              postDays: r.postDays,
              pairs: r.pairs,
              daily: r.daily,
            },
          } as unknown as Json,
        },
        {
          kind: "verdict",
          summary:
            final.verdict === "win"
              ? `Result at day ${final.day}: the change helped (${fmtPct(r.lift)}).`
              : final.verdict === "loss"
                ? `Result at day ${final.day}: the change hurt (${fmtPct(r.lift)}).`
                : `Result at day ${final.day}: no clear difference.`,
          data: {
            verdict: final.verdict,
            day: final.day,
            lift: r.lift,
            ci95: r.ci95,
            placeboP: r.placeboP,
          },
        },
      );
      if (concluded) return "concluded";
    }
    await transition(claimed, "analyzing", "running", {
      result: resultJson,
      last_checkpoint_day: evaluation.lastCheckpointDay,
    });
    for (const c of evaluation.checkpoints) {
      await recordEvent(claimed, "checkpoint", `Day ${c.day} check: ${c.reason}`, { day: c.day });
    }
    await recordEvent(claimed, "analysis", `Analysis updated with ${view.postDays} days of data.`, {
      postDays: view.postDays,
      lift: view.lift,
    });
    return "running";
  } catch (error) {
    await transition(claimed, "analyzing", "running").catch(() => null);
    throw error;
  }
}

function fmtPct(lift: number | null): string {
  if (lift === null) return "n/a";
  const v = Math.round(lift * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}
