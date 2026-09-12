// Studio ideas — what Mellox thinks this business should create next.
//
// Ideas are anchored on real signals (upcoming moments, market trends,
// competitor moves, gaps in recent output, and the brand's own pillars) rather
// than templates. This module is pure: it gathers signals, provides a
// deterministic fallback when the model is unavailable, and dedupes against
// recent work and dismissed ideas. The model pass lives in ideas.server.ts.
import type { PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "./aspect";
import { daysUntil } from "./moments";
import { STUDIO_FORMATS, STUDIO_TYPE_ORDER, type StudioType } from "./formats";
import type { GoalId } from "./jobs";
import type { StudioContext } from "./prompts";

export type IdeaSource = "season" | "trend" | "competitor" | "gap" | "pillar" | "momentum";

export const IDEA_SOURCE_LABEL: Record<IdeaSource, string> = {
  season: "Timely",
  trend: "Trend",
  competitor: "Competitor",
  gap: "Gap",
  pillar: "Brand pillar",
  momentum: "Momentum",
};

export type StudioIdea = {
  id: string;
  type: StudioType;
  title: string;
  why: string;
  brief: string;
  platforms: PlatformId[];
  goal?: GoalId;
  ratio?: AspectRatio;
  source: IdeaSource;
};

export type IdeaSignal = {
  source: IdeaSource;
  headline: string;
  detail: string;
  weight: number;
  suggestedType?: StudioType;
  goal?: GoalId;
};

type BrandLike = Record<string, unknown> | null | undefined;

function text(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function firstClause(value: string): string {
  return value.split(/[.;\n|]/)[0]?.trim() ?? "";
}

/** Everything worth building an idea around, strongest first. */
export function collectSignals(
  ctx: StudioContext,
  brand: BrandLike,
  today = new Date(),
): IdeaSignal[] {
  const signals: IdeaSignal[] = [];

  for (const m of ctx.moments.slice(0, 3)) {
    const days = daysUntil(m.date, today);
    signals.push({
      source: "season",
      headline: `${m.name} is ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
      detail: m.angle,
      weight:
        90 - Math.min(40, Math.max(0, days - m.leadDays)) + (m.tags.includes("retail") ? 5 : 0),
      suggestedType: m.tags.includes("retail") ? "ad" : "social",
      goal: m.tags.includes("retail") ? "offer" : "engagement",
    });
  }

  for (const o of ctx.opportunities.slice(0, 3)) {
    signals.push({
      source: "trend",
      headline: firstClause(o).slice(0, 90),
      detail: o,
      weight: 80,
      goal: "awareness",
    });
  }
  for (const q of ctx.risingQueries.slice(0, 2)) {
    signals.push({
      source: "trend",
      headline: `Searches for "${q}" are rising`,
      detail: `People are actively looking for "${q}" — answer it before competitors do.`,
      weight: 72,
      suggestedType: "article",
      goal: "education",
    });
  }

  for (const c of ctx.competitorMoves.slice(0, 2)) {
    signals.push({
      source: "competitor",
      headline: firstClause(c).slice(0, 90),
      detail: c,
      weight: 70,
      goal: "leads",
    });
  }

  // Gaps in recent output.
  const recentTypes = new Map<string, number>();
  for (const r of ctx.recent) recentTypes.set(r.type, (recentTypes.get(r.type) ?? 0) + 1);
  const lastCreated = ctx.recent[0]?.createdAt ? Date.parse(ctx.recent[0].createdAt) : NaN;
  const idleDays = Number.isFinite(lastCreated)
    ? Math.floor((today.getTime() - lastCreated) / 86_400_000)
    : null;
  if (idleDays === null || idleDays >= 5) {
    signals.push({
      source: "momentum",
      headline: idleDays === null ? "Nothing created yet" : `Nothing new in ${idleDays} days`,
      detail: "Consistency beats volume — one strong post restarts momentum.",
      weight: 78,
      suggestedType: "social",
      goal: "engagement",
    });
  }
  if (!ctx.upcoming.length) {
    signals.push({
      source: "gap",
      headline: "Nothing scheduled for the next two weeks",
      detail: "Queue a few pieces now so the calendar isn't empty.",
      weight: 64,
      suggestedType: "carousel",
    });
  }
  const neglected: StudioType[] = (["article", "video", "carousel"] as StudioType[]).filter(
    (t) => !recentTypes.get(t) && !recentTypes.get(STUDIO_FORMATS[t].kind),
  );
  for (const t of neglected.slice(0, 2)) {
    signals.push({
      source: "gap",
      headline: `No ${STUDIO_FORMATS[t].noun}s recently`,
      detail:
        t === "article"
          ? "Long-form builds search and AI-answer visibility that posts can't."
          : t === "video"
            ? "Short video reaches people your static posts don't."
            : "Carousels earn saves — the strongest signal for reach.",
      weight: 55,
      suggestedType: t,
    });
  }

  // Brand pillars.
  const customer = (brand?.customer ?? {}) as Record<string, unknown>;
  const pains = text(customer.painPoints, 220);
  const objections = text(customer.objections, 220);
  const jobs = text(customer.jobsToBeDone, 220);
  const products = text(brand?.products, 220);
  if (pains) {
    signals.push({
      source: "pillar",
      headline: `Pain point: ${firstClause(pains).slice(0, 70)}`,
      detail: pains,
      weight: 62,
      goal: "education",
    });
  }
  if (objections) {
    signals.push({
      source: "pillar",
      headline: `Objection: ${firstClause(objections).slice(0, 70)}`,
      detail: objections,
      weight: 58,
      goal: "leads",
    });
  }
  if (jobs) {
    signals.push({
      source: "pillar",
      headline: `Job to be done: ${firstClause(jobs).slice(0, 70)}`,
      detail: jobs,
      weight: 52,
      goal: "education",
    });
  }
  if (products) {
    signals.push({
      source: "pillar",
      headline: `Offer: ${firstClause(products).slice(0, 70)}`,
      detail: products,
      weight: 50,
      suggestedType: "image",
      goal: "offer",
    });
  }

  return signals.sort((a, b) => b.weight - a.weight);
}

/* ───────────────────────── Dedupe ───────────────────────── */

const STOP = new Set(
  "a an the and or for to of in on with your our you we how why what is are be this that it from about into at by new post".split(
    " ",
  ),
);

export function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function ideaId(type: StudioType, title: string): string {
  let h = 5381;
  const key = `${type}|${[...tokens(title)].sort().join(" ")}`;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 33) ^ key.charCodeAt(i)) >>> 0;
  return `idea-${h.toString(36)}`;
}

/** Drop ideas that repeat recent work, dismissed ideas, or each other. */
export function dedupeIdeas(ideas: StudioIdea[], avoid: string[], threshold = 0.45): StudioIdea[] {
  const kept: StudioIdea[] = [];
  for (const idea of ideas) {
    if (avoid.some((t) => similarity(idea.title, t) >= threshold)) continue;
    if (kept.some((k) => similarity(idea.title, k.title) >= threshold)) continue;
    kept.push(idea);
  }
  return kept;
}

/* ───────────────────────── Fallback ───────────────────────── */

function platformsFor(type: StudioType): PlatformId[] {
  return STUDIO_FORMATS[type].defaultPlatforms;
}

function typeFor(signal: IdeaSignal, only?: StudioType, index = 0): StudioType {
  if (only) return only;
  if (signal.suggestedType) return signal.suggestedType;
  return (["social", "carousel", "image", "article", "script"] as StudioType[])[index % 5];
}

const FRAMES: Record<
  StudioType,
  (topic: string, brand: string) => { title: string; brief: string }
> = {
  social: (topic, brand) => ({
    title: `${brand}'s take: ${topic}`,
    brief: `Write a post that gives ${brand}'s specific point of view on ${topic}. Open with a sharp observation, back it with one concrete example, and end with a question the audience will want to answer.`,
  }),
  carousel: (topic, brand) => ({
    title: `A 6-slide playbook on ${topic}`,
    brief: `Turn ${topic} into a practical carousel from ${brand}: a cover that promises a clear outcome, one step per slide, and a closing slide with a next step.`,
  }),
  image: (topic, brand) => ({
    title: `Visual moment: ${topic}`,
    brief: `One striking visual that captures ${topic} in ${brand}'s world — the scene, the feeling, and a short caption that makes the point.`,
  }),
  ad: (topic, brand) => ({
    title: `Ad test: ${topic}`,
    brief: `Paid-social ad variants for ${brand} built around ${topic}. Test an outcome angle, a pain angle, and a proof angle with one clear CTA.`,
  }),
  video: (topic, brand) => ({
    title: `Short video: ${topic}`,
    brief: `A short, visual clip showing ${topic} the way ${brand} sees it — a strong first frame, one key moment, a clean ending.`,
  }),
  script: (topic, brand) => ({
    title: `30-second Reel: ${topic}`,
    brief: `A short-form script where ${brand} lands one idea about ${topic}: a 2-second hook, three quick beats, and a CTA.`,
  }),
  article: (topic, brand) => ({
    title: `The practical guide to ${topic}`,
    brief: `An article from ${brand} that answers the question people actually ask about ${topic}, with a direct answer up top, clear sections, and a next step.`,
  }),
};

function topicFrom(signal: IdeaSignal): string {
  const raw = signal.headline
    .replace(/^(Pain point|Objection|Job to be done|Offer|Rising):\s*/i, "")
    .replace(/ is (today|in \d+ days?)$/i, "")
    .replace(/^Searches for "(.+)" are rising$/i, "$1")
    .trim();
  return raw.charAt(0).toLowerCase() + raw.slice(1);
}

/** Deterministic ideas used when the model pass is unavailable. */
export function fallbackIdeas(
  signals: IdeaSignal[],
  ctx: StudioContext,
  opts: { only?: StudioType; limit?: number } = {},
): StudioIdea[] {
  const brand = ctx.brandName || "your brand";
  const usable = signals.filter((s) => s.source !== "gap" && s.source !== "momentum");
  const base = usable.length ? usable : signals;
  const ideas: StudioIdea[] = base.slice(0, (opts.limit ?? 5) + 2).map((signal, i) => {
    const type = typeFor(signal, opts.only, i);
    const topic = topicFrom(signal) || "what your customers care about most";
    const frame = FRAMES[type](topic, brand);
    return {
      id: ideaId(type, frame.title),
      type,
      title: frame.title.slice(0, 90),
      why: signal.detail.slice(0, 120),
      brief: frame.brief,
      platforms: platformsFor(type),
      goal: signal.goal,
      source: signal.source,
    };
  });
  return ideas.slice(0, opts.limit ?? 5);
}

export function sanitizeIdea(
  raw: Partial<StudioIdea> & { type?: string },
  only?: StudioType,
): StudioIdea | null {
  const type = (only ?? raw.type) as StudioType;
  if (!STUDIO_TYPE_ORDER.includes(type)) return null;
  const title = text(raw.title, 90);
  const brief = text(raw.brief, 900);
  if (title.length < 6 || brief.length < 20) return null;
  const allowed = STUDIO_FORMATS[type].platforms;
  const platforms = (raw.platforms ?? []).filter((p): p is PlatformId =>
    allowed.includes(p as PlatformId),
  );
  const sources: IdeaSource[] = ["season", "trend", "competitor", "gap", "pillar", "momentum"];
  return {
    id: ideaId(type, title),
    type,
    title,
    why: text(raw.why, 140),
    brief,
    platforms: platforms.length
      ? platforms.slice(0, STUDIO_FORMATS[type].multiPlatform ? 4 : 1)
      : STUDIO_FORMATS[type].defaultPlatforms,
    goal: raw.goal,
    source: sources.includes(raw.source as IdeaSource) ? (raw.source as IdeaSource) : "pillar",
  };
}
