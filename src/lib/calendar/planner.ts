// Content Calendar planner — the choices a person makes before Mellox plans
// their posts, and the pure maths that turns those choices into dated slots.
//
// The split matters: *when* and *where* each post goes (day, time, channel,
// topic, type) is decided here, deterministically, so a plan always has exactly
// the number of posts asked for, spread the way the person chose. The model is
// only asked to write the words for slots that already exist.

import { momentsBetween, type MarketingMoment } from "@/lib/studio/moments";
import { addDays, fmtYMD, isYMD, parseYMD, type CalendarChannel } from "./model";

/* ───────────────────────────── goals ───────────────────────────── */

export const PLAN_GOALS = [
  {
    id: "awareness",
    label: "Reach new people",
    brief:
      "Reach people who have not heard of the brand: useful, shareable posts that stand on their own without knowing the brand.",
  },
  {
    id: "leads",
    label: "Get leads and enquiries",
    brief:
      "Earn enquiries: show the problem the brand solves and end with one clear next step (message, book, sign up).",
  },
  {
    id: "sales",
    label: "Sell more",
    brief:
      "Drive purchases: make the offer, its benefit and how to buy obvious, without pressure or invented urgency.",
  },
  {
    id: "engagement",
    label: "Keep followers engaged",
    brief:
      "Start conversations with people who already follow: questions, opinions, relatable moments, replies worth giving.",
  },
  {
    id: "trust",
    label: "Build trust",
    brief:
      "Build credibility: show how the work is done, what the brand knows, and the people behind it. Proof only if it is in the brand context.",
  },
  {
    id: "launch",
    label: "Launch something new",
    brief:
      "Build up to a launch: tease first, explain the benefit, announce, then follow up with answers to likely questions.",
  },
] as const;

export type PlanGoalId = (typeof PLAN_GOALS)[number]["id"];

/* ───────────────────────────── topics ───────────────────────────── */

export const PLAN_TOPICS = [
  {
    id: "tips",
    label: "Tips and how-tos",
    brief: "Teach one practical thing the audience can use today.",
  },
  {
    id: "product",
    label: "Products and services",
    brief: "Show one product or service and the problem it solves.",
  },
  {
    id: "proof",
    label: "Customer stories",
    brief:
      "Show a result or a customer's experience. Use only proof given in the brand context; otherwise invite customers to share theirs.",
  },
  {
    id: "behind",
    label: "Behind the scenes",
    brief: "Show the people, process or day-to-day behind the brand.",
  },
  {
    id: "offers",
    label: "Offers",
    brief:
      "Present an offer clearly. If no offer is given in the brand context or notes, write it so the owner can fill in the details, and say so in the title.",
  },
  {
    id: "news",
    label: "News and trends",
    brief:
      "Comment on something current in the industry with a clear point of view. Do not invent news or statistics.",
  },
  {
    id: "community",
    label: "Questions and polls",
    brief: "Ask the audience something easy and interesting to answer.",
  },
  {
    id: "inspiration",
    label: "Inspiration",
    brief: "Share an idea, belief or story that reflects what the brand stands for.",
  },
] as const;

export type PlanTopicId = (typeof PLAN_TOPICS)[number]["id"];

const TOPIC_BY_ID = new Map(PLAN_TOPICS.map((t) => [t.id, t]));

export function topicLabel(id: string): string {
  return TOPIC_BY_ID.get(id as PlanTopicId)?.label ?? id;
}

/* ───────────────────────────── industries ───────────────────────────── */

type Industry = {
  id: string;
  label: string;
  /** How often each topic should come up, relative to the others. */
  mix: Partial<Record<PlanTopicId, number>>;
  channels: CalendarChannel[];
  postsPerWeek: number;
  /** A rule the writing must follow for this kind of business. */
  rule?: string;
};

/**
 * Starting points by kind of business. Picking one fills in the topics,
 * channels and pace that businesses like it usually run; every value can still
 * be changed. "auto" lets the workspace's own Brand DNA lead.
 */
export const PLAN_INDUSTRIES: readonly Industry[] = [
  {
    id: "auto",
    label: "Match my brand",
    mix: { tips: 3, product: 2, proof: 2, behind: 1, community: 1 },
    channels: ["instagram", "linkedin", "x"],
    postsPerWeek: 4,
  },
  {
    id: "ecommerce",
    label: "Online shop",
    mix: { product: 3, proof: 2, tips: 2, offers: 2, behind: 1 },
    channels: ["instagram", "facebook", "tiktok"],
    postsPerWeek: 5,
  },
  {
    id: "saas",
    label: "Software and tech",
    mix: { tips: 3, product: 2, proof: 2, news: 2, behind: 1 },
    channels: ["linkedin", "x", "blog"],
    postsPerWeek: 4,
  },
  {
    id: "local",
    label: "Local business",
    mix: { product: 2, proof: 2, behind: 2, offers: 2, community: 2 },
    channels: ["instagram", "facebook"],
    postsPerWeek: 4,
    rule: "Keep it local: mention the area and practical details (opening hours, how to book) only when they are in the brand context.",
  },
  {
    id: "food",
    label: "Restaurant and food",
    mix: { product: 3, behind: 2, offers: 2, proof: 2, community: 1 },
    channels: ["instagram", "facebook", "tiktok"],
    postsPerWeek: 5,
  },
  {
    id: "beauty",
    label: "Beauty and fashion",
    mix: { product: 3, tips: 2, proof: 2, inspiration: 2, offers: 1 },
    channels: ["instagram", "tiktok", "youtube"],
    postsPerWeek: 5,
    rule: "No before/after or results claims unless they are in the brand context.",
  },
  {
    id: "health",
    label: "Health and wellness",
    mix: { tips: 4, proof: 1, behind: 2, community: 2, inspiration: 1 },
    channels: ["instagram", "facebook", "youtube"],
    postsPerWeek: 4,
    rule: "No medical claims, diagnoses or promised results. Keep advice general and suggest seeing a professional where it matters.",
  },
  {
    id: "realestate",
    label: "Real estate",
    mix: { product: 3, tips: 3, proof: 2, news: 1, behind: 1 },
    channels: ["instagram", "facebook", "linkedin"],
    postsPerWeek: 4,
    rule: "No price, yield or market predictions that are not in the brand context.",
  },
  {
    id: "services",
    label: "Professional services",
    mix: { tips: 4, proof: 2, news: 2, behind: 1, product: 1 },
    channels: ["linkedin", "x", "blog"],
    postsPerWeek: 3,
    rule: "Share general know-how, not advice for a specific person's situation.",
  },
  {
    id: "finance",
    label: "Finance and insurance",
    mix: { tips: 4, news: 2, proof: 1, product: 2, community: 1 },
    channels: ["linkedin", "x", "blog"],
    postsPerWeek: 3,
    rule: "Educational only: no promised returns, no personal financial advice, no predictions.",
  },
  {
    id: "education",
    label: "Education and coaching",
    mix: { tips: 4, proof: 2, inspiration: 2, community: 1, product: 1 },
    channels: ["instagram", "youtube", "linkedin"],
    postsPerWeek: 4,
  },
  {
    id: "travel",
    label: "Travel and hospitality",
    mix: { inspiration: 3, product: 2, proof: 2, tips: 2, offers: 1 },
    channels: ["instagram", "facebook", "tiktok"],
    postsPerWeek: 5,
  },
  {
    id: "agency",
    label: "Agency and B2B",
    mix: { tips: 3, proof: 3, news: 2, behind: 1, product: 1 },
    channels: ["linkedin", "x", "blog"],
    postsPerWeek: 3,
  },
  {
    id: "creator",
    label: "Creator or personal brand",
    mix: { tips: 3, behind: 3, inspiration: 2, community: 2 },
    channels: ["instagram", "tiktok", "youtube"],
    postsPerWeek: 5,
  },
  {
    id: "nonprofit",
    label: "Charity and community",
    mix: { proof: 3, behind: 2, inspiration: 2, community: 2, news: 1 },
    channels: ["facebook", "instagram", "linkedin"],
    postsPerWeek: 3,
    rule: "Describe impact only with figures from the brand context.",
  },
];

export type PlanIndustryId = string;

export function industryById(id: string): Industry {
  return PLAN_INDUSTRIES.find((i) => i.id === id) ?? PLAN_INDUSTRIES[0];
}

/* ───────────────────────────── times and types ───────────────────────────── */

/**
 * Starting times per channel. These are common-practice defaults, not
 * something measured for this brand: each post's time can be changed.
 */
const USUAL_TIMES: Record<CalendarChannel, string[]> = {
  instagram: ["11:00", "18:00", "13:00"],
  facebook: ["13:00", "10:00", "19:00"],
  linkedin: ["08:30", "12:00", "17:00"],
  x: ["09:00", "12:30", "17:00"],
  threads: ["09:30", "19:00"],
  tiktok: ["19:00", "12:00", "21:00"],
  youtube: ["15:00", "18:00"],
  blog: ["10:00"],
  email: ["10:00", "07:30"],
};

const CHANNEL_FORMATS: Record<CalendarChannel, string[]> = {
  instagram: ["Post", "Carousel", "Reel"],
  facebook: ["Post", "Post", "Video"],
  linkedin: ["Post", "Carousel", "Post"],
  x: ["Post", "Thread", "Post"],
  threads: ["Post"],
  tiktok: ["Video"],
  youtube: ["Video", "Short"],
  blog: ["Article"],
  email: ["Email"],
};

/* ───────────────────────────── slots ───────────────────────────── */

/** The most posts one plan may hold: enough for six busy weeks, small enough to write well. */
export const MAX_PLAN_POSTS = 36;
export const PLAN_WEEK_OPTIONS = [1, 2, 4, 6] as const;

export function maxPostsPerWeek(weeks: number): number {
  return Math.max(1, Math.min(14, Math.floor(MAX_PLAN_POSTS / Math.max(1, weeks))));
}

export type PlanOptions = {
  startDate: string; // YYYY-MM-DD
  weeks: number;
  postsPerWeek: number;
  channels: CalendarChannel[];
  /** Days to post on, 0 = Sunday … 6 = Saturday. Empty means any day. */
  weekdays: number[];
  topics: PlanTopicId[];
  industry: PlanIndustryId;
  keyDates: boolean;
};

export type PlanSlot = {
  index: number;
  date: string;
  time: string;
  channel: CalendarChannel;
  format: string;
  topic: PlanTopicId;
  /** A key date this post should be about, when one falls close after it. */
  moment?: { name: string; date: string; angle: string };
};

/** `n` picks spread evenly over `length` positions, centred rather than bunched at the start. */
function spread(length: number, n: number): number[] {
  if (length <= 0 || n <= 0) return [];
  return Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.min(length - 1, Math.round(((i + 0.5) * length) / n - 0.5))),
  );
}

/**
 * Smooth weighted round-robin: each topic comes up in proportion to its weight
 * and never several times in a row when another topic is due.
 */
function topicSequence(
  topics: PlanTopicId[],
  industry: PlanIndustryId,
  count: number,
): PlanTopicId[] {
  const chosen = topics.length ? topics : (["tips"] as PlanTopicId[]);
  const mix = industryById(industry).mix;
  const weights = chosen.map((id) => Math.max(1, mix[id] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const current = chosen.map(() => 0);
  const out: PlanTopicId[] = [];
  for (let i = 0; i < count; i++) {
    let best = 0;
    for (let t = 0; t < chosen.length; t++) {
      current[t] += weights[t];
      if (current[t] > current[best]) best = t;
    }
    current[best] -= total;
    out.push(chosen[best]);
  }
  return out;
}

export function planEndDate(startDate: string, weeks: number): string {
  return fmtYMD(addDays(parseYMD(startDate), weeks * 7 - 1));
}

export function planPostCount(opts: Pick<PlanOptions, "weeks" | "postsPerWeek">): number {
  return Math.max(0, Math.round(opts.weeks) * Math.round(opts.postsPerWeek));
}

export function buildPlanSlots(opts: PlanOptions): PlanSlot[] {
  if (!isYMD(opts.startDate)) return [];
  const weeks = Math.max(1, Math.round(opts.weeks));
  const perWeek = Math.max(1, Math.round(opts.postsPerWeek));
  const channels = opts.channels.length ? opts.channels : (["instagram"] as CalendarChannel[]);
  const allowed = new Set(opts.weekdays.filter((d) => d >= 0 && d <= 6));
  const start = parseYMD(opts.startDate);

  const raw: { date: string; nthOnDay: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i));
    const days = allowed.size ? week.filter((d) => allowed.has(d.getDay())) : week;
    const pool = days.length ? days : week;
    const seen = new Map<number, number>();
    for (const pick of spread(pool.length, perWeek)) {
      const nth = seen.get(pick) ?? 0;
      seen.set(pick, nth + 1);
      raw.push({ date: fmtYMD(pool[pick]), nthOnDay: nth });
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.nthOnDay - b.nthOnDay);

  const topics = topicSequence(opts.topics, opts.industry, raw.length);
  const formatTurn = new Map<CalendarChannel, number>();
  const slots: PlanSlot[] = raw.map((r, index) => {
    const channel = channels[index % channels.length];
    const turn = formatTurn.get(channel) ?? 0;
    formatTurn.set(channel, turn + 1);
    const times = USUAL_TIMES[channel];
    const formats = CHANNEL_FORMATS[channel];
    return {
      index,
      date: r.date,
      time: times[r.nthOnDay % times.length],
      channel,
      format: formats[turn % formats.length],
      topic: topics[index],
    };
  });

  if (opts.keyDates && slots.length) {
    attachMoments(slots, momentsBetween(opts.startDate, planEndDate(opts.startDate, weeks)));
  }
  return slots;
}

/** Give each key date to the last free post on or up to a week before it. */
function attachMoments(slots: PlanSlot[], moments: MarketingMoment[]): void {
  for (const moment of moments) {
    const earliest = fmtYMD(addDays(parseYMD(moment.date), -7));
    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i];
      if (slot.moment || slot.date > moment.date) continue;
      if (slot.date < earliest) break;
      slot.moment = { name: moment.name, date: moment.date, angle: moment.angle };
      break;
    }
  }
}

/** The plan's starting choices for a kind of business. */
export function defaultsFor(industry: PlanIndustryId): {
  channels: CalendarChannel[];
  topics: PlanTopicId[];
  postsPerWeek: number;
} {
  const preset = industryById(industry);
  return {
    channels: [...preset.channels],
    topics: PLAN_TOPICS.map((t) => t.id).filter((id) => (preset.mix[id] ?? 0) > 0),
    postsPerWeek: preset.postsPerWeek,
  };
}
