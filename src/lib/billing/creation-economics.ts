// Reproducible plan design checks, not invoice profit or a promise of margin.
// Baseline non-creation service costs: pricing v2 workbook Plans D:G,
// rows 54 minus 50 (typical) and 55 minus 51 (all allowances used).
import { PLANS, type PaidPlanId, type PlanId } from "./catalog";
import { CREATION_PLANS } from "./creation";

const OTHER_COST: Record<PaidPlanId, { typical: number; full: number }> = {
  starter: { typical: 9.89385223501484, full: 19.88727767407318 },
  growth: { typical: 31.36352323753252, full: 59.954399226645 },
  agency: { typical: 97.6354493199498, full: 178.1380928955325 },
  scale: { typical: 300.693077212825, full: 511.841665881158 },
};
/** Emergency provider ceiling. Annual accounts use monthly-equivalent revenue. */
export function creationProviderLimits(plan: PlanId, interval: "month" | "year" | null) {
  const def = PLANS[plan];
  const revenue = interval === "year" ? def.priceAnnualUsd / 12 : def.priceMonthlyUsd;
  const monthlyUsd = Math.min(def.safety.monthlyUsd, Math.floor(revenue * 0.6 * 100) / 100);
  return { monthlyUsd, dailyUsd: Math.min(def.safety.dailyUsd, monthlyUsd) };
}
export function creationEconomics(
  plan: PaidPlanId,
  interval: "month" | "year",
  scenario: "typical" | "full" | "stress",
) {
  const def = PLANS[plan];
  const allocation = CREATION_PLANS[plan];
  const revenue = interval === "year" ? def.priceAnnualUsd / 12 : def.priceMonthlyUsd;
  const use = scenario === "typical" ? 0.5 : 1;
  // Most costly common point mix including three short caption revisions.
  // Stress covers 35% higher creation cost and every included allowance used.
  const creationCost = allocation.points * use * (scenario === "stress" ? 0.065 : 0.048);
  const flexCost = allocation.flexCredits * use * 0.0021;
  const serviceCost =
    OTHER_COST[plan][scenario === "typical" ? "typical" : "full"] + creationCost + flexCost;
  // Reproduce original processing/FX/tax assumptions; actual contracts and tax
  // treatment must be reconciled separately. Fixed overhead is not included.
  const deductions = revenue * (0.05 + 0.0225) + (interval === "year" ? 0.5 / 12 : 0.5);
  const contribution = revenue - serviceCost - deductions;
  return {
    revenue,
    creationCost,
    flexCost,
    serviceCost,
    contribution,
    margin: contribution / revenue,
  };
}
