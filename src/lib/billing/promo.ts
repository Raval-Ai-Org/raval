// Promo trials and the trial tier. Pure and browser-safe.
//
// There is no Free plan (ADR-0050). A code from Mellox opens a short trial
// with a few credits; it still needs a card, and the chosen plan is charged by
// Stripe when the trial ends. While it runs (and while a staff "trial pass"
// runs, the admin console) the account is on the trial tier: the plan's own
// prices, but only the features below, one brand, one seat and no video.
//
// The tier only ever takes away: `applyTrialTier` turns features off and
// lowers limits, never the other way round. Staff overrides are applied after
// it (getEntitlements), so a person given a feature by staff keeps it.

import type { FeatureKey } from "./catalog";

/** Codes are shown and typed in capitals; spaces and case don't matter. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

export const PROMO_LIMITS = {
  days: { min: 1, max: 14 },
  credits: { min: 1, max: 200 },
  uses: { min: 1, max: 100_000 },
} as const;

/** What a trial (or a staff trial pass) may use. Everything else stays locked. */
export const TRIAL_FEATURES: readonly FeatureKey[] = [
  "studio",
  "publishing",
  "pro_chat",
  "analytics_insights",
];

/** Limits on the trial tier; the lower of these and the plan's own wins. */
export const TRIAL_LIMITS = {
  brands: 1,
  seats: 1,
  trackedPrompts: 0,
  scansPerMonth: 1,
  geoMaxPages: 10,
  competitors: 0,
  competitorSweepsPerWeek: 0,
  marketBrainWeeklyBrands: 0,
  coachWeeklyBriefings: 0,
  postsFairUse: 40,
  maxConcurrentExperiments: 0,
  maxConcurrentRenders: 0,
} as const;

/** Chat during a trial, granted next to the code's credits. */
export const TRIAL_MESSAGES = { proMessages: 10, flashMessages: 150 } as const;

type Grant = { allowed: boolean; requiredPlan: string };
type Limits = Record<string, unknown> & { brands: number; seats: number | null };

export function applyTrialTier<F extends Record<string, Grant>, L extends Limits>(
  features: F,
  limits: L,
): { features: F; limits: L } {
  const allowed = new Set<string>(TRIAL_FEATURES);
  const nextFeatures = Object.fromEntries(
    Object.entries(features).map(([key, grant]) => [
      key,
      { ...grant, allowed: grant.allowed && allowed.has(key) },
    ]),
  ) as F;
  const nextLimits = { ...limits } as Record<string, unknown>;
  for (const [key, cap] of Object.entries(TRIAL_LIMITS)) {
    const current = nextLimits[key];
    if (current === null || current === undefined) nextLimits[key] = cap;
    else if (typeof current === "number") nextLimits[key] = Math.min(current, cap);
  }
  if (Array.isArray(nextLimits.engines)) nextLimits.engines = [];
  return { features: nextFeatures, limits: nextLimits as L };
}

export type PromoOffer = { code: string; days: number; credits: number; label: string };

/** "3 days free, 25 credits" — the line shown on the checkout. */
export function promoLine(offer: Pick<PromoOffer, "days" | "credits">): string {
  return `${offer.days} day${offer.days === 1 ? "" : "s"} free, ${offer.credits} credits`;
}

/** When the first charge happens, for "then $49 on 21 Nov". */
export function trialEndDate(days: number, from = new Date()): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
