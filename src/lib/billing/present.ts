// Browser-safe helpers that turn catalog data and billing errors into the
// words and numbers the billing screens show. Pure; unit-tested.

import {
  ADDONS,
  CREDIT_ACTIONS,
  FEATURES,
  PLAN_ORDER,
  PLANS,
  SIGNUP_GRANT,
  SOFT_LIMIT_RATIO,
  VIDEO_UNITS_PER_VC,
  annualMonthlyUsd,
  planRank,
  type AddonDef,
  type BillingInterval,
  type FeatureKey,
  type Meter,
  type PaidPlanId,
  type PlanId,
} from "./catalog";

/**
 * The plain words the server sends with a 402. The browser shows an Upgrade /
 * Get credits option instead of these as errors, and filters them out of
 * error toasts so people never see a red error for a plan or balance limit.
 */
export const BILLING_MESSAGES = {
  upgrade_required: "This needs a bigger plan.",
  insufficient_balance: "You're out of credits for this.",
  limit_reached: "You've reached your plan limit.",
  spend_not_allowed: "You have view-only access here.",
  brand_frozen: "This brand is paused on your plan.",
} as const;

export function isBillingMessage(message: unknown): boolean {
  return (
    typeof message === "string" &&
    (Object.values(BILLING_MESSAGES) as string[]).some((text) => message.includes(text))
  );
}

export type BillingBlock = {
  code: string;
  feature?: string;
  requiredPlan?: string;
  meter?: string;
  needed?: number;
  available?: number;
  limit?: string;
  used?: number;
  max?: number;
};

const nf = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return nf.format(Math.round(value));
}

export function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${nf.format(value)}` : `$${value.toFixed(2)}`;
}

/** Video meter units (100 = 1 video) as the number people read. */
export function formatVideos(units: number): string {
  const videos = units / VIDEO_UNITS_PER_VC;
  if (Number.isInteger(videos)) return nf.format(videos);
  return videos.toFixed(videos * 4 === Math.round(videos * 4) ? 2 : 1).replace(/0$/, "");
}

export function asPlan(value: unknown): PlanId {
  return typeof value === "string" && value in PLANS ? (value as PlanId) : "free";
}

export function asFeature(value: unknown): FeatureKey | null {
  return typeof value === "string" && value in FEATURES ? (value as FeatureKey) : null;
}

export const METER_LABEL: Record<Meter, string> = {
  credits: "Credits",
  video: "Videos",
  pro_messages: "Pro messages",
  flash_messages: "Chat messages",
};

/** One meter amount in plain words: "1,200 credits", "3.5 videos". */
export function formatMeter(meter: Meter | string, amount: number): string {
  if (meter === "video") {
    const text = formatVideos(amount);
    return `${text} ${text === "1" ? "video" : "videos"}`;
  }
  const n = formatNumber(amount);
  if (meter === "pro_messages") return `${n} Pro ${amount === 1 ? "message" : "messages"}`;
  if (meter === "flash_messages") return `${n} chat ${amount === 1 ? "message" : "messages"}`;
  return `${n} ${amount === 1 ? "credit" : "credits"}`;
}

/** Price shown on a plan card for the chosen billing interval. */
export function planPrice(
  plan: PlanId,
  interval: BillingInterval,
): {
  perMonth: number;
  billed: number;
  savings: number;
} {
  const def = PLANS[plan];
  if (interval === "year") {
    return {
      perMonth: annualMonthlyUsd(plan),
      billed: def.priceAnnualUsd,
      savings: def.priceMonthlyUsd * 12 - def.priceAnnualUsd,
    };
  }
  return { perMonth: def.priceMonthlyUsd, billed: def.priceMonthlyUsd, savings: 0 };
}

/** The next paid plan above the current one (what "Upgrade" suggests by default). */
export function nextPlan(current: PlanId): PaidPlanId | null {
  const next = PLAN_ORDER[planRank(current) + 1];
  return next && next !== "free" ? (next as PaidPlanId) : null;
}

type LimitKey =
  | "brands"
  | "seats"
  | "competitors"
  | "trackedPrompts"
  | "experiments"
  | "renders"
  | "scans"
  | "posts";

function limitValue(plan: PlanId, key: LimitKey): number | null {
  const def = PLANS[plan];
  switch (key) {
    case "brands":
      return def.brands;
    case "seats":
      return def.seats;
    case "competitors":
      return def.limits.competitors;
    case "trackedPrompts":
      return def.limits.trackedPrompts;
    case "experiments":
      return def.limits.maxConcurrentExperiments;
    case "renders":
      return def.limits.maxConcurrentRenders;
    case "scans":
      return def.limits.scansPerMonth;
    case "posts":
      return def.limits.postsFairUse;
  }
}

/** Cheapest plan above `current` whose limit fits `needed`. */
export function planForLimit(current: PlanId, key: string, needed: number): PaidPlanId | null {
  if (!isLimitKey(key)) return nextPlan(current);
  for (const plan of PLAN_ORDER.slice(planRank(current) + 1)) {
    const max = limitValue(plan, key);
    if (max === null || max >= needed) return plan as PaidPlanId;
  }
  return null;
}

/** Cheapest plan above `current` whose monthly allowance covers `needed` of a meter. */
export function planForMeter(current: PlanId, meter: string, needed: number): PaidPlanId | null {
  for (const plan of PLAN_ORDER.slice(planRank(current) + 1)) {
    const a = PLANS[plan].allowances;
    const monthly =
      meter === "video"
        ? a.videoUnits
        : meter === "pro_messages"
          ? a.proMessages
          : meter === "flash_messages"
            ? a.flashMessages
            : a.credits;
    if (monthly >= needed) return plan as PaidPlanId;
  }
  return null;
}

function isLimitKey(key: string): key is LimitKey {
  return [
    "brands",
    "seats",
    "competitors",
    "trackedPrompts",
    "experiments",
    "renders",
    "scans",
    "posts",
  ].includes(key);
}

export const LIMIT_LABEL: Record<string, string> = {
  brands: "brands",
  seats: "team seats",
  competitors: "tracked competitors",
  trackedPrompts: "tracked prompts",
  experiments: "running experiments",
  renders: "videos rendering at once",
  scans: "site scans this month",
  posts: "posts this month",
};

/** The add-on that lifts a limit on this plan, if one is sold. */
export function addonForLimit(plan: PlanId, key: string): AddonDef | null {
  const addon = Object.values(ADDONS).find(
    (item) =>
      item.availability === "launch" &&
      item.plans.includes(plan as PaidPlanId) &&
      ((key === "brands" && item.adds.brands) ||
        (key === "seats" && item.adds.seats) ||
        (key === "trackedPrompts" && item.adds.trackedPrompts && !item.adds.brands)),
  );
  return addon ?? null;
}

/** The plan an upgrade screen should offer for a block, never below the next plan. */
export function suggestedPlan(block: BillingBlock | null, current: PlanId): PaidPlanId | null {
  if (!block) return nextPlan(current);
  if (block.code === "upgrade_required") {
    const required = asPlan(block.requiredPlan);
    return planRank(required) > planRank(current) ? (required as PaidPlanId) : nextPlan(current);
  }
  if (block.code === "limit_reached" && block.limit) {
    return planForLimit(current, block.limit, (block.used ?? 0) + 1);
  }
  if (block.code === "insufficient_balance" && block.meter) {
    return planForMeter(current, block.meter, block.needed ?? 0) ?? nextPlan(current);
  }
  return nextPlan(current);
}

export type FreeNudge = { id: "empty" | "low" | "ending"; title: string; text: string };

/**
 * What to tell someone on Free about their one-time credits, if anything:
 * they're gone, nearly gone, or about to end. Every figure is the real one.
 */
export function freeNudge(args: {
  credits: number;
  /** When the earliest credits end (ISO), if they do. */
  nextExpiry: string | null;
  now?: Date;
}): FreeNudge | null {
  const monthly = formatNumber(PLANS.starter.allowances.credits);
  if (args.credits <= 0) {
    return {
      id: "empty",
      title: "You've used your free credits",
      text: `A plan gives you ${monthly} credits every month.`,
    };
  }
  if (args.credits <= SIGNUP_GRANT.credits * (1 - SOFT_LIMIT_RATIO)) {
    return {
      id: "low",
      title: `${formatNumber(args.credits)} free ${args.credits === 1 ? "credit" : "credits"} left`,
      text: `A plan gives you ${monthly} every month.`,
    };
  }
  const ends = args.nextExpiry ? Date.parse(args.nextExpiry) : NaN;
  const days = Math.ceil((ends - (args.now ?? new Date()).getTime()) / 86_400_000);
  if (Number.isFinite(days) && days >= 0 && days <= 5) {
    return {
      id: "ending",
      title: days <= 1 ? "Your free credits end tomorrow" : `Your free credits end in ${days} days`,
      text: `Use them now, or get ${monthly} every month with a plan.`,
    };
  }
  return null;
}

/** Plain words for a ledger row ("Premium article", "Monthly allowance"). */
export function ledgerLabel(entry: { kind: string; action: string | null; meter: string }): string {
  if (entry.action && entry.action in CREDIT_ACTIONS) {
    return CREDIT_ACTIONS[entry.action as keyof typeof CREDIT_ACTIONS].label;
  }
  if (entry.action?.startsWith("video_")) return "Video";
  if (entry.action === "studio_video") return "Studio video";
  if (entry.action === "backlink_order") return "Backlink order";
  if (entry.action === "chat_flash" || entry.action === "flash_message") return "Chat message";
  if (entry.action === "chat_pro") return "Pro message";
  switch (entry.kind) {
    case "grant":
      return "Added to balance";
    case "expire":
      return "Expired";
    case "refund":
      return "Refund";
    case "release":
      return "Returned (not charged)";
    case "clawback":
      return "Removed (refund)";
    case "adjustment":
      return "Adjustment by Mellox";
    case "rollover":
      return "Rolled over";
    default:
      return entry.action ? entry.action.replace(/[_:.]/g, " ") : "Balance change";
  }
}

/** Short headline for a billing block, for toasts. */
export function blockHeadline(block: BillingBlock): string {
  switch (block.code) {
    case "upgrade_required": {
      const feature = asFeature(block.feature);
      const plan = asPlan(block.requiredPlan);
      return feature
        ? `${FEATURES[feature].label} is on the ${PLANS[plan].label} plan`
        : `This needs the ${PLANS[plan].label} plan`;
    }
    case "insufficient_balance":
      return `Not enough ${block.meter === "video" ? "videos" : block.meter === "pro_messages" ? "Pro messages" : "credits"} left`;
    case "limit_reached":
      return `You've reached your ${LIMIT_LABEL[block.limit ?? ""] ?? "plan"} limit`;
    case "brand_frozen":
      return "This brand is paused on your current plan";
    case "spend_not_allowed":
      return "Viewers can't run paid actions";
    default:
      return "This needs a plan change";
  }
}
