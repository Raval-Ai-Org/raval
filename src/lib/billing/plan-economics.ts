// Pricing v4 economics as code (ADR-0050). A reproducible design check on
// pessimistic unit costs, not invoice profit or a promise of margin. The test
// (plan-economics.test.ts) fails when a plan or a price breaks the margin
// rules, so change a number in catalog.ts only with this check passing.
//
// Pure and browser-safe: the plan cards read `planOutcomes` from here too.
import {
  CREDIT_ACTIONS,
  MAX_USD_PER_CREDIT,
  PLANS,
  UNITS_PER_CREDIT,
  VIDEO_CREDITS_PER_SECOND,
  VIDEO_PLANNED_USD_PER_SECOND,
  creditsOf,
  type PaidPlanId,
  type PlanId,
  type UgcModelKey,
} from "./catalog";

export type Scenario = "typical" | "heavy" | "stress";

/**
 * Planned unit costs in USD. "typical" is about 1.5x what was measured after
 * the 2026-11-12 model swap; "stress" is the worst case seen or quoted (video
 * at $0.40 a second, every image redone, research at its p90 and more).
 */
export const UNIT_COSTS = {
  typical: {
    /** Per credit spent: image posts ($0.08 each) and video ($0.25/s at 3 credits/s). */
    perCredit: 0.085,
    proMessage: 0.05,
    flashMessage: 0.002,
    /** One tracked AI question, checked weekly on three engines, per month. */
    trackedPrompt: 0.08,
    /** Background research per brand per month (Market Brain, competitors, trends). */
    researchPerBrand: 1.5,
    /** Hosting, storage and email per account, plus per extra brand. */
    hostingBase: 3,
    hostingPerExtraBrand: 1,
  },
  stress: {
    perCredit: 0.13,
    proMessage: 0.06,
    flashMessage: 0.003,
    trackedPrompt: 0.1,
    researchPerBrand: 3,
    hostingBase: 5,
    hostingPerExtraBrand: 1.5,
  },
} as const;

/** Card, FX and tax buffer on revenue. */
export const PAYMENT_RATE = 0.0725;
export const PAYMENT_FIXED_USD = 0.5;

/** The margin rules the test enforces. */
export const MARGIN_RULES = { typicalYearly: 0.45, heavyMonthly: 0.3 } as const;

/** Share of the allowance a scenario uses. */
const USE: Record<Scenario, number> = { typical: 0.6, heavy: 1, stress: 1 };

/** Credits for a 10-second Standard video, the unit the plan cards count. */
export const CREDITS_PER_CARD_VIDEO = VIDEO_CREDITS_PER_SECOND.standard * 10;

/** What a plan's monthly credits make, for the plan cards ("≈ 150 image posts or 5 videos"). */
export function planOutcomes(plan: PlanId): {
  credits: number;
  imagePosts: number;
  videos: number;
} {
  const credits = creditsOf(PLANS[plan].allowances.credits);
  const imagePost = CREDIT_ACTIONS.image_post.credits / UNITS_PER_CREDIT;
  return {
    credits,
    imagePosts: Math.floor(credits / imagePost),
    videos: Math.floor(credits / CREDITS_PER_CARD_VIDEO),
  };
}

export type PlanEconomics = {
  revenue: number;
  /** Provider spend (credits, chat, tracking, research), capped by the circuit breaker. */
  providerCost: number;
  hosting: number;
  payment: number;
  cost: number;
  contribution: number;
  margin: number;
};

/** One month of a plan under a scenario. Yearly plans use the monthly-equivalent price. */
export function planEconomics(
  plan: PaidPlanId,
  interval: "month" | "year",
  scenario: Scenario,
): PlanEconomics {
  const def = PLANS[plan];
  const unit = scenario === "stress" ? UNIT_COSTS.stress : UNIT_COSTS.typical;
  const use = USE[scenario];
  const revenue = interval === "year" ? def.priceAnnualUsd / 12 : def.priceMonthlyUsd;
  const raw =
    creditsOf(def.allowances.credits) * use * unit.perCredit +
    def.allowances.proMessages * use * unit.proMessage +
    def.allowances.flashMessages * use * unit.flashMessage +
    def.limits.trackedPrompts * unit.trackedPrompt +
    def.brands * unit.researchPerBrand;
  // The circuit breaker stops provider spend at its monthly limit.
  const providerCost = Math.min(raw, creationProviderLimits(plan, interval).monthlyUsd);
  const hosting = unit.hostingBase + Math.max(0, def.brands - 1) * unit.hostingPerExtraBrand;
  const payment = revenue * PAYMENT_RATE + PAYMENT_FIXED_USD;
  const cost = providerCost + hosting + payment;
  const contribution = revenue - cost;
  return {
    revenue,
    providerCost,
    hosting,
    payment,
    cost,
    contribution,
    margin: contribution / revenue,
  };
}

/**
 * Emergency provider ceiling for an account (USD), the same for monthly and
 * yearly billing: 60% of the monthly price, so a yearly customer is never
 * stopped before their credits are used.
 */
export function creationProviderLimits(plan: PlanId, _interval: "month" | "year" | null) {
  const def = PLANS[plan];
  const monthlyUsd = Math.min(
    def.safety.monthlyUsd,
    Math.floor(def.priceMonthlyUsd * 0.6 * 100) / 100,
  );
  return { monthlyUsd, dailyUsd: Math.min(def.safety.dailyUsd, monthlyUsd) };
}

/** Credit prices whose planned cost is above the per-credit guard (should be none). */
export function underpricedActions(): string[] {
  const out: string[] = [];
  for (const [key, action] of Object.entries(CREDIT_ACTIONS)) {
    if (action.credits === 0) continue;
    const credits = action.credits / UNITS_PER_CREDIT;
    if (action.expectedCostUsd > credits * MAX_USD_PER_CREDIT + 1e-9) out.push(key);
  }
  for (const key of Object.keys(VIDEO_CREDITS_PER_SECOND) as UgcModelKey[]) {
    if (
      VIDEO_PLANNED_USD_PER_SECOND[key] >
      VIDEO_CREDITS_PER_SECOND[key] * MAX_USD_PER_CREDIT + 1e-9
    )
      out.push(`video:${key}`);
  }
  return out;
}
