// revenue.ts — the estimated monthly value of a result (ADR-0024 §6).
//
//   extra units / month = extra units per post day × DAYS_PER_MONTH
//   value / unit        = pre-period GA4 revenue ÷ pre-period primary units,
//                         on the treatment pages
// Always labelled "estimated". Without GA4 revenue the gain is shown in the
// metric's own units, with the reason. `basis` keeps every input so outcome
// billing can be computed later without re-deriving anything.
import { DAYS_PER_MONTH, type ExperimentMetric } from "./constants";
import { unitOf } from "./series";

export type RevenueBasis = {
  metric: ExperimentMetric;
  unit: string;
  extraPerDay: number;
  daysPerMonth: number;
  preRevenue: number;
  preUnits: number;
  currency: string | null;
  valuePerUnit: number | null;
};

export type ValueEstimate = {
  monthlyUnits: number;
  unit: string;
  monthlyValue: number | null;
  currency: string | null;
  reason: string | null;
  basis: RevenueBasis;
};

export function estimateMonthlyValue(input: {
  metric: ExperimentMetric;
  extraPerDay: number;
  /** Pre-period GA4 revenue on the treatment pages. */
  preRevenue: number;
  /** Pre-period units of the metric's numerator on the treatment pages. */
  preUnits: number;
  currency: string | null;
}): ValueEstimate {
  const unit = unitOf(input.metric);
  const monthlyUnits = input.extraPerDay * DAYS_PER_MONTH;
  let valuePerUnit: number | null = null;
  let reason: string | null = null;
  if (input.metric === "revenue") {
    valuePerUnit = 1;
  } else if (input.preRevenue > 0 && input.preUnits > 0) {
    valuePerUnit = input.preRevenue / input.preUnits;
  } else {
    reason =
      input.preRevenue > 0
        ? `No ${unit} before the change, so a value per ${unit} can't be worked out.`
        : `No GA4 revenue on these pages, so the gain is shown in ${unit}.`;
  }
  const currency = valuePerUnit !== null ? input.currency : null;
  if (valuePerUnit !== null && !currency) {
    reason = "The GA4 property has no currency set, so the gain is shown in units.";
  }
  const monthlyValue =
    valuePerUnit !== null && currency ? Math.round(monthlyUnits * valuePerUnit * 100) / 100 : null;
  return {
    monthlyUnits,
    unit,
    monthlyValue,
    currency: monthlyValue !== null ? currency : null,
    reason: monthlyValue !== null ? null : reason,
    basis: {
      metric: input.metric,
      unit,
      extraPerDay: input.extraPerDay,
      daysPerMonth: DAYS_PER_MONTH,
      preRevenue: input.preRevenue,
      preUnits: input.preUnits,
      currency: input.currency,
      valuePerUnit,
    },
  };
}
