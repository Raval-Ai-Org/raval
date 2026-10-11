// Pricing content for /pricing and the other public pages.
//
// Plans, packs and add-ons come from the product's own catalog (src/lib/billing/catalog.ts), so this page can
// never show a price, an allowance or a feature the product doesn't really sell. Change a number there, not here.
import {
  ADDONS as CATALOG_ADDONS,
  CREDIT_ACTIONS,
  CREDIT_PACKS as CATALOG_CREDIT_PACKS,
  PLANS as CATALOG_PLANS,
  VIDEO_PACKS as CATALOG_VIDEO_PACKS,
  VIDEO_UNITS_PER_VC,
  type AddonKey,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import type { Faq } from "./faqs";
import { NEW_FAQS } from "./whats-new";

const n = (value: number) => Math.round(value).toLocaleString("en-US");

export type Plan = {
  id: PaidPlanId;
  name: string;
  badge?: string;
  tagline: string;
  /** Monthly price in USD. Every plan has one; `null` is kept for the pages that still check for it. */
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

/** The paid plans, cheapest first. */
export const PAID_PLANS: PaidPlanId[] = ["starter", "growth", "agency", "scale"];

export const PLANS: Plan[] = PAID_PLANS.map((id, i) => {
  const def = CATALOG_PLANS[id];
  const videos = def.allowances.videoUnits / VIDEO_UNITS_PER_VC;
  const below = PAID_PLANS[i - 1];
  return {
    id,
    name: def.label,
    badge: def.badge,
    tagline: def.fit,
    monthly: def.priceMonthlyUsd,
    credits: `${n(def.allowances.credits)} credits/mo`,
    imagePosts: `~ ${n(Math.floor(def.allowances.credits / CREDIT_ACTIONS.image_post.credits))} image posts`,
    articles: `~ ${n(Math.floor(def.allowances.credits / CREDIT_ACTIONS.article_premium.credits))} premium articles`,
    video: `+ ${n(videos)} videos a month`,
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

export const TRY_FIRST = [
  {
    id: "free",
    kicker: "No card needed",
    name: "Free plan",
    blurb: "Scan your brand, see your first AI visibility findings, and try the assistant.",
    features: [
      "100 credits to spend, one time",
      "1 brand with a Brand DNA scan",
      "5 tracked AI prompts, checked weekly",
      "1 site scan, up to 25 pages",
      "30 Mellox Flash chat messages",
    ],
    cta: "Start free",
  },
  {
    id: "trial",
    kicker: "14 days of Growth",
    name: "Growth trial",
    blurb: "Run a real workflow across several brands before you commit to a plan.",
    features: [
      "500 credits and 2 video credits",
      "3 brand workspaces",
      "20 Mellox Pro chat messages",
      "Card required to start",
    ],
    cta: "Start 14 day trial",
  },
];

export const CREDIT_PACKS = CATALOG_CREDIT_PACKS.map((pack) => ({
  price: pack.usd,
  credits: pack.credits + pack.bonusCredits,
  bonus: Math.round((pack.bonusCredits / pack.credits) * 100),
}));

export const VIDEO_PACKS = CATALOG_VIDEO_PACKS.map((pack) => {
  const videos = pack.videoUnits / VIDEO_UNITS_PER_VC;
  return { credits: videos, rate: `$${(pack.usd / videos).toFixed(2)}`, price: `$${pack.usd}` };
});

// What each add-on is, in a sentence. Only add-ons the product sells today are listed: one the catalog marks
// "later" is never promised here.
const ADDON_TEXT: Record<AddonKey, { name: string; desc: string }> = {
  extra_brand: { name: "Extra brand", desc: "One more workspace with its own tracked prompts, credits and weekly Market Brain. Growth, Agency, Scale." },
  prompts_100: { name: "+100 tracked prompts", desc: "One hundred more prompts, checked weekly on your plan's engines." },
  daily_tracking_100: { name: "Daily tracking", desc: "Moves 100 prompts from weekly checks to daily checks." },
  ai_overviews_100: { name: "Google AI Overviews engine", desc: "Adds real AI Overview capture, per 100 prompts." },
  daily_market_brain: { name: "Daily Market Brain", desc: "Refreshes market intelligence every day instead of weekly, per brand." },
  pro_200: { name: "+200 Mellox Pro messages", desc: "Extra Pro chat for strategy heavy months." },
  extra_seat: { name: "Extra seat", desc: "One more teammate. Starter and Growth." },
  white_label_domain: { name: "White label domain", desc: "Serve the client portal on your agency's own domain. Agency and Scale." },
};

export const ADDONS = Object.values(CATALOG_ADDONS)
  .filter((addon) => addon.availability === "launch")
  .map((addon) => ({ ...ADDON_TEXT[addon.key], price: `$${addon.usdPerMonth}` }));

export const CREDIT_MENU: [string, string][] = [
  ["Social post set, up to 3 platforms", "12"],
  ["Standard image", "15"],
  ["Image post, copy and image", "30"],
  ["Carousel", "30"],
  ["Premium image", "40"],
  ["Campaign plan", "55"],
  ["Premium article, about 1,200 words", "100"],
  ["Long form article, about 2,500 words", "140"],
  ["Marketing Coach briefing, on demand", "100"],
  ["Competitor intelligence report", "30"],
  ["Brand DNA re-scan, first scan free", "125"],
  ["GEO fix proposal, per finding", "150"],
  ["GEO CMS fix, WordPress or Webflow", "55"],
  ["Extra site scan, per 100 pages", "35"],
];

export const VIDEO_MENU: [string, string][] = [
  ["Draft video", "0.5 to 0.75 VC"],
  ["Standard video", "1 to 1.25 VC"],
  ["Premium video", "1.5 to 2 VC"],
  ["Long take video", "1 to 2 VC"],
  ["Cinematic video", "2 VC"],
];

export const PRICING_FAQS: Faq[] = [
  {
    q: "What is a credit?",
    a: "Credits pay for AI work: posts, images, articles, research and audits. One credit is worth $0.01 at face value. A social post set costs 12 credits, an image post 30 and a premium article 100. The full list is on this page.",
  },
  {
    q: "Why does video have its own allowance?",
    a: "So a few renders can never drain the credits you need for posts and articles. One video credit buys one 8 second Standard video. Draft quality costs less, Premium and Cinematic cost more, and the price shows on the Generate button before you spend.",
  },
  {
    q: "Do unused credits roll over?",
    a: "Not on monthly plans. On annual plans, up to one month of your allowance carries over. Credit packs and video packs you buy never expire.",
  },
  {
    q: "What happens when I run out?",
    a: "You get a nudge at 80% of your credits, video credits or Pro messages, with one click packs or an upgrade. Flash chat is fair use, then 2 credits a message. Pro chat is 25 credits a message after your plan's allowance.",
  },
  {
    q: "How does annual billing work?",
    a: `You pay for 10 months and get 12. ${PLANS.map((p) => `${p.name} is $${n(CATALOG_PLANS[p.id].priceAnnualUsd)} a year`).join(", ")}, which works out to the per month prices shown above.`,
  },
  {
    q: "Can I pause instead of cancelling?",
    a: "Yes, on any paid plan. Pausing costs $9 a month and keeps your data, your brands and 10 weekly tracked prompts.",
  },
  {
    q: "Can I add more brands or seats?",
    a: "Extra brands are $39 a month on Growth, Agency and Scale. Extra seats are $15 a month on Starter and Growth. Agency already has unlimited seats.",
  },
  {
    q: "What does Scale include?",
    a: `Scale is for large teams: ${n(CATALOG_PLANS.scale.brands)} brands, ${n(CATALOG_PLANS.scale.allowances.credits)} credits and ${n(CATALOG_PLANS.scale.allowances.videoUnits / VIDEO_UNITS_PER_VC)} videos a month, a dedicated account manager and support with a guaranteed response time. It is $${n(CATALOG_PLANS.scale.priceMonthlyUsd)} a month, or $${n(CATALOG_PLANS.scale.priceAnnualUsd)} a year. SSO and API access are coming soon.`,
  },
  ...NEW_FAQS,
];
