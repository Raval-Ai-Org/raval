// src/lib/billing/catalog.ts
//
// Mellox pricing catalog v4 (ADR-0050). The single source of truth for plans,
// features, credit prices, video prices, packs, add-ons and offers.
//
// One currency: credits. 1 credit = 1 image post. Text work is included.
// There is no Free plan: `free` is only the internal "no active plan" state,
// with nothing granted and nothing paid allowed (the app shows the plan picker).
//
// Ledger units: the `credits` meter keeps its integer units and one credit is
// UNITS_PER_CREDIT units, so balances from before v4 convert at 30 old = 1 new
// (an old image post was 30) without rewriting the append-only ledger. Every
// amount below that is charged or granted is in units; show it with
// `formatCredits` / `creditsOf` (src/lib/billing/present.ts).
//
// Costed in src/lib/billing/plan-economics.ts on pessimistic unit costs
// (video $0.25/s typical, $0.40/s stress). Its test fails if a plan or an
// action falls under the margin rules, so change a number only with it.
//
// Rules for this file:
//   - Browser-safe. Pure data and pure functions only. No "server-only", no env reads,
//     no Supabase. The UI imports it to show prices, locks and upgrade copy; the server
//     imports it to enforce. Server-side env overrides live in src/server/billing/.
//   - Prices are USD. Stripe price ids are NOT here (they live in billing_price_map).

/* ───────────────────────────── plans ───────────────────────────── */

export type PlanId = "free" | "starter" | "growth" | "agency" | "scale";
export type PaidPlanId = Exclude<PlanId, "free">;
export type BillingInterval = "month" | "year";

/** Lowest to highest. Used for "is this an upgrade" and "cheapest plan that unlocks X". */
export const PLAN_ORDER: readonly PlanId[] = ["free", "starter", "growth", "agency", "scale"];

/** The plans sold on the pricing page and the upgrade screen. Scale is "Talk to us". */
export const PUBLIC_PLANS: readonly PaidPlanId[] = ["starter", "growth", "agency"];

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan);
}

/** Ledger units per credit. An old image post was 30 units; it is 1 credit now. */
export const UNITS_PER_CREDIT = 30;

/** Credits as ledger units. */
export function cr(credits: number): number {
  return Math.round(credits * UNITS_PER_CREDIT);
}

/** Ledger units as whole credits a person can still spend (rounded down). */
export function creditsOf(units: number): number {
  return Math.floor(Math.max(0, units) / UNITS_PER_CREDIT);
}

/** A price in ledger units as credits for a label (rounded up, never shows 0 for a charge). */
export function priceCredits(units: number): number {
  return Math.ceil(Math.max(0, units) / UNITS_PER_CREDIT);
}

/** "1 credit", "150 credits": ledger units as whole credits, for every price and balance. */
export function formatCredits(units: number): string {
  const n = creditsOf(units);
  return `${n.toLocaleString("en-US")} ${n === 1 ? "credit" : "credits"}`;
}

/**
 * Meters that hold a balance. Units are integers:
 *   credits         UNITS_PER_CREDIT units = 1 credit
 *   video           legacy: 1 unit = 1/100 of a free video (no new grants in v4)
 *   pro_messages    1 unit = 1 Mellox Pro chat message
 *   flash_messages  1 unit = 1 Mellox Flash chat message (fair-use counter)
 *   creation        legacy creation points (no new grants in v4)
 *   premium_video   legacy premium videos (no new grants in v4)
 */
export type Meter =
  "credits" | "video" | "pro_messages" | "flash_messages" | "creation" | "premium_video";
export const VIDEO_UNITS_PER_VC = 100;

export type ProbeEngine = "perplexity" | "chatgpt" | "gemini" | "google_aio";

export type PlanDef = {
  id: PlanId;
  label: string;
  tagline: string;
  badge?: string;
  /** Monthly billing price. */
  priceMonthlyUsd: number;
  /** Annual billing price for the whole year. */
  priceAnnualUsd: number;
  brands: number;
  /** null = unlimited. Distinct admin and editor members across all of the account's brands, owner included. Viewers are free. */
  seats: number | null;
  /** Granted every month (monthly AND annual plans get monthly grants). Credits are ledger units. */
  allowances: {
    credits: number;
    /** Legacy free videos. 0 from v4: video is priced in credits. */
    videoUnits: number;
    /** Legacy premium videos. 0 from v4. */
    premiumVideos: number;
    proMessages: number;
    /** Fair-use cap on Flash chat, shown as "unlimited". */
    flashMessages: number;
  };
  limits: {
    trackedPrompts: number;
    engines: ProbeEngine[];
    promptCadence: "weekly" | "daily";
    scansPerMonth: number;
    geoMaxPages: number;
    competitors: number;
    competitorSweepsPerWeek: number;
    marketBrainWeeklyBrands: number;
    coachWeeklyBriefings: number;
    /**
     * Social publishing runs on Post for Me. Posts never use credits. This is only
     * a fair-use cap against spam and bots (each network a post goes to counts as
     * one post). At 80% warn; at the cap, new posts wait until the next month or
     * until support lifts it. Never show it as a selling limit.
     */
    postsFairUse: number;
    maxConcurrentExperiments: number;
    maxConcurrentRenders: number;
  };
  /** Unused plan credits roll over this many months (capped at one month of credits). */
  rolloverMonths: number;
  /** Circuit breaker on ALL metered provider spend for the billing account (USD). Not the product allowance. */
  safety: { dailyUsd: number; monthlyUsd: number };
  support: string;
  /** Who the plan is for: one short line on the upgrade screen. */
  fit: string;
  /**
   * What the plan adds, for the plan cards (short and plain). Starter lists the
   * whole product; the plans above list only what they add. Credits, brands and
   * seats are shown from the fields above, so they are not repeated here.
   */
  highlights: string[];
};

const NO_PLAN_LIMITS: PlanDef["limits"] = {
  trackedPrompts: 0,
  engines: [],
  promptCadence: "weekly",
  scansPerMonth: 0,
  geoMaxPages: 0,
  competitors: 0,
  competitorSweepsPerWeek: 0,
  marketBrainWeeklyBrands: 0,
  coachWeeklyBriefings: 0,
  postsFairUse: 0,
  maxConcurrentExperiments: 0,
  maxConcurrentRenders: 0,
};

export const PLANS: Record<PlanId, PlanDef> = {
  // Not a plan anyone buys: an account with no active plan. Data stays readable;
  // nothing that spends runs, and the app shows the plan picker.
  free: {
    id: "free",
    label: "No plan",
    tagline: "Choose a plan to start creating.",
    priceMonthlyUsd: 0,
    priceAnnualUsd: 0,
    brands: 1,
    seats: 1,
    allowances: { credits: 0, videoUnits: 0, premiumVideos: 0, proMessages: 0, flashMessages: 0 },
    limits: NO_PLAN_LIMITS,
    rolloverMonths: 0,
    safety: { dailyUsd: 0.5, monthlyUsd: 1 },
    support: "Email",
    fit: "Choose a plan to start",
    highlights: [],
  },
  starter: {
    id: "starter",
    label: "Starter",
    tagline: "One brand, a month of posts and videos, on autopilot.",
    priceMonthlyUsd: 49,
    priceAnnualUsd: 468,
    brands: 1,
    seats: 2,
    allowances: {
      credits: cr(150),
      videoUnits: 0,
      premiumVideos: 0,
      proMessages: 50,
      flashMessages: 1_000,
    },
    limits: {
      trackedPrompts: 25,
      engines: ["perplexity", "chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 4,
      geoMaxPages: 50,
      competitors: 3,
      competitorSweepsPerWeek: 1,
      marketBrainWeeklyBrands: 1,
      coachWeeklyBriefings: 1,
      postsFairUse: 500,
      maxConcurrentExperiments: 1,
      maxConcurrentRenders: 1,
    },
    rolloverMonths: 1,
    safety: { dailyUsd: 12, monthlyUsd: 29.4 },
    support: "Email",
    fit: "For one brand",
    highlights: [
      "Unlimited text posts, captions and scripts",
      "Image posts, carousels, Stories and ads",
      "Creator and AI videos, up to Premium and Cinematic",
      "Autopilot plans, writes and schedules for you",
      "Campaigns and the content calendar",
      "See what ChatGPT, Gemini and Perplexity say about you",
      "Competitors and your market, checked weekly",
      "Unlimited publishing to every network",
    ],
  },
  growth: {
    id: "growth",
    label: "Growth",
    tagline: "Three brands, a small team and website fixes done for you.",
    badge: "Most popular",
    priceMonthlyUsd: 149,
    priceAnnualUsd: 1_428,
    brands: 3,
    seats: 5,
    allowances: {
      credits: cr(500),
      videoUnits: 0,
      premiumVideos: 0,
      proMessages: 200,
      flashMessages: 2_500,
    },
    limits: {
      trackedPrompts: 100,
      engines: ["perplexity", "chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 10,
      geoMaxPages: 150,
      competitors: 10,
      competitorSweepsPerWeek: 2,
      marketBrainWeeklyBrands: 3,
      coachWeeklyBriefings: 1,
      postsFairUse: 1_500,
      maxConcurrentExperiments: 3,
      maxConcurrentRenders: 2,
    },
    rolloverMonths: 1,
    safety: { dailyUsd: 36, monthlyUsd: 89.4 },
    support: "Priority email",
    fit: "For growing brands and small teams",
    highlights: [
      "Approvals and a client portal",
      "One-click website fixes and Fix all",
      "GEO Engineer for your code",
      "4× the tracked AI questions",
    ],
  },
  agency: {
    id: "agency",
    label: "Agency",
    tagline: "Ten client brands, white-label and one screen for all of them.",
    priceMonthlyUsd: 399,
    priceAnnualUsd: 3_828,
    brands: 10,
    seats: null,
    allowances: {
      credits: cr(1_500),
      videoUnits: 0,
      premiumVideos: 0,
      proMessages: 600,
      flashMessages: 6_000,
    },
    limits: {
      trackedPrompts: 250,
      engines: ["perplexity", "chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 30,
      geoMaxPages: 300,
      competitors: 30,
      competitorSweepsPerWeek: 2,
      marketBrainWeeklyBrands: 10,
      coachWeeklyBriefings: 3,
      postsFairUse: 5_000,
      maxConcurrentExperiments: 15,
      maxConcurrentRenders: 4,
    },
    rolloverMonths: 1,
    safety: { dailyUsd: 96, monthlyUsd: 239.4 },
    support: "Priority + onboarding call",
    fit: "For agencies with client brands",
    highlights: [
      "Every client brand on one screen",
      "Your logo and colours on client reports",
      "Unlimited seats",
      "Priority support and an onboarding call",
    ],
  },
  // Enterprise, sold by talking to us; not on the pricing cards. Existing
  // Scale accounts keep these terms.
  scale: {
    id: "scale",
    label: "Enterprise",
    tagline: "30+ brands with SSO, API access and an SLA.",
    priceMonthlyUsd: 1_199,
    priceAnnualUsd: 11_508,
    brands: 30,
    seats: null,
    allowances: {
      credits: cr(4_500),
      videoUnits: 0,
      premiumVideos: 0,
      proMessages: 1_800,
      flashMessages: 15_000,
    },
    limits: {
      trackedPrompts: 1_000,
      engines: ["perplexity", "chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 90,
      geoMaxPages: 500,
      competitors: 90,
      competitorSweepsPerWeek: 2,
      marketBrainWeeklyBrands: 30,
      coachWeeklyBriefings: 10,
      postsFairUse: 15_000,
      maxConcurrentExperiments: 50,
      maxConcurrentRenders: 8,
    },
    rolloverMonths: 1,
    safety: { dailyUsd: 288, monthlyUsd: 719 },
    support: "Dedicated manager",
    fit: "For large teams",
    highlights: [
      "A dedicated account manager",
      "Support with a guaranteed response time",
      "The highest limits on everything",
      "SSO and API access (coming soon)",
    ],
  },
};

/** Annual price shown per month (Starter: 39). */
export function annualMonthlyUsd(plan: PlanId): number {
  return Math.round((PLANS[plan].priceAnnualUsd / 12) * 100) / 100;
}

/** True when the account can use Mellox at all (any plan but the no-plan state). */
export function hasActivePlan(plan: PlanId): boolean {
  return plan !== "free";
}

/* ──────────────────────────── features ──────────────────────────── */

export type FeatureModule = "Create" | "Autopilot" | "Brain" | "Grow" | "Team";

/** The five groups every plan card, the pricing table and the upgrade screen use. */
export const FEATURE_GROUPS: ReadonlyArray<{ module: FeatureModule; line: string }> = [
  { module: "Create", line: "Posts, carousels, Stories, ads, articles and videos" },
  { module: "Autopilot", line: "Plans, writes, schedules and publishes for you" },
  { module: "Brain", line: "Brand DNA, audience, competitors, market and strategy" },
  { module: "Grow", line: "AI visibility, analytics and experiments" },
  { module: "Team", line: "Seats, approvals, client portal and white-label" },
];

export type FeatureKey =
  | "studio"
  | "premium_articles"
  | "pro_chat"
  | "ugc"
  | "video_1080p"
  | "video_premium"
  | "video_cinematic"
  | "campaigns"
  | "approvals"
  | "geo_fix_proposals"
  | "geo_apply_fixes"
  | "geo_agent"
  | "experiments"
  | "competitors"
  | "market_brain"
  | "analytics_insights"
  | "publishing"
  | "backlinks"
  | "client_portal"
  | "command_center"
  | "autopilot"
  | "audience"
  | "white_label"
  | "sso_api";

export type FeatureDef = {
  key: FeatureKey;
  module: FeatureModule;
  label: string;
  /** One line for the upgrade modal: what the user gets, in plain words. */
  pitch: string;
  minPlan: PlanId;
  /**
   * "launch": built and sold now. "later": shown as "Coming soon" on its plan,
   * never sold as available, never gated as if it worked. Flip to "launch" only
   * when the feature really ships.
   */
  availability?: "launch" | "later";
};

// Every plan makes everything (credits price the expensive parts). Bigger plans
// add brands, team features and done-for-you fixes.
export const FEATURES: Record<FeatureKey, FeatureDef> = {
  studio: {
    key: "studio",
    module: "Create",
    label: "Studio",
    pitch: "Posts, Stories, image posts, carousels, ads and scripts in your brand voice.",
    minPlan: "starter",
  },
  premium_articles: {
    key: "premium_articles",
    module: "Create",
    label: "Premium articles",
    pitch: "Long, well-researched articles that AI search can quote, ready to publish.",
    minPlan: "starter",
  },
  pro_chat: {
    key: "pro_chat",
    module: "Brain",
    label: "Mellox Pro chat",
    pitch: "Our smartest chat for strategy and deep analysis, using your brand and data.",
    minPlan: "starter",
  },
  ugc: {
    key: "ugc",
    module: "Create",
    label: "Creator video ads",
    pitch: "Scroll-stopping creator (UGC) video ads for your products.",
    minPlan: "starter",
  },
  video_1080p: {
    key: "video_1080p",
    module: "Create",
    label: "1080p video",
    pitch: "Full-HD renders for paid social and landing pages.",
    minPlan: "starter",
  },
  video_premium: {
    key: "video_premium",
    module: "Create",
    label: "Premium and Long-take video",
    pitch: "Photoreal hero ads from your product photos, and takes up to 15 seconds.",
    minPlan: "starter",
  },
  video_cinematic: {
    key: "video_cinematic",
    module: "Create",
    label: "Cinematic video",
    pitch: "Multi-shot, camera-directed video for brand storytelling.",
    minPlan: "starter",
  },
  campaigns: {
    key: "campaigns",
    module: "Autopilot",
    label: "Campaign plans",
    pitch: "Turn one goal into a multi-channel campaign with briefs, posts and a calendar.",
    minPlan: "starter",
  },
  approvals: {
    key: "approvals",
    module: "Team",
    label: "Approval workflows",
    pitch: "Route drafts to teammates or clients for sign-off before they go live.",
    minPlan: "growth",
  },
  geo_fix_proposals: {
    key: "geo_fix_proposals",
    module: "Grow",
    label: "GEO fix proposals",
    pitch: "Exact, grounded fixes for every finding, written for your pages.",
    minPlan: "starter",
  },
  geo_apply_fixes: {
    key: "geo_apply_fixes",
    module: "Grow",
    label: "One-click fixes",
    pitch:
      "Apply fixes to WordPress or Webflow, or open a pull request on GitHub, with undo and verification.",
    minPlan: "growth",
  },
  geo_agent: {
    key: "geo_agent",
    module: "Grow",
    label: "GEO Engineer and Fix all",
    pitch:
      "An agent that reads your repo and ships multi-file fixes, plus one pull request for every finding.",
    minPlan: "growth",
  },
  experiments: {
    key: "experiments",
    module: "Grow",
    label: "Proof Engine experiments",
    pitch: "Test one change on half your pages and prove what moves rankings and citations.",
    minPlan: "starter",
  },
  competitors: {
    key: "competitors",
    module: "Brain",
    label: "Competitor tracking",
    pitch: "Watch competitors' launches, pricing and content, with intelligence reports.",
    minPlan: "starter",
  },
  market_brain: {
    key: "market_brain",
    module: "Brain",
    label: "Market Brain",
    pitch: "A weekly read of your market from real, dated sources, turned into what to do next.",
    minPlan: "starter",
  },
  audience: {
    key: "audience",
    module: "Brain",
    label: "Audience",
    pitch:
      "See how your audience is likely to react before you post, and learn from what really happened.",
    minPlan: "starter",
  },
  analytics_insights: {
    key: "analytics_insights",
    module: "Grow",
    label: "GA4 and Search Console insights",
    pitch: "Plain-language insights from your analytics, tied back to your content.",
    minPlan: "starter",
  },
  publishing: {
    key: "publishing",
    module: "Autopilot",
    label: "Publishing",
    pitch:
      "Publish and schedule to every social network with unlimited posts, plus WordPress and Webflow. Publishing never uses credits.",
    minPlan: "starter",
  },
  backlinks: {
    key: "backlinks",
    module: "Grow",
    label: "Backlink marketplace",
    pitch: "Buy real placements on relevant sites, verified live on the page.",
    minPlan: "growth",
    // Paused while it is reworked ("coming soon" in the app).
    availability: "later",
  },
  client_portal: {
    key: "client_portal",
    module: "Team",
    label: "Client portal",
    pitch: "Share work with clients and collect feedback without giving them a seat.",
    minPlan: "growth",
  },
  command_center: {
    key: "command_center",
    module: "Team",
    label: "Agency command center",
    pitch: "Every client brand's health, tasks and results on one screen.",
    minPlan: "agency",
  },
  autopilot: {
    key: "autopilot",
    module: "Autopilot",
    label: "Autopilot",
    pitch:
      "Mellox plans, writes and schedules your marketing. You approve before anything goes out.",
    minPlan: "starter",
  },
  white_label: {
    key: "white_label",
    module: "Team",
    label: "White-label",
    pitch: "Your agency's name, logo and colours on the client portal and shared reports.",
    minPlan: "agency",
  },
  sso_api: {
    key: "sso_api",
    module: "Team",
    label: "SSO and API access",
    pitch: "Single sign-on and API access for larger teams.",
    minPlan: "scale",
    availability: "later",
  },
};

/** Features that are sold today (drop "later" ones from gates and checkout copy). */
export function isFeatureAvailable(feature: FeatureKey): boolean {
  return (FEATURES[feature].availability ?? "launch") === "launch";
}

export function planAllows(plan: PlanId, feature: FeatureKey): boolean {
  return planRank(plan) >= planRank(FEATURES[feature].minPlan);
}

/** Cheapest plan that unlocks a feature (what the upgrade modal offers). */
export function requiredPlanFor(feature: FeatureKey): PlanId {
  return FEATURES[feature].minPlan;
}

/** Features a plan adds over another (for "what else you get" in the upgrade modal). */
export function featuresGained(from: PlanId, to: PlanId): FeatureDef[] {
  return Object.values(FEATURES).filter((f) => !planAllows(from, f.key) && planAllows(to, f.key));
}

/* ─────────────────────────── credit prices ─────────────────────────── */

/**
 * Legacy: ledger units per USD for purchased value (backlinks, paused). A pack's
 * units are set per pack below, not from this number.
 */
export const CREDITS_PER_USD = 100;

export type CreditActionDef = {
  /** Price in ledger units (`cr(n)` for n credits). 0 = included in every plan. */
  credits: number;
  label: string;
  unit: string;
  /** Feature that must be unlocked to run it (checked before any hold). */
  feature: FeatureKey | null;
  /** Planned (pessimistic) provider cost in USD of one action, for the margin test. */
  expectedCostUsd: number;
  /** task-models.ts route labels this action covers (for the coverage test). */
  routes: string[];
};

export const CREDIT_ACTIONS = {
  // ── Create: included text work ──
  post_set: {
    credits: 0,
    label: "Text post set",
    unit: "up to 3 platforms",
    feature: "studio",
    expectedCostUsd: 0.02,
    routes: [
      "studio.social",
      "content.generateBatch",
      "content.generateNextPost",
      "content.planCalendar",
      "schedule.*",
    ],
  },
  post_regenerate: {
    credits: 0,
    label: "Rewrite a post",
    unit: "per post",
    feature: "studio",
    expectedCostUsd: 0.01,
    routes: ["content.regenerate"],
  },
  script: {
    credits: 0,
    label: "Video script",
    unit: "per script",
    feature: "studio",
    expectedCostUsd: 0.02,
    routes: ["studio.script"],
  },
  ideas: {
    credits: 0,
    label: "Content ideas",
    unit: "per batch",
    feature: "studio",
    expectedCostUsd: 0.01,
    routes: ["studio.prompt", "studio.upload-captions", "campaign.write"],
  },
  social_multi: {
    credits: 0,
    label: "Multi-platform variants",
    unit: "5 platforms",
    feature: "studio",
    expectedCostUsd: 0.02,
    routes: ["social.multi", "ai-generate", "ai-generate.*"],
  },
  article_standard: {
    credits: 0,
    label: "Standard article",
    unit: "~1,200 words",
    feature: "studio",
    expectedCostUsd: 0.03,
    routes: ["studio.article.standard"],
  },
  ugc_concepts: {
    credits: 0,
    label: "Creator video script",
    unit: "per script",
    feature: "ugc",
    expectedCostUsd: 0.05,
    routes: ["ugc.product.extract", "ugc.concepts", "ugc.notes"],
  },
  file_extract: {
    credits: 0,
    label: "File or image reading",
    unit: "per file",
    feature: null,
    expectedCostUsd: 0.01,
    routes: ["file-extract"],
  },
  // ── Create: 1 credit ──
  image_post: {
    credits: cr(1),
    label: "Image post",
    unit: "copy + picture",
    feature: "studio",
    expectedCostUsd: 0.08,
    routes: ["studio.captions", "studio.image.brief", "studio.meme.concept"],
  },
  ad_set: {
    credits: cr(1),
    label: "Ad",
    unit: "copy variants + picture",
    feature: "studio",
    expectedCostUsd: 0.08,
    routes: ["studio.ad"],
  },
  carousel: {
    credits: cr(1),
    label: "Carousel",
    unit: "drawn slides + cover picture",
    feature: "studio",
    expectedCostUsd: 0.08,
    routes: ["studio.carousel"],
  },
  photo_design: {
    credits: cr(1),
    label: "Design with your photos",
    unit: "copy + designed picture",
    feature: "studio",
    expectedCostUsd: 0.08,
    routes: ["studio.photo-read"],
  },
  image_standard: {
    credits: cr(1),
    label: "Picture",
    unit: "per picture or version",
    feature: "studio",
    expectedCostUsd: 0.06,
    routes: [],
  },
  image_edit: {
    credits: cr(1),
    label: "Picture edit",
    unit: "up to 2 references",
    feature: "studio",
    expectedCostUsd: 0.07,
    routes: [],
  },
  // ── Create: 2+ credits ──
  story: {
    credits: cr(2),
    label: "Story",
    unit: "picture frames",
    feature: "studio",
    expectedCostUsd: 0.15,
    routes: ["studio.story"],
  },
  product_hero: {
    credits: cr(2),
    label: "Product poster",
    unit: "copy + product poster",
    feature: "studio",
    expectedCostUsd: 0.15,
    routes: ["studio.hero.concept"],
  },
  image_premium: {
    credits: cr(2),
    label: "Premium picture",
    unit: "per picture",
    feature: "studio",
    expectedCostUsd: 0.15,
    routes: [],
  },
  clip_brand: {
    credits: cr(2),
    label: "Brand your clips",
    unit: "branded video",
    feature: "studio",
    expectedCostUsd: 0.15,
    routes: ["studio.photo-read", "studio.transcribe"],
  },
  photo_recap: {
    credits: cr(2),
    label: "Recap from your photos",
    unit: "recap video",
    feature: "studio",
    expectedCostUsd: 0.15,
    routes: ["studio.photo-read"],
  },
  video_storyboard: {
    credits: cr(2),
    label: "Video storyboard",
    unit: "plan + frames",
    feature: "studio",
    expectedCostUsd: 0.17,
    routes: [],
  },
  article_premium: {
    credits: cr(2),
    label: "Premium article",
    unit: "~1,200 words",
    feature: "premium_articles",
    expectedCostUsd: 0.15,
    routes: ["studio.article"],
  },
  article_long: {
    credits: cr(3),
    label: "Long-form article",
    unit: "~2,500 words",
    feature: "premium_articles",
    expectedCostUsd: 0.22,
    routes: ["studio.article"],
  },
  motion_graphics: {
    credits: cr(3),
    label: "Motion graphic",
    unit: "per video",
    feature: "studio",
    expectedCostUsd: 0.25,
    routes: ["studio.motion.compose"],
  },
  // ── Autopilot ──
  campaign: {
    credits: cr(1),
    label: "Campaign plan",
    unit: "per plan",
    feature: "campaigns",
    expectedCostUsd: 0.08,
    routes: ["campaign-generation", "campaign.plan"],
  },
  // ── Brain ──
  brand_dna_rescan: {
    credits: cr(3),
    label: "Brand DNA re-scan",
    unit: "first scan per brand is included",
    feature: null,
    expectedCostUsd: 0.25,
    routes: ["brand-extract", "brand-extract.search", "brand-visuals.analyze"],
  },
  coach_briefing: {
    credits: cr(2),
    label: "Coach briefing on demand",
    unit: "per briefing",
    feature: "market_brain",
    expectedCostUsd: 0.15,
    routes: ["coach", "coach.briefing", "coach.research", "coach.trends"],
  },
  coach_deep: {
    credits: cr(3),
    label: "Deep strategy",
    unit: "per run",
    feature: "pro_chat",
    expectedCostUsd: 0.25,
    routes: [],
  },
  strategy_rebuild: {
    credits: cr(2),
    label: "Strategy rebuild",
    unit: "first strategy per brand is included",
    feature: null,
    expectedCostUsd: 0.15,
    routes: ["strategy.generate"],
  },
  market_brain_manual: {
    credits: cr(3),
    label: "Market Brain refresh",
    unit: "outside the weekly schedule",
    feature: "market_brain",
    expectedCostUsd: 0.25,
    routes: ["market-intelligence"],
  },
  competitor_discovery: {
    credits: cr(1),
    label: "Competitor discovery",
    unit: "per run",
    feature: "competitors",
    expectedCostUsd: 0.08,
    routes: ["competitors.discovery"],
  },
  // Bounded by the plan's competitor limit, so included.
  competitor_profile: {
    credits: 0,
    label: "Competitor profile",
    unit: "per competitor",
    feature: "competitors",
    expectedCostUsd: 0.05,
    routes: ["competitors.profile"],
  },
  competitor_intel: {
    credits: cr(1),
    label: "Competitor report",
    unit: "per report",
    feature: "competitors",
    expectedCostUsd: 0.08,
    routes: ["competitor-intel"],
  },
  community_reply: {
    credits: 0,
    label: "Community reply draft",
    unit: "per draft",
    feature: "market_brain",
    expectedCostUsd: 0.015,
    routes: ["community.reply"],
  },
  insights_refresh: {
    credits: 0,
    label: "Analytics insights",
    unit: "per refresh",
    feature: "analytics_insights",
    expectedCostUsd: 0.02,
    routes: ["analytics/insights"],
  },
  audience_pulse: {
    credits: cr(1),
    label: "Audience check",
    unit: "per post",
    feature: "audience",
    expectedCostUsd: 0.03,
    routes: ["audience.react", "audience.synthesize"],
  },
  audience_tournament: {
    credits: cr(1),
    label: "Compare versions",
    unit: "per comparison",
    feature: "audience",
    expectedCostUsd: 0.05,
    routes: ["audience.variants"],
  },
  // ── Grow: AI visibility beyond the plan's included scans and prompts ──
  site_scan_per_100_pages: {
    credits: cr(1),
    label: "Extra site scan",
    unit: "per 100 pages",
    feature: null,
    expectedCostUsd: 0.08,
    routes: [],
  },
  prompt_check_3_engines: {
    credits: cr(1),
    label: "Check a question now",
    unit: "3 engines",
    feature: null,
    expectedCostUsd: 0.03,
    routes: ["geo.probe"],
  },
  // "Fix all" = geo_fix x the findings it proposes for (gated by geo_agent for the batch PR).
  geo_fix: {
    credits: cr(3),
    label: "GEO fix",
    unit: "per finding",
    feature: "geo_fix_proposals",
    expectedCostUsd: 0.25,
    routes: ["geo.fix.propose", "geo.fix.batch"],
  },
  geo_cms_fix: {
    credits: cr(1),
    label: "One-click fix",
    unit: "per fix",
    feature: "geo_apply_fixes",
    expectedCostUsd: 0.08,
    routes: ["geo.cms.fix"],
  },
  geo_agent_run: {
    credits: cr(10),
    label: "GEO Engineer run",
    unit: "per run",
    feature: "geo_agent",
    expectedCostUsd: 0.8,
    routes: ["geo.agent.investigate", "geo.agent.implement", "geo.agent.review"],
  },
  experiment: {
    credits: cr(3),
    label: "Proof Engine experiment",
    unit: "per experiment",
    feature: "experiments",
    expectedCostUsd: 0.2,
    routes: ["experiments.hypotheses", "experiments.values", "experiments.integration"],
  },
  // ── Chat beyond the plan allowance ──
  pro_message: {
    credits: cr(1),
    label: "Mellox Pro message",
    unit: "after the monthly allowance",
    feature: "pro_chat",
    expectedCostUsd: 0.06,
    routes: ["chat.pro"],
  },
  flash_message_over_cap: {
    credits: cr(1),
    label: "Mellox Flash message",
    unit: "after the fair-use cap",
    feature: null,
    expectedCostUsd: 0.01,
    routes: ["chat"],
  },
} satisfies Record<string, CreditActionDef>;

export type CreditAction = keyof typeof CREDIT_ACTIONS;

/**
 * Paid routes that are deliberately never debited: they are part of a charged
 * action above, bounded by plan limits (background work), or free by design.
 * The coverage test fails when a task-models.ts route is in neither list.
 */
export const INCLUDED_ROUTES: readonly string[] = [
  "chat.research",
  "chat.history-summary",
  "clarify",
  "memory-extract",
  "studio.naturalize",
  "studio.caption.edit",
  // Suggestions are loaded automatically while browsing and saving; included in Studio.
  "studio.ideas",
  "studio.research",
  // Shared social trends snapshot: collected for everyone, charged to no one.
  "studio.trends",
  "studio.image.review",
  // A video's brief is part of the video, charged with it.
  "studio.video.brief",
  "studio.video.storyboard",
  // Checking a video before anyone sees it (and one redo) is Mellox's cost.
  "studio.video.qa",
  // Visual identity review is part of the already charged Studio image action.
  "brand-visuals.review",
  "analytics/insights-auto",
  "agent.content-fit",
  "agent.distribution-reliability",
  "competitors.updates",
  // Reading community threads found by the daily refresh (economy, bounded).
  "community.classify",
  // Autopilot plans and reads signals for free; each piece it makes is
  // charged at the normal Studio price.
  "autopilot.plan",
  "autopilot.strategy",
  "autopilot.opportunities",
  // Audience groups and the quick score are part of the plan (rate-limited);
  // only the deeper check and the comparison are charged.
  "audience.twins",
  "audience.score",
  "links-topical-fit",
  "links-relevance-pick",
  "links-profile",
  "links-article-brief",
  "guardrails.image-moderation",
  "guardrails.media-safety",
  // Adding a blog to a site: once per site, part of publishing articles.
  "articles.blog-design",
];

/** Ledger units for an action (0 = included). */
export function creditsFor(action: CreditAction, quantity = 1): number {
  return Math.ceil(CREDIT_ACTIONS[action].credits * Math.max(0, quantity));
}

/** True when an action is included in every plan (no credits). */
export function isIncludedAction(action: CreditAction): boolean {
  return CREDIT_ACTIONS[action].credits === 0;
}

/**
 * Chat is priced per message, but a message's cost grows with its context. One
 * message uses one unit per started band of input tokens (after the gateway trims
 * history), so a 50k-token Pro message uses 3 Pro messages.
 */
export const CHAT_INPUT_TOKEN_BANDS = { pro: 20_000, flash: 16_000 } as const;

export function chatUnitsFor(
  kind: keyof typeof CHAT_INPUT_TOKEN_BANDS,
  inputTokens: number,
): number {
  return Math.max(1, Math.ceil(Math.max(0, inputTokens) / CHAT_INPUT_TOKEN_BANDS[kind]));
}

/* ─────────────────────────────── video ─────────────────────────────── */

export type UgcModelKey =
  "standard" | "draft" | "premium" | "long" | "cinematic" | "variation" | "animation";
/** Provider resolutions. 768p (KIE MiniMax H3) is priced and gated like 720p. */
export type VideoResolution = "480p" | "720p" | "768p" | "1080p" | "2k";

function priceBand(resolution: VideoResolution): VideoResolution {
  return resolution === "768p" ? "720p" : resolution;
}

/**
 * An AI video's price in credits per second of output, by option. Priced for the
 * costly case of each option (storyboard frames, music, QA and its one redo, a
 * provider fallback), at most $0.085 of planned cost per credit:
 *   Draft $0.12/s · Standard $0.25/s · Long $0.33/s · Premium $0.40/s ·
 *   Cinematic $0.50/s (2K $1.00/s) · Variation $0.15/s · Animation $0.25/s.
 */
export const VIDEO_CREDITS_PER_SECOND: Record<UgcModelKey, number> = {
  draft: 1.5,
  standard: 3,
  long: 4,
  premium: 5,
  cinematic: 6,
  variation: 2,
  animation: 3,
};

/** Planned provider cost per second, the same table the margin test reads. */
export const VIDEO_PLANNED_USD_PER_SECOND: Record<UgcModelKey, number> = {
  draft: 0.12,
  standard: 0.25,
  long: 0.33,
  premium: 0.4,
  cinematic: 0.5,
  variation: 0.15,
  animation: 0.25,
};

/** 2K costs about twice as much per second. */
const RESOLUTION_MULTIPLIER: Partial<Record<VideoResolution, number>> = { "2k": 2 };

/**
 * Guard: a render may never cost Mellox more than this per credit charged. Above
 * it (a new model, a pricier provider), the render is charged more credits.
 */
export const MAX_USD_PER_CREDIT = 0.085;

/** A video's price in ledger units: the per-second table, with the routed provider's cost as a floor. */
export function videoCreditsFor(
  option: UgcModelKey,
  seconds: number,
  resolution: VideoResolution,
  providerCostUsd?: number,
): number {
  const rate = VIDEO_CREDITS_PER_SECOND[option] * (RESOLUTION_MULTIPLIER[resolution] ?? 1);
  const listed = Math.ceil(Math.max(1, seconds) * rate);
  const floor = Math.ceil(Math.max(0, providerCostUsd ?? 0) / MAX_USD_PER_CREDIT);
  return cr(Math.max(listed, floor));
}

/** "Standard: 3 credits a second" for the pricing page and quotes. */
export function videoRateLabel(option: UgcModelKey): string {
  const rate = VIDEO_CREDITS_PER_SECOND[option];
  return `${rate} ${rate === 1 ? "credit" : "credits"} a second`;
}

/** The feature a render needs. The video router must receive the plan and never pick a locked option. */
export function videoFeatureFor(ugcKey: UgcModelKey, resolution: VideoResolution): FeatureKey {
  if (ugcKey === "cinematic") return "video_cinematic";
  if (ugcKey === "premium" || ugcKey === "long") return "video_premium";
  const band = priceBand(resolution);
  if (band === "1080p" || band === "2k") return "video_1080p";
  return "ugc";
}

/* ───────────────────────── legacy video credits ───────────────────────── */
// Balances on the `video` and `premium_video` meters from before v4 still pay
// for a video until they are used (src/lib/billing/video-charge.ts). Nothing
// new is granted on them.

export type VideoProviderId = "kie" | "openrouter";

export type VideoOptionDef = {
  ugcKey: UgcModelKey;
  provider: VideoProviderId;
  fallback: string;
  seconds: number;
  resolution: VideoResolution;
  /** Legacy: 100 = 1 Video Credit. */
  videoUnits: number;
  feature: FeatureKey;
  label: string;
};

/** Legacy Video Credit table, used only to spend balances held before v4. */
export const VIDEO_OPTIONS: VideoOptionDef[] = [
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite",
    ugcKey: "draft",
    seconds: 8,
    resolution: "720p",
    videoUnits: 50,
    feature: "ugc",
    label: "Draft 8s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite",
    ugcKey: "draft",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 75,
    feature: "video_1080p",
    label: "Draft 8s 1080p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite",
    ugcKey: "standard",
    seconds: 8,
    resolution: "720p",
    videoUnits: 100,
    feature: "ugc",
    label: "Standard 8s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite",
    ugcKey: "standard",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 125,
    feature: "video_1080p",
    label: "Standard 8s 1080p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-fast",
    ugcKey: "premium",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 150,
    feature: "video_premium",
    label: "Premium 8s",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-fast",
    ugcKey: "premium",
    seconds: 10,
    resolution: "1080p",
    videoUnits: 200,
    feature: "video_premium",
    label: "Premium 10s",
  },
  {
    provider: "kie",
    fallback: "openrouter minimax/hailuo-3",
    ugcKey: "cinematic",
    seconds: 10,
    resolution: "2k",
    videoUnits: 200,
    feature: "video_cinematic",
    label: "Cinematic 10s",
  },
  {
    provider: "kie",
    fallback: "openrouter bytedance/seedance-2.0-fast",
    ugcKey: "long",
    seconds: 12,
    resolution: "720p",
    videoUnits: 150,
    feature: "video_premium",
    label: "Long take 12s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter bytedance/seedance-2.0-fast",
    ugcKey: "long",
    seconds: 15,
    resolution: "720p",
    videoUnits: 200,
    feature: "video_premium",
    label: "Long take 15s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter bytedance/seedance-2.0-fast",
    ugcKey: "long",
    seconds: 15,
    resolution: "480p",
    videoUnits: 100,
    feature: "video_premium",
    label: "Long take 15s 480p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite 6s",
    ugcKey: "variation",
    seconds: 6,
    resolution: "720p",
    videoUnits: 50,
    feature: "ugc",
    label: "Quick variation 6s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-lite 6s",
    ugcKey: "variation",
    seconds: 6,
    resolution: "480p",
    videoUnits: 50,
    feature: "ugc",
    label: "Quick variation 6s 480p",
  },
  {
    provider: "kie",
    fallback: "openrouter bytedance/seedance-2.0-fast",
    ugcKey: "animation",
    seconds: 8,
    resolution: "720p",
    videoUnits: 100,
    feature: "ugc",
    label: "Animation 8s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter bytedance/seedance-2.0-fast",
    ugcKey: "animation",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 125,
    feature: "video_1080p",
    label: "Animation 8s 1080p",
  },
];

/** Studio clip provider. */
export const STUDIO_VIDEO_PROVIDER: VideoProviderId = "openrouter";

/** Legacy: cost of 1 VC on OpenRouter at the Standard option, incl. the 5.5% fee. */
export const USD_PER_VC_REFERENCE = 0.844;

/** Legacy guard for spending old Video Credit balances. */
export const MAX_USD_PER_VC = 1.01;

/** Legacy Video Credit units for a render (only for old `video` meter balances). */
export function videoUnitsFor(args: {
  ugcKey: UgcModelKey;
  seconds: number;
  resolution: VideoResolution;
  providerCostUsd?: number;
}): number {
  const band = priceBand(args.resolution);
  const exact = VIDEO_OPTIONS.find(
    (o) => o.ugcKey === args.ugcKey && o.seconds === args.seconds && o.resolution === band,
  );
  const cost = Math.max(0, args.providerCostUsd ?? USD_PER_VC_REFERENCE * (args.seconds / 8));
  const floorUnits = Math.max(1, Math.ceil((cost / MAX_USD_PER_VC) * 4)) * 25;
  if (exact) return Math.max(exact.videoUnits, floorUnits);
  const proportional = Math.max(1, Math.ceil((cost / USD_PER_VC_REFERENCE) * 4)) * 25;
  const base = VIDEO_OPTIONS.filter((o) => o.ugcKey === args.ugcKey && o.resolution === band).sort(
    (a, b) => a.seconds - b.seconds,
  )[0];
  const durationFloor = base
    ? Math.ceil(((args.seconds / base.seconds) * base.videoUnits) / 25) * 25
    : 0;
  return Math.max(proportional, floorUnits, durationFloor);
}

/** One legacy free video (a whole Draft or Standard video). */
export const FREE_VIDEO_UNITS = 100;

export function formatVc(videoUnits: number): string {
  const vc = videoUnits / VIDEO_UNITS_PER_VC;
  return Number.isInteger(vc) ? String(vc) : vc.toFixed(2).replace(/0$/, "");
}

/* ─────────────────────────── short clips ─────────────────────────── */

/**
 * A short clip is one AI clip of 8 seconds or less on Draft (Veo 3.1 Lite) or
 * Standard (Grok Imagine): a picture brought to life, one animated photo in a
 * recap, a short video or video Story. It has no storyboard, script or music,
 * so it is a flat price per clip (credits), covering even the OpenRouter
 * fallback ($0.40–0.84 a clip).
 */
export const SHORT_CLIP_MAX_SECONDS = 8;
export const SHORT_CLIP_CREDITS = {
  draft: { "720p": cr(4), "1080p": cr(5) },
  standard: { "720p": cr(8), "1080p": cr(10) },
} as const;
export type ShortClipKey = keyof typeof SHORT_CLIP_CREDITS;

export function isShortClipKey(key: string | undefined): key is ShortClipKey {
  return !!key && key in SHORT_CLIP_CREDITS;
}

/** Ledger units for `clips` short clips, with the routed provider's cost as a floor. */
export function shortClipCredits(args: {
  ugcKey: ShortClipKey;
  resolution: VideoResolution;
  clips?: number;
  providerCostUsd?: number;
}): number {
  const band = priceBand(args.resolution) === "1080p" ? "1080p" : "720p";
  const each = Math.max(
    SHORT_CLIP_CREDITS[args.ugcKey][band],
    cr(Math.ceil(Math.max(0, args.providerCostUsd ?? 0) / MAX_USD_PER_CREDIT)),
  );
  return each * Math.max(1, args.clips ?? 1);
}

/** Legacy: the same clips in creation points (only for balances from before v4). */
export function shortClipPoints(units: number): number {
  return Math.ceil(units / 12);
}

/* ───────────────────────── packs and add-ons ───────────────────────── */

/**
 * Where a grant may be spent:
 *   any      AI actions AND backlink purchases (money the customer paid for)
 *   ai_only  AI actions only: plan allowances, bonus, trial, referral, promo
 */
export type GrantRestriction = "any" | "ai_only";

/** `credits` and `bonusCredits` are ledger units. */
export type CreditPackDef = { key: string; usd: number; credits: number; bonusCredits: number };

/** Top-ups. Paid credits are "any"; bonus credits are "ai_only". Valid for PACK_VALID_DAYS. */
export const CREDIT_PACKS: CreditPackDef[] = [
  { key: "credits_50", usd: 15, credits: cr(50), bonusCredits: 0 },
  { key: "credits_200", usd: 49, credits: cr(200), bonusCredits: 0 },
  { key: "credits_600", usd: 129, credits: cr(600), bonusCredits: 0 },
];

/**
 * Packs sold before pricing v4, off sale. Kept only so a payment or request
 * made for one is still fulfilled exactly as it was bought (ledger units).
 */
export const LEGACY_CREDIT_PACKS: CreditPackDef[] = [
  { key: "credits_25", usd: 25, credits: 2_500, bonusCredits: 0 },
  { key: "credits_100", usd: 100, credits: 10_000, bonusCredits: 500 },
  { key: "credits_250", usd: 250, credits: 25_000, bonusCredits: 2_500 },
  { key: "credits_500", usd: 500, credits: 50_000, bonusCredits: 7_500 },
];

/** A pack on sale, or one bought before v4, for fulfilment and records only. */
export function creditPackFor(key: string): CreditPackDef | undefined {
  return (
    CREDIT_PACKS.find((pack) => pack.key === key) ??
    LEGACY_CREDIT_PACKS.find((pack) => pack.key === key)
  );
}

/** Top-up credits stay valid this long. */
export const PACK_VALID_DAYS = 365;

export type VideoPackDef = {
  key: string;
  usd: number;
  videoUnits: number;
  /** "later" = off sale. */
  availability: "launch" | "later";
};

/** Off sale since v4 (video is priced in credits). Balances already held still pay. */
export const VIDEO_PACKS: VideoPackDef[] = [
  { key: "video_10", usd: 29, videoUnits: 1_000, availability: "later" },
  { key: "video_30", usd: 79, videoUnits: 3_000, availability: "later" },
  { key: "video_100", usd: 249, videoUnits: 10_000, availability: "later" },
];

export type AddonKey =
  | "extra_brand"
  | "prompts_100"
  | "daily_tracking_100"
  | "daily_market_brain"
  | "pro_200"
  | "extra_seat"
  | "ai_overviews_100"
  | "white_label_domain";

export type AddonDef = {
  key: AddonKey;
  label: string;
  usdPerMonth: number;
  /** Plans that may buy it. */
  plans: PaidPlanId[];
  /** What one unit adds (credits in ledger units). */
  adds: Partial<{
    brands: number;
    seats: number;
    trackedPrompts: number;
    dailyTrackedPrompts: number;
    credits: number;
    videoUnits: number;
    proMessages: number;
    marketBrainDailyBrands: number;
    marketBrainWeeklyBrands: number;
    aiOverviewPrompts: number;
  }>;
  /** "later" = not sold: hide from checkout, never promise it. */
  availability: "launch" | "later";
};

export const ADDONS: Record<AddonKey, AddonDef> = {
  extra_brand: {
    key: "extra_brand",
    label: "Extra brand",
    usdPerMonth: 39,
    plans: ["growth", "agency", "scale"],
    adds: {
      brands: 1,
      trackedPrompts: 25,
      credits: cr(75),
      marketBrainWeeklyBrands: 1,
    },
    availability: "launch",
  },
  prompts_100: {
    key: "prompts_100",
    label: "+100 tracked AI questions",
    usdPerMonth: 29,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { trackedPrompts: 100 },
    availability: "launch",
  },
  daily_tracking_100: {
    key: "daily_tracking_100",
    label: "Daily tracking, per 100 prompts",
    usdPerMonth: 149,
    plans: ["growth", "agency", "scale"],
    adds: { dailyTrackedPrompts: 100 },
    availability: "later",
  },
  daily_market_brain: {
    key: "daily_market_brain",
    label: "Daily Market Brain, per brand",
    usdPerMonth: 29,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { marketBrainDailyBrands: 1 },
    availability: "later",
  },
  // Off sale since v4: Pro messages past the allowance are 1 credit each.
  pro_200: {
    key: "pro_200",
    label: "+200 Mellox Pro messages",
    usdPerMonth: 29,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { proMessages: 200 },
    availability: "later",
  },
  extra_seat: {
    key: "extra_seat",
    label: "Extra seat",
    usdPerMonth: 12,
    plans: ["starter", "growth"],
    adds: { seats: 1 },
    availability: "launch",
  },
  ai_overviews_100: {
    key: "ai_overviews_100",
    label: "Google AI Overviews, per 100 prompts",
    usdPerMonth: 15,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { aiOverviewPrompts: 100 },
    availability: "later",
  },
  white_label_domain: {
    key: "white_label_domain",
    label: "White-label domain",
    usdPerMonth: 49,
    plans: ["agency", "scale"],
    adds: {},
    availability: "later",
  },
};

/* ─────────────────────────────── offers ─────────────────────────────── */

/** No sign-up credits: there is no Free plan (v4). Kept at 0 so old grants replay. */
export const SIGNUP_GRANT = {
  credits: 0,
  restriction: "ai_only" as GrantRestriction,
  expiresInDays: 30,
};

/** Card-required trial that turns into the paid plan by itself. */
export const TRIAL = {
  plan: "growth" as PaidPlanId,
  days: 7,
  credits: cr(30),
  videoUnits: 0,
  proMessages: 20,
  flashMessages: 300,
  oncePerOwner: true,
};

/**
 * Pause instead of cancel. Keeps data and brands, read-only, 10 weekly prompts on
 * 2 engines. Monthly plans pause at once; annual plans can schedule the pause for
 * the end of their paid year (no mid-year refund or credit).
 */
export const PAUSE = {
  usdPerMonth: 9,
  trackedPrompts: 10,
  engines: ["chatgpt", "gemini"] as ProbeEngine[],
  maxMonths: 6,
  annualPausesAtTermEnd: true,
};

/**
 * First 50 paying customers on annual billing: 30% off the first annual payment
 * (= 12 months). A non-recurring discount restricted to the annual plan prices.
 */
export const FOUNDING_OFFER = {
  code: "FOUNDING30",
  percentOff: 30,
  appliesTo: "first_annual_payment" as const,
  maxRedemptions: 50,
  intervals: ["year"] as BillingInterval[],
};

/**
 * Both sides get the reward once the referred account's first payment is older than
 * the refund window (so a refunded purchase never mints rewards).
 */
export const REFERRAL = {
  credits: cr(30),
  videoUnits: 0,
  restriction: "ai_only" as GrantRestriction,
  expiresInDays: 90,
  maxRewardsPerYear: 20,
  rewardAfterDays: 14,
};

/** Share of any allowance at which the user is nudged (in-app + email). */
export const SOFT_LIMIT_RATIO = 0.8;

/** Payment failed: full access for this long, then the account is locked until paid. */
export const PAST_DUE_GRACE_DAYS = 7;
