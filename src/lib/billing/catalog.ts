// src/lib/billing/catalog.ts
//
// Mellox pricing catalog v2. The single source of truth for plans, features,
// credit prices, video credits, packs, add-ons and offers.
//
// Source: CFO pricing review 2026-09-25 (docs/pricing/v2/Mellox_AI_Pricing_Model_v2.xlsx),
// on the OpenRouter model stack in src/server/ai/task-models.ts.
//
// Rules for this file:
//   - Browser-safe. Pure data and pure functions only. No "server-only", no env reads,
//     no Supabase. The UI imports it to show prices, locks and upgrade copy; the server
//     imports it to enforce. Server-side env overrides live in src/server/billing/.
//   - Every number here was costed. Change a number only together with the workbook.
//   - Prices are USD. Paddle price ids are NOT here (they live in billing_price_map).

/* ───────────────────────────── plans ───────────────────────────── */

export type PlanId = "free" | "starter" | "growth" | "agency" | "scale";
export type PaidPlanId = Exclude<PlanId, "free">;
export type BillingInterval = "month" | "year";

/** Lowest to highest. Used for "is this an upgrade" and "cheapest plan that unlocks X". */
export const PLAN_ORDER: readonly PlanId[] = ["free", "starter", "growth", "agency", "scale"];

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan);
}

/**
 * Meters that hold a balance. Units are integers:
 *   credits         1 unit = 1 Mellox credit ($0.01 face value)
 *   video           1 unit = 1/100 Video Credit (so 0.5 / 0.75 / 1.25 VC stay integers)
 *   pro_messages    1 unit = 1 Mellox Pro (Claude Opus 5.5) chat message
 *   flash_messages  1 unit = 1 Mellox Flash chat message (fair-use counter)
 */
export type Meter = "credits" | "video" | "pro_messages" | "flash_messages";
export const VIDEO_UNITS_PER_VC = 100;

export type ProbeEngine = "perplexity" | "chatgpt" | "gemini" | "google_aio";

export type PlanDef = {
  id: PlanId;
  label: string;
  tagline: string;
  badge?: string;
  /** Monthly billing price. */
  priceMonthlyUsd: number;
  /** Annual billing price for the whole year (2 months free = 10 x monthly). */
  priceAnnualUsd: number;
  brands: number;
  /** null = unlimited. Distinct admin and editor members across all of the account's brands, owner included. Viewers are free. */
  seats: number | null;
  /** Granted every month (monthly AND annual plans get monthly grants). */
  allowances: {
    credits: number;
    videoUnits: number;
    proMessages: number;
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
     * Social profiles the account may connect for publishing. SocialAPI.ai bills per
     * connected profile per month (1 profile = 1 brand with any number of its networks),
     * not per post, so this is the limit. Posts are unlimited under a fair-use rate limit.
     */
    socialProfiles: number;
    /** Networks one profile may link (fair use; SocialAPI does not bill per network). */
    networksPerProfile: number;
    maxConcurrentExperiments: number;
    maxConcurrentRenders: number;
  };
  /** Annual plans roll unused plan credits and VC over for this many months (capped at one month of allowance). */
  rolloverMonthsAnnual: number;
  /** Circuit breaker on ALL metered provider spend for the billing account (USD). Not the product allowance. */
  safety: { dailyUsd: number; monthlyUsd: number };
  support: string;
  /** Marketing bullets for the plan cards (keep short). */
  highlights: string[];
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    label: "Free",
    tagline: "See how AI answer engines see your brand.",
    priceMonthlyUsd: 0,
    priceAnnualUsd: 0,
    brands: 1,
    seats: 1,
    allowances: { credits: 0, videoUnits: 0, proMessages: 0, flashMessages: 30 },
    limits: {
      trackedPrompts: 5,
      engines: ["chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 1,
      geoMaxPages: 25,
      competitors: 0,
      competitorSweepsPerWeek: 0,
      marketBrainWeeklyBrands: 0,
      coachWeeklyBriefings: 0,
      socialProfiles: 0,
      networksPerProfile: 13,
      maxConcurrentExperiments: 0,
      maxConcurrentRenders: 0,
    },
    rolloverMonthsAnnual: 0,
    safety: { dailyUsd: 1, monthlyUsd: 2 },
    support: "Community",
    highlights: [
      "1 brand, Brand DNA scan",
      "5 prompts tracked weekly on ChatGPT and Gemini",
      "1 site scan a month",
      "100 credits to try Studio",
    ],
  },
  starter: {
    id: "starter",
    label: "Starter",
    tagline: "One brand, a month of content and weekly AI visibility.",
    priceMonthlyUsd: 49,
    priceAnnualUsd: 490,
    brands: 1,
    seats: 2,
    allowances: { credits: 2_000, videoUnits: 400, proMessages: 30, flashMessages: 800 },
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
      socialProfiles: 1,
      networksPerProfile: 13,
      maxConcurrentExperiments: 1,
      maxConcurrentRenders: 1,
    },
    rolloverMonthsAnnual: 1,
    safety: { dailyUsd: 4, monthlyUsd: 27 },
    support: "Email",
    highlights: [
      "2,000 credits a month",
      "4 UGC videos a month",
      "30 Mellox Pro messages",
      "25 prompts on 3 answer engines",
      "Publish to 1 social profile (all 13 networks)",
      "Weekly Market Brain and Monday Coach briefing",
    ],
  },
  growth: {
    id: "growth",
    label: "Growth",
    tagline: "Up to 3 brands, premium video and one-click fixes.",
    badge: "Most popular",
    priceMonthlyUsd: 149,
    priceAnnualUsd: 1_490,
    brands: 3,
    seats: 5,
    allowances: { credits: 6_000, videoUnits: 1_200, proMessages: 150, flashMessages: 2_000 },
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
      socialProfiles: 3,
      networksPerProfile: 13,
      maxConcurrentExperiments: 3,
      maxConcurrentRenders: 2,
    },
    rolloverMonthsAnnual: 1,
    safety: { dailyUsd: 10, monthlyUsd: 80 },
    support: "Email, 24 h",
    highlights: [
      "3 brands, 5 seats, 3 social profiles",
      "6,000 credits and 12 videos a month",
      "1080p, Premium and Long-take video",
      "One-click fixes on WordPress, Webflow and GitHub",
      "Campaigns, approvals, client portal, backlinks",
    ],
  },
  agency: {
    id: "agency",
    label: "Agency",
    tagline: "10 client brands, white-label and the GEO Engineer.",
    priceMonthlyUsd: 449,
    priceAnnualUsd: 4_490,
    brands: 10,
    seats: null,
    allowances: { credits: 18_000, videoUnits: 4_000, proMessages: 400, flashMessages: 5_000 },
    limits: {
      trackedPrompts: 300,
      engines: ["perplexity", "chatgpt", "gemini"],
      promptCadence: "weekly",
      scansPerMonth: 30,
      geoMaxPages: 300,
      competitors: 30,
      competitorSweepsPerWeek: 2,
      marketBrainWeeklyBrands: 10,
      coachWeeklyBriefings: 3,
      socialProfiles: 10,
      networksPerProfile: 13,
      maxConcurrentExperiments: 15,
      maxConcurrentRenders: 4,
    },
    rolloverMonthsAnnual: 1,
    safety: { dailyUsd: 30, monthlyUsd: 234 },
    support: "Priority + onboarding call",
    highlights: [
      "10 brands and 10 social profiles, unlimited seats",
      "18,000 credits and 40 videos, pooled",
      "GEO Engineer agent and Fix-all pull requests",
      "Agency command center and white-label portal",
      "Cinematic video",
    ],
  },
  scale: {
    id: "scale",
    label: "Scale",
    tagline: "30 brands with SSO, API access and an SLA.",
    priceMonthlyUsd: 1_199,
    priceAnnualUsd: 11_990,
    brands: 30,
    seats: null,
    allowances: { credits: 50_000, videoUnits: 10_000, proMessages: 1_200, flashMessages: 12_000 },
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
      socialProfiles: 30,
      networksPerProfile: 13,
      maxConcurrentExperiments: 50,
      maxConcurrentRenders: 8,
    },
    rolloverMonthsAnnual: 1,
    safety: { dailyUsd: 83, monthlyUsd: 662 },
    support: "Dedicated manager",
    highlights: [
      "30 brands and 30 social profiles, unlimited seats",
      "50,000 credits and 100 videos, pooled",
      "Dedicated manager and support SLA",
      "Everything in Agency",
      "SSO and API access (coming soon)",
    ],
  },
};

/** Annual price shown per month (Starter: 40.83). */
export function annualMonthlyUsd(plan: PlanId): number {
  return Math.round((PLANS[plan].priceAnnualUsd / 12) * 100) / 100;
}

/* ──────────────────────────── features ──────────────────────────── */

export type FeatureModule =
  | "Brand"
  | "Assistant"
  | "Studio"
  | "UGC video"
  | "AI visibility"
  | "Intelligence"
  | "Distribution"
  | "Team";

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

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  studio: {
    key: "studio",
    module: "Studio",
    label: "Studio",
    pitch: "Posts, image posts, carousels, ads and scripts in your brand voice.",
    minPlan: "free",
  },
  premium_articles: {
    key: "premium_articles",
    module: "Studio",
    label: "Premium articles",
    pitch: "Long-form, GEO-grounded articles written by Claude Opus 5.5, ready to publish.",
    minPlan: "starter",
  },
  pro_chat: {
    key: "pro_chat",
    module: "Assistant",
    label: "Mellox Pro chat",
    pitch: "Strategy and analysis from Claude Opus 5.5, with your brand and data in context.",
    minPlan: "starter",
  },
  ugc: {
    key: "ugc",
    module: "UGC video",
    label: "UGC video ads",
    pitch: "Turn a product page into scroll-stopping UGC video ads.",
    minPlan: "starter",
  },
  video_1080p: {
    key: "video_1080p",
    module: "UGC video",
    label: "1080p video",
    pitch: "Full-HD renders for paid social and landing pages.",
    minPlan: "growth",
  },
  video_premium: {
    key: "video_premium",
    module: "UGC video",
    label: "Premium and Long-take video",
    pitch: "Photoreal hero ads from your product photos, and takes up to 15 seconds.",
    minPlan: "growth",
  },
  video_cinematic: {
    key: "video_cinematic",
    module: "UGC video",
    label: "Cinematic video",
    pitch: "Multi-shot, camera-directed video for brand storytelling.",
    minPlan: "agency",
  },
  campaigns: {
    key: "campaigns",
    module: "Studio",
    label: "Campaign plans",
    pitch: "Turn one goal into a multi-channel campaign with briefs, posts and a calendar.",
    minPlan: "growth",
  },
  approvals: {
    key: "approvals",
    module: "Studio",
    label: "Approval workflows",
    pitch: "Route drafts to teammates or clients for sign-off before they go live.",
    minPlan: "growth",
  },
  geo_fix_proposals: {
    key: "geo_fix_proposals",
    module: "AI visibility",
    label: "GEO fix proposals",
    pitch: "Exact, grounded fixes for every finding, written for your pages.",
    minPlan: "starter",
  },
  geo_apply_fixes: {
    key: "geo_apply_fixes",
    module: "AI visibility",
    label: "One-click fixes",
    pitch:
      "Apply fixes to WordPress or Webflow, or open a pull request on GitHub, with undo and verification.",
    minPlan: "growth",
  },
  geo_agent: {
    key: "geo_agent",
    module: "AI visibility",
    label: "GEO Engineer and Fix all",
    pitch:
      "An agent that reads your repo and ships multi-file fixes, plus one pull request for every finding.",
    minPlan: "agency",
  },
  experiments: {
    key: "experiments",
    module: "AI visibility",
    label: "Proof Engine experiments",
    pitch: "Test one change on half your pages and prove what moves rankings and citations.",
    minPlan: "starter",
  },
  competitors: {
    key: "competitors",
    module: "Intelligence",
    label: "Competitor tracking",
    pitch: "Watch competitors' launches, pricing and content, with intelligence reports.",
    minPlan: "starter",
  },
  market_brain: {
    key: "market_brain",
    module: "Intelligence",
    label: "Market Brain",
    pitch: "A weekly read of your market from real, dated sources, turned into what to do next.",
    minPlan: "starter",
  },
  analytics_insights: {
    key: "analytics_insights",
    module: "Intelligence",
    label: "GA4 and Search Console insights",
    pitch: "Plain-language insights from your analytics, tied back to your content.",
    minPlan: "starter",
  },
  publishing: {
    key: "publishing",
    module: "Distribution",
    label: "Publishing",
    pitch:
      "Connect a social profile per brand and publish to all 13 networks, WordPress and Webflow. Unlimited posts.",
    minPlan: "starter",
  },
  backlinks: {
    key: "backlinks",
    module: "Distribution",
    label: "Backlink marketplace",
    pitch: "Buy real placements on relevant sites, verified live on the page.",
    minPlan: "growth",
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
  white_label: {
    key: "white_label",
    module: "Team",
    label: "White-label",
    // In scope for launch: agency name, logo and colours on the client portal and shared
    // reports. A custom domain is the separate "white_label_domain" add-on (later).
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

export const CREDITS_PER_USD = 100;

export type CreditActionDef = {
  credits: number;
  label: string;
  unit: string;
  /** Feature that must be unlocked to run it (checked before any hold). */
  feature: FeatureKey | null;
  /** Expected provider cost in USD on the v2 stack (for margin monitoring). */
  expectedCostUsd: number;
  /** task-models.ts route labels this action covers (for the coverage test). */
  routes: string[];
};

export const CREDIT_ACTIONS = {
  // Studio (WORKHORSE unless noted)
  post_set: {
    credits: 12,
    label: "Social post set",
    unit: "up to 3 platforms",
    feature: "studio",
    expectedCostUsd: 0.023,
    routes: ["studio.social", "content.generateBatch", "content.generateNextPost", "schedule.*"],
  },
  post_regenerate: {
    credits: 4,
    label: "Regenerate a post",
    unit: "per post",
    feature: "studio",
    expectedCostUsd: 0.008,
    routes: ["content.regenerate"],
  },
  image_post: {
    credits: 30,
    label: "Image post",
    unit: "copy + image",
    feature: "studio",
    expectedCostUsd: 0.066,
    routes: ["studio.captions"],
  },
  carousel: {
    credits: 30,
    label: "Carousel",
    unit: "per carousel",
    feature: "studio",
    expectedCostUsd: 0.06,
    routes: ["studio.carousel"],
  },
  ad_set: {
    credits: 30,
    label: "Ad set",
    unit: "copy variants + image",
    feature: "studio",
    expectedCostUsd: 0.058,
    routes: ["studio.ad"],
  },
  article_standard: {
    credits: 20,
    label: "Standard article",
    unit: "~1,200 words",
    feature: "studio",
    expectedCostUsd: 0.031,
    routes: ["studio.article.standard"],
  },
  article_premium: {
    credits: 100,
    label: "Premium article",
    unit: "~1,200 words",
    feature: "premium_articles",
    expectedCostUsd: 0.193,
    routes: ["studio.article"],
  },
  article_long: {
    credits: 140,
    label: "Long-form article",
    unit: "~2,500 words",
    feature: "premium_articles",
    expectedCostUsd: 0.273,
    routes: ["studio.article"],
  },
  script: {
    credits: 10,
    label: "Video script",
    unit: "per script",
    feature: "studio",
    expectedCostUsd: 0.021,
    routes: ["studio.script"],
  },
  ideas: {
    credits: 7,
    label: "Content ideas",
    unit: "per batch",
    feature: "studio",
    expectedCostUsd: 0.014,
    routes: ["studio.ideas", "studio.prompt"],
  },
  // /api/ai-generate is priced by what it actually does: normal size = social_multi;
  // size "long" on WORKHORSE = article_standard; escalated to PREMIUM = article_premium
  // (and requires premium_articles).
  social_multi: {
    credits: 10,
    label: "Multi-platform variants",
    unit: "5 platforms",
    feature: "studio",
    expectedCostUsd: 0.019,
    routes: ["social.multi", "ai-generate", "ai-generate.*"],
  },
  image_standard: {
    credits: 15,
    label: "Standard image",
    unit: "per image",
    feature: "studio",
    expectedCostUsd: 0.037,
    routes: [],
  },
  image_premium: {
    credits: 40,
    label: "Premium image",
    unit: "per image",
    feature: "studio",
    expectedCostUsd: 0.086,
    routes: [],
  },
  image_edit: {
    credits: 20,
    label: "Image edit",
    unit: "up to 2 references",
    feature: "studio",
    expectedCostUsd: 0.05,
    routes: [],
  },
  campaign: {
    credits: 55,
    label: "Campaign plan",
    unit: "per plan",
    feature: "campaigns",
    expectedCostUsd: 0.107,
    routes: ["campaign-generation"],
  },
  // Brand
  brand_dna_rescan: {
    credits: 125,
    label: "Brand DNA re-scan",
    unit: "first scan per brand is free",
    feature: null,
    expectedCostUsd: 0.234,
    routes: ["brand-extract", "brand-extract.search"],
  },
  brand_voice_rerun: {
    credits: 45,
    label: "Brand voice re-analysis",
    unit: "first run per brand is free",
    feature: null,
    expectedCostUsd: 0.083,
    routes: ["brand-kit/analyze-writing"],
  },
  file_extract: {
    credits: 4,
    label: "File or image reading",
    unit: "per file",
    feature: null,
    expectedCostUsd: 0.008,
    routes: ["file-extract"],
  },
  // Research
  coach_briefing: {
    credits: 100,
    label: "Coach briefing on demand",
    unit: "per briefing",
    feature: "market_brain",
    expectedCostUsd: 0.196,
    routes: ["coach", "coach.briefing", "coach.research", "coach.trends"],
  },
  coach_deep: {
    credits: 200,
    label: "Deep strategy",
    unit: "per run",
    feature: "pro_chat",
    expectedCostUsd: 0.375,
    routes: [],
  },
  market_brain_manual: {
    credits: 125,
    label: "Market Brain refresh",
    unit: "outside the weekly schedule",
    feature: "market_brain",
    expectedCostUsd: 0.243,
    routes: ["market-intelligence"],
  },
  competitor_discovery: {
    credits: 25,
    label: "Competitor discovery",
    unit: "per run",
    feature: "competitors",
    expectedCostUsd: 0.051,
    routes: ["competitors.discovery"],
  },
  competitor_profile: {
    credits: 15,
    label: "Competitor profile",
    unit: "per competitor",
    feature: "competitors",
    expectedCostUsd: 0.031,
    routes: ["competitors.profile"],
  },
  competitor_intel: {
    credits: 30,
    label: "Competitor intelligence report",
    unit: "per report",
    feature: "competitors",
    expectedCostUsd: 0.057,
    routes: ["competitor-intel"],
  },
  insights_refresh: {
    credits: 8,
    label: "Analytics insights",
    unit: "per refresh",
    feature: "analytics_insights",
    expectedCostUsd: 0.017,
    routes: ["analytics/insights"],
  },
  // AI visibility (beyond the plan's included scans and prompts)
  site_scan_per_100_pages: {
    credits: 35,
    label: "Extra site scan",
    unit: "per 100 pages",
    feature: null,
    expectedCostUsd: 0.07,
    routes: [],
  },
  prompt_check_3_engines: {
    credits: 8,
    label: "Extra prompt check",
    unit: "3 engines",
    feature: null,
    expectedCostUsd: 0.016,
    routes: ["geo.probe"],
  },
  // "Fix all" = geo_fix x the findings it proposes for (gated by geo_agent for the batch PR),
  // never a flat geo_agent_run.
  geo_fix: {
    credits: 150,
    label: "GEO fix proposal",
    unit: "per finding",
    feature: "geo_fix_proposals",
    expectedCostUsd: 0.286,
    routes: ["geo.fix.propose", "geo.fix.batch"],
  },
  geo_cms_fix: {
    credits: 55,
    label: "One-click fix",
    unit: "per fix",
    feature: "geo_apply_fixes",
    expectedCostUsd: 0.107,
    routes: ["geo.cms.fix"],
  },
  geo_agent_run: {
    credits: 800,
    label: "GEO Engineer run",
    unit: "per run",
    feature: "geo_agent",
    expectedCostUsd: 1.6,
    routes: ["geo.agent.investigate", "geo.agent.implement", "geo.agent.review"],
  },
  experiment: {
    credits: 70,
    label: "Proof Engine experiment",
    unit: "per experiment",
    feature: "experiments",
    expectedCostUsd: 0.144,
    routes: ["experiments.hypotheses", "experiments.values", "experiments.integration"],
  },
  // UGC (renders use Video Credits)
  ugc_concepts: {
    credits: 25,
    label: "UGC concept pack",
    unit: "per product",
    feature: "ugc",
    expectedCostUsd: 0.051,
    routes: ["ugc.product.extract", "ugc.concepts", "ugc.notes"],
  },
  // Chat beyond the plan allowance
  pro_message: {
    credits: 25,
    label: "Mellox Pro message",
    unit: "after the monthly allowance",
    feature: "pro_chat",
    expectedCostUsd: 0.048,
    routes: ["chat.pro"],
  },
  flash_message_over_cap: {
    credits: 2,
    label: "Mellox Flash message",
    unit: "after the fair-use cap",
    feature: null,
    expectedCostUsd: 0.009,
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
  "studio.research",
  "brand-kit/analyze-visual",
  "brand-kit/describe",
  "analytics/insights-auto",
  "agent.content-fit",
  "agent.distribution-reliability",
  "competitors.updates",
  "links-topical-fit",
  "links-relevance-pick",
  "links-profile",
  "links-article-brief",
  "guardrails.image-moderation",
];

export function creditsFor(action: CreditAction, quantity = 1): number {
  return Math.ceil(CREDIT_ACTIONS[action].credits * Math.max(0, quantity));
}

/**
 * Chat is priced per message, but a message's cost grows with its context. One
 * message uses one unit per started band of input tokens (after the gateway trims
 * history), so a 50k-token Pro message uses 3 Pro messages (or 75 credits).
 */
export const CHAT_INPUT_TOKEN_BANDS = { pro: 20_000, flash: 16_000 } as const;

export function chatUnitsFor(
  kind: keyof typeof CHAT_INPUT_TOKEN_BANDS,
  inputTokens: number,
): number {
  return Math.max(1, Math.ceil(Math.max(0, inputTokens) / CHAT_INPUT_TOKEN_BANDS[kind]));
}

/* ─────────────────────────── video credits ─────────────────────────── */

export type UgcModelKey = "standard" | "draft" | "premium" | "long" | "cinematic" | "variation";
/** Provider resolutions. 768p (KIE MiniMax H3) is priced and gated like 720p. */
export type VideoResolution = "480p" | "720p" | "768p" | "1080p" | "2k";

function priceBand(resolution: VideoResolution): VideoResolution {
  return resolution === "768p" ? "720p" : resolution;
}

/**
 * Video providers for now: KIE runs Veo 3.1 Fast / Lite (standard, draft) and Grok
 * Imagine (variation) because it is 2.6-3.9x cheaper there and those prices are
 * verified in src/lib/ugc/models.ts. OpenRouter runs premium, cinematic, long and the
 * Studio clip (KIE prices for Gemini Omni / MiniMax H3 are unverified; Seedance is
 * cheaper on OpenRouter). OpenRouter is also every KIE option's fallback.
 */
export type VideoProviderId = "kie" | "openrouter";

export type VideoOptionDef = {
  ugcKey: UgcModelKey;
  provider: VideoProviderId;
  /** Where the render goes if the primary refuses or fails. Variation falls back to Veo 3.1 Lite, never Grok on OpenRouter (~$0.90). */
  fallback: string;
  seconds: number;
  resolution: VideoResolution;
  /** 100 = 1 Video Credit. */
  videoUnits: number;
  feature: FeatureKey;
  label: string;
};

/** 1 VC = one 8-second Standard video (Veo 3.1 Fast, 720p). */
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
    fallback: "openrouter google/veo-3.1-fast",
    ugcKey: "standard",
    seconds: 8,
    resolution: "720p",
    videoUnits: 100,
    feature: "ugc",
    label: "Standard 8s 720p",
  },
  {
    provider: "kie",
    fallback: "openrouter google/veo-3.1-fast",
    ugcKey: "standard",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 125,
    feature: "video_1080p",
    label: "Standard 8s 1080p",
  },
  {
    provider: "openrouter",
    fallback: "none",
    ugcKey: "premium",
    seconds: 8,
    resolution: "1080p",
    videoUnits: 150,
    feature: "video_premium",
    label: "Premium 8s",
  },
  {
    provider: "openrouter",
    fallback: "none",
    ugcKey: "premium",
    seconds: 10,
    resolution: "1080p",
    videoUnits: 200,
    feature: "video_premium",
    label: "Premium 10s",
  },
  {
    provider: "openrouter",
    fallback: "none",
    ugcKey: "cinematic",
    seconds: 10,
    resolution: "2k",
    videoUnits: 200,
    feature: "video_cinematic",
    label: "Cinematic 10s",
  },
  {
    provider: "openrouter",
    fallback: "none",
    ugcKey: "long",
    seconds: 12,
    resolution: "720p",
    videoUnits: 150,
    feature: "video_premium",
    label: "Long take 12s 720p",
  },
  {
    provider: "openrouter",
    fallback: "none",
    ugcKey: "long",
    seconds: 15,
    resolution: "720p",
    videoUnits: 200,
    feature: "video_premium",
    label: "Long take 15s 720p",
  },
  {
    provider: "openrouter",
    fallback: "none",
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
];

/**
 * Studio "Generate video" (/api/generate-video, 6s on the premium key). Deliberately
 * gated by "ugc" (all paid plans): a 6s clip costs ~$0.82, covered by 1 VC.
 */
export const STUDIO_VIDEO_UNITS = 100;

/** Studio clip provider. */
export const STUDIO_VIDEO_PROVIDER: VideoProviderId = "openrouter";

/** Cost of 1 VC on OpenRouter at the Standard option, incl. the 5.5% fee. */
export const USD_PER_VC_REFERENCE = 0.844;

/**
 * Guard: a render may never cost Mellox more than this per VC charged (1.2x the
 * reference). Above it, the render is charged more VC. With today's routes nothing
 * trips it; it protects against a new model, a longer duration or a pricier provider.
 */
export const MAX_USD_PER_VC = 1.01;

/**
 * Price a render. The server passes the routed provider's real cost (from the
 * model registry: provider, model, seconds, resolution, reference images).
 * Result = max(catalog price for that option, cost-based floor), in quarter-VC
 * steps, never below 0.25 VC. Show the exact figure on the Generate button after
 * routing (preview), and charge the same figure.
 */
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
  return Math.max(proportional, floorUnits);
}

/** The feature a render needs. The video router must receive the plan and never pick a locked option. */
export function videoFeatureFor(ugcKey: UgcModelKey, resolution: VideoResolution): FeatureKey {
  if (ugcKey === "cinematic") return "video_cinematic";
  if (ugcKey === "premium" || ugcKey === "long") return "video_premium";
  const band = priceBand(resolution);
  if (band === "1080p" || band === "2k") return "video_1080p";
  return "ugc";
}

export function formatVc(videoUnits: number): string {
  const vc = videoUnits / VIDEO_UNITS_PER_VC;
  return Number.isInteger(vc) ? String(vc) : vc.toFixed(2).replace(/0$/, "");
}

/* ───────────────────────── packs and add-ons ───────────────────────── */

/**
 * Where a grant may be spent:
 *   any      AI actions AND backlink purchases (money the customer paid for)
 *   ai_only  AI actions only: plan allowances, bonus, trial, signup, referral, promo
 */
export type GrantRestriction = "any" | "ai_only";

export type CreditPackDef = { key: string; usd: number; credits: number; bonusCredits: number };

/** Never expire. Paid credits are "any"; bonus credits are "ai_only". */
export const CREDIT_PACKS: CreditPackDef[] = [
  { key: "credits_25", usd: 25, credits: 2_500, bonusCredits: 0 },
  { key: "credits_100", usd: 100, credits: 10_000, bonusCredits: 500 },
  { key: "credits_250", usd: 250, credits: 25_000, bonusCredits: 2_500 },
  { key: "credits_500", usd: 500, credits: 50_000, bonusCredits: 7_500 },
];

export type VideoPackDef = { key: string; usd: number; videoUnits: number };

/** Never expire. */
export const VIDEO_PACKS: VideoPackDef[] = [
  { key: "video_10", usd: 29, videoUnits: 1_000 },
  { key: "video_30", usd: 79, videoUnits: 3_000 },
  { key: "video_100", usd: 249, videoUnits: 10_000 },
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
  /** What one unit adds. */
  adds: Partial<{
    brands: number;
    socialProfiles: number;
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
  /** "later" = not built yet: hide from checkout, never promise it. */
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
      socialProfiles: 1,
      trackedPrompts: 30,
      credits: 1_500,
      videoUnits: 300,
      marketBrainWeeklyBrands: 1,
    },
    availability: "launch",
  },
  prompts_100: {
    key: "prompts_100",
    label: "+100 tracked prompts",
    usdPerMonth: 39,
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
    availability: "launch",
  },
  daily_market_brain: {
    key: "daily_market_brain",
    label: "Daily Market Brain, per brand",
    usdPerMonth: 29,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { marketBrainDailyBrands: 1 },
    availability: "launch",
  },
  pro_200: {
    key: "pro_200",
    label: "+200 Mellox Pro messages",
    usdPerMonth: 29,
    plans: ["starter", "growth", "agency", "scale"],
    adds: { proMessages: 200 },
    availability: "launch",
  },
  extra_seat: {
    key: "extra_seat",
    label: "Extra seat",
    usdPerMonth: 15,
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

/** One-time grant for every new account. Lets Free users try Studio. */
export const SIGNUP_GRANT = {
  credits: 100,
  restriction: "ai_only" as GrantRestriction,
  expiresInDays: 30,
};

/** Card-required trial. Plan limits are Growth's; money allowances are trial-sized. */
export const TRIAL = {
  plan: "growth" as PaidPlanId,
  days: 14,
  credits: 500,
  videoUnits: 200,
  proMessages: 20,
  flashMessages: 500,
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
 * (= 12 months). In Paddle this is a non-recurring discount restricted to the annual
 * plan prices, usage limit 50. Do NOT use a 12-interval recurring discount on annual
 * prices (that would be 12 years).
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
  credits: 1_000,
  videoUnits: 200,
  restriction: "ai_only" as GrantRestriction,
  expiresInDays: 90,
  maxRewardsPerYear: 20,
  rewardAfterDays: 14,
};

/** Share of any allowance at which the user is nudged (in-app + email). */
export const SOFT_LIMIT_RATIO = 0.8;

/** Payment failed: full access for this long, then Free limits until paid. */
export const PAST_DUE_GRACE_DAYS = 7;
