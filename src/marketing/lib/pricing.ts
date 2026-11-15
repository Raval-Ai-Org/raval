// Pricing content for /pricing and the other public pages (pricing v4, ADR-0050).
//
// Plans, packs and add-ons come from the product's own catalog (src/lib/billing/catalog.ts), so this page can
// never show a price, an allowance or a feature the product doesn't really sell. Change a number there, not here.
import {
  ADDONS as CATALOG_ADDONS,
  CREDIT_ACTIONS,
  CREDIT_PACKS as CATALOG_CREDIT_PACKS,
  PACK_VALID_DAYS,
  PAUSE,
  PLANS as CATALOG_PLANS,
  PUBLIC_PLANS,
  TRIAL,
  UNITS_PER_CREDIT,
  VIDEO_CREDITS_PER_SECOND,
  annualMonthlyUsd,
  creditsOf,
  type AddonKey,
  type CreditAction,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import { planOutcomes } from "@/lib/billing/plan-economics";
import type { Faq } from "./faqs";
import { NEW_FAQS } from "./whats-new";

const n = (value: number) => Math.round(value).toLocaleString("en-US");
const credits = (units: number) => creditsOf(units);

export type Plan = {
  id: PaidPlanId;
  name: string;
  badge?: string;
  tagline: string;
  /** Monthly price in USD. `null` shows "Custom" (Enterprise). */
  monthly: number | null;
  credits: string;
  imagePosts: string;
  articles: string;
  video: string;
  chips: string[];
  cta: string;
  ctaNote?: string;
  featuresIntro?: string;
  features: string[];
  featured?: boolean;
};

/** The three plans sold on the page, cheapest first. Enterprise is "Talk to us". */
export const PAID_PLANS: PaidPlanId[] = [...PUBLIC_PLANS];

export const PLANS: Plan[] = PAID_PLANS.map((id, i) => {
  const def = CATALOG_PLANS[id];
  const made = planOutcomes(id);
  const below = PAID_PLANS[i - 1];
  return {
    id,
    name: def.label,
    badge: def.badge,
    tagline: def.fit,
    monthly: def.priceMonthlyUsd,
    credits: `${n(made.credits)} credits a month`,
    imagePosts: `≈ ${n(made.imagePosts)} image posts`,
    articles: "Text posts, captions, scripts and articles included",
    video: `or ≈ ${n(made.videos)} 10-second videos`,
    chips: [
      `${n(def.brands)} ${def.brands === 1 ? "brand" : "brands"}`,
      def.seats === null ? "Unlimited seats" : `${n(def.seats)} seats`,
    ],
    cta: `Get ${def.label}`,
    featuresIntro: below ? `Everything in ${CATALOG_PLANS[below].label}, plus:` : undefined,
    features: def.highlights,
    featured: id === "growth",
  };
});

/** What one Starter replaces, for the value line on the page (public list prices, 2026-11). */
export const VALUE_ANCHOR = {
  tools: ["Holo", "Arcads", "Otterly", "a scheduler"],
  usdPerMonth: 205,
  line: `Replaces Holo, Arcads, Otterly and a scheduler (about $205 a month), from ${"$"}${n(annualMonthlyUsd("starter"))}.`,
};

export const TRY_FIRST = [
  {
    id: "trial",
    kicker: `${TRIAL.days} days of ${CATALOG_PLANS[TRIAL.plan].label}`,
    name: `${CATALOG_PLANS[TRIAL.plan].label} trial`,
    blurb: "Run a real week of marketing on your own brand before the first payment.",
    features: [
      `${n(credits(TRIAL.credits))} credits to make posts and videos`,
      `${n(CATALOG_PLANS[TRIAL.plan].brands)} brand workspaces`,
      `${n(TRIAL.proMessages)} Mellox Pro chat messages`,
      "Card required; cancel before it ends and pay nothing",
    ],
    cta: `Start the ${TRIAL.days}-day trial`,
  },
  {
    id: "enterprise",
    kicker: "30+ brands",
    name: CATALOG_PLANS.scale.label,
    blurb: "For large teams and networks of brands, with a dedicated account manager.",
    features: [
      `${n(CATALOG_PLANS.scale.brands)}+ brands and unlimited seats`,
      `${n(credits(CATALOG_PLANS.scale.allowances.credits))}+ credits a month`,
      "Support with a guaranteed response time",
      "SSO and API access (coming soon)",
    ],
    cta: "Talk to us",
  },
];

export const CREDIT_PACKS = CATALOG_CREDIT_PACKS.map((pack) => ({
  price: pack.usd,
  credits: credits(pack.credits + pack.bonusCredits),
  bonus: Math.round((pack.bonusCredits / pack.credits) * 100),
}));

/** Video is priced per second in credits; there are no separate video packs any more. */
export const VIDEO_PACKS: { credits: number; rate: string; price: string }[] = [];

// What each add-on is, in a sentence. Only add-ons the product sells today are listed: one the catalog marks
// "later" is never promised here.
const ADDON_TEXT: Record<AddonKey, { name: string; desc: string }> = {
  extra_brand: {
    name: "Extra brand",
    desc: `One more workspace with ${n(credits(CATALOG_ADDONS.extra_brand.adds.credits ?? 0))} credits a month, ${n(CATALOG_ADDONS.extra_brand.adds.trackedPrompts ?? 0)} tracked prompts and weekly Market Brain. Growth and Agency.`,
  },
  prompts_100: {
    name: "+100 tracked AI questions",
    desc: "One hundred more questions, checked weekly on ChatGPT, Gemini and Perplexity.",
  },
  daily_tracking_100: {
    name: "Daily tracking",
    desc: "Moves 100 prompts from weekly checks to daily checks.",
  },
  ai_overviews_100: {
    name: "Google AI Overviews engine",
    desc: "Adds real AI Overview capture, per 100 prompts.",
  },
  daily_market_brain: {
    name: "Daily Market Brain",
    desc: "Refreshes market intelligence every day instead of weekly, per brand.",
  },
  pro_200: { name: "+200 Mellox Pro messages", desc: "Extra Pro chat for strategy heavy months." },
  extra_seat: { name: "Extra seat", desc: "One more teammate. Starter and Growth." },
  white_label_domain: {
    name: "White label domain",
    desc: "Serve the client portal on your agency's own domain.",
  },
};

export const ADDONS = Object.values(CATALOG_ADDONS)
  .filter((addon) => addon.availability === "launch")
  .map((addon) => ({ ...ADDON_TEXT[addon.key], price: `$${addon.usdPerMonth}` }));

const price = (action: CreditAction) => {
  const c = CREDIT_ACTIONS[action].credits / UNITS_PER_CREDIT;
  return c === 0 ? "Free" : n(c);
};

/** The credit menu: what a credit buys, from the catalog. */
export const CREDIT_MENU: [string, string][] = [
  ["Text post set, captions, scripts, standard articles", price("post_set")],
  ["Image post (copy and picture)", price("image_post")],
  ["Ad, carousel or a new version of a picture", price("ad_set")],
  ["Campaign plan", price("campaign")],
  ["Story with picture frames", price("story")],
  ["Product poster", price("product_hero")],
  ["Premium article, about 1,200 words", price("article_premium")],
  ["Long-form article, about 2,500 words", price("article_long")],
  ["Motion graphic", price("motion_graphics")],
  ["Competitor report", price("competitor_intel")],
  ["Brand DNA re-scan (the first scan is included)", price("brand_dna_rescan")],
  ["GEO fix proposal, per finding", price("geo_fix")],
  ["One-click website fix", price("geo_cms_fix")],
  ["GEO Engineer run", price("geo_agent_run")],
];

const perSecond = (key: keyof typeof VIDEO_CREDITS_PER_SECOND) =>
  `${VIDEO_CREDITS_PER_SECOND[key]} a second`;

/** Video, in credits per second of output. */
export const VIDEO_MENU: [string, string][] = [
  ["Draft video", perSecond("draft")],
  ["Standard video (10 s = 30 credits)", perSecond("standard")],
  ["Long take", perSecond("long")],
  ["Premium video", perSecond("premium")],
  ["Cinematic video", perSecond("cinematic")],
  ["Creator (UGC) video ads", "same per-second prices"],
];

const starter = CATALOG_PLANS.starter;

export const PRICING_FAQS: Faq[] = [
  {
    q: "What is a credit?",
    a: `One credit makes one image post. Text work is free on every plan: post sets, captions and caption edits, scripts, standard articles, Flash chat, scheduling and publishing. Bigger work costs more credits (a Story 2, a long article 3) and video is priced per second (Standard is ${VIDEO_CREDITS_PER_SECOND.standard} credits a second, so a 10-second video is ${VIDEO_CREDITS_PER_SECOND.standard * 10}). The price shows on the button before you spend.`,
  },
  {
    q: "Is there a free plan?",
    a: `No. Every plan makes everything, and plans start at $${n(annualMonthlyUsd("starter"))} a month billed yearly. You can try ${CATALOG_PLANS[TRIAL.plan].label} for ${TRIAL.days} days first; a card is needed and you can cancel before the trial ends.`,
  },
  {
    q: "Do unused credits roll over?",
    a: `Yes. Unused plan credits roll over for one month, up to one month of your plan's credits. Top-ups stay valid for ${Math.round(PACK_VALID_DAYS / 30)} months.`,
  },
  {
    q: "What happens when I run out?",
    a: "You get a nudge at 80% of your credits or Pro messages, with a one-click top-up or an upgrade. Flash chat is unlimited within fair use. Pro chat costs 1 credit a message after your plan's allowance.",
  },
  {
    q: "How does annual billing work?",
    a: `You save about 20%. ${PLANS.map((p) => `${p.name} is $${n(CATALOG_PLANS[p.id].priceAnnualUsd)} a year ($${n(annualMonthlyUsd(p.id))} a month)`).join(", ")}.`,
  },
  {
    q: "What does Starter really make in a month?",
    a: `${n(credits(starter.allowances.credits))} credits: for example 100 image posts, 10 carousels and a 10-second video, plus unlimited text posts and publishing, Autopilot, the four brains and ${n(starter.limits.trackedPrompts)} tracked AI questions every week.`,
  },
  {
    q: "Can I pause instead of cancelling?",
    a: `Yes, on any plan. Pausing costs $${PAUSE.usdPerMonth} a month and keeps your data, your brands and ${PAUSE.trackedPrompts} weekly tracked prompts.`,
  },
  {
    q: "Can I add more brands or seats?",
    a: `Extra brands are $${CATALOG_ADDONS.extra_brand.usdPerMonth} a month on Growth and Agency, each with its own credits. Extra seats are $${CATALOG_ADDONS.extra_seat.usdPerMonth} a month on Starter and Growth. Agency already has unlimited seats.`,
  },
  {
    q: "What about larger teams?",
    a: `${CATALOG_PLANS.scale.label} is for ${n(CATALOG_PLANS.scale.brands)}+ brands, with a dedicated account manager and support with a guaranteed response time. Talk to us for a quote. SSO and API access are coming soon.`,
  },
  ...NEW_FAQS,
];
