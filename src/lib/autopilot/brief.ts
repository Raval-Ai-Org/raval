// The brief a piece is made from. Before anything is written, the plan decides
// what the four brains say about this piece: which group of customers it is
// for (Audience), what is happening around the brand (Market), who it has to
// stand apart from (Competitors), and what the brand itself can truthfully
// say (Brand DNA, always). Studio then writes to that brief.
//
// The model proposes, pure code decides: the plan may only point at numbered
// entries it was shown, and the words always come from the stored record. A
// number that is not on the list is dropped, so a group, a rival or a market
// signal can never be invented here.
// Pure and browser-safe.
import { aimLine, shareAim } from "@/lib/studio/viral";

export type BrainEntry = { name: string; detail: string };

/** What the brains hold for a workspace, as numbered lists the plan can point at. */
export type BrainLists = {
  audience: BrainEntry[];
  competitors: BrainEntry[];
  market: BrainEntry[];
  trends: BrainEntry[];
};

export const EMPTY_BRAINS: BrainLists = { audience: [], competitors: [], market: [], trends: [] };

/** What the plan proposed for one piece: list numbers, plus two short ideas. */
export type BrainPicks = {
  audience?: unknown;
  competitor?: unknown;
  market?: unknown;
  trend?: unknown;
  hook?: unknown;
  visual?: unknown;
};

/** What a piece is built from, in stored words. Saved with the piece. */
export type BrainUse = {
  audience?: BrainEntry;
  competitor?: BrainEntry;
  market?: BrainEntry;
  trend?: BrainEntry;
  /** The opening idea, one line. */
  hook?: string;
  /** What the picture, slides or video show. */
  visual?: string;
};

function entry(list: readonly BrainEntry[], index: unknown): BrainEntry | undefined {
  return typeof index === "number" && Number.isInteger(index) && index >= 0
    ? list[index]
    : undefined;
}

function line(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ").slice(0, max);
  return text.length >= 8 ? text : undefined;
}

/**
 * Turn the plan's picks into what the piece is really built from. `turn` is
 * the piece's place in the week: when the brand has customer groups and the
 * plan named none, the piece is given one in rotation, so nothing is ever
 * written for "everyone".
 */
export function groundPicks(picks: BrainPicks | undefined, lists: BrainLists, turn = 0): BrainUse {
  const raw = picks ?? {};
  const audience =
    entry(lists.audience, raw.audience) ??
    (lists.audience.length ? lists.audience[turn % lists.audience.length] : undefined);
  const use: BrainUse = {
    audience,
    competitor: entry(lists.competitors, raw.competitor),
    market: entry(lists.market, raw.market),
    trend: entry(lists.trends, raw.trend),
    hook: line(raw.hook, 160),
    visual: line(raw.visual, 240),
  };
  for (const key of Object.keys(use) as (keyof BrainUse)[]) {
    if (use[key] === undefined) delete use[key];
  }
  return use;
}

/** Read a stored `BrainUse` back, trusting nothing about its shape. */
export function readBrainUse(value: unknown): BrainUse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const one = (v: unknown): BrainEntry | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const e = v as Record<string, unknown>;
    return typeof e.name === "string" && e.name.trim()
      ? { name: e.name, detail: typeof e.detail === "string" ? e.detail : "" }
      : undefined;
  };
  const use: BrainUse = {
    audience: one(row.audience),
    competitor: one(row.competitor),
    market: one(row.market),
    trend: one(row.trend),
    hook: line(row.hook, 160),
    visual: line(row.visual, 240),
  };
  for (const key of Object.keys(use) as (keyof BrainUse)[]) {
    if (use[key] === undefined) delete use[key];
  }
  return use;
}

const withDetail = (e: BrainEntry) =>
  e.detail ? `${e.name}. ${e.detail.replace(/[.\s]+$/, "")}.` : `${e.name}.`;

/**
 * The brief Studio writes from. The title and the idea come first; then what
 * each brain adds, one labelled line each, so the writer knows who it is for
 * and what it has to do before choosing a word.
 */
export function creativeBrief(args: {
  title: string;
  brief: string;
  aim?: unknown;
  pillar?: unknown;
  use: BrainUse;
  maxChars?: number;
}): string {
  const { use } = args;
  const parts = [
    args.title.trim(),
    args.brief.trim(),
    use.hook &&
      `Opening idea: the cover, the first frame or the first line carries this point, in the style the Opening section gives: ${use.hook}`,
    use.visual &&
      `What is shown (the subject only; colours, type and logo follow the brand's look): ${use.visual}`,
    use.audience &&
      `Written for one group of customers: ${withDetail(use.audience)} Speak to their situation in their words; everyone else is a bonus.`,
    typeof args.pillar === "string" && args.pillar.trim() && `Brand theme: ${args.pillar.trim()}`,
    use.market &&
      `What is happening in the market (context, not a claim to repeat): ${withDetail(use.market)}`,
    use.competitor &&
      `Stand apart from this rival's position, without ever naming them: ${withDetail(use.competitor)}`,
    use.trend &&
      `A format that is working now; use it only if it fits naturally: ${withDetail(use.trend)}`,
    aimLine(shareAim(args.aim)),
    "Facts come only from the brand context. Never invent a figure, a customer or a result.",
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.join("\n\n").slice(0, args.maxChars ?? 3_900);
}

/** What a piece was built from, as short labels a person can read at a glance. */
export function brainLabels(use: BrainUse): string[] {
  return [
    "Brand DNA",
    use.audience && `For: ${use.audience.name}`,
    use.market && `Market: ${use.market.name}`,
    use.competitor && `Stands apart from: ${use.competitor.name}`,
    use.trend && `Format: ${use.trend.name}`,
  ].filter((l): l is string => typeof l === "string");
}

/**
 * Keep only the sentences whose facts are known. The plan writes freely, and
 * sometimes a figure slips in that the brand never gave ("the first 40 words",
 * "3x more leads"). A sentence carrying one is left out before the brief
 * reaches a writer, so the figure can't be repeated as if it were true.
 * `known` is the caller's grounding check for one sentence.
 */
export function withoutUnknownFacts(
  text: string,
  known: (sentence: string) => boolean,
): { text: string; removed: number } {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const kept = sentences.filter((s) => !s.trim() || known(s.trim()));
  return {
    text: kept.join("").trim(),
    removed: sentences.length - kept.length,
  };
}
