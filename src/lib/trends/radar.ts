// radar.ts — the Trend Radar's pure rules (ADR-0052). Browser-safe.
//
// Mellox staff post a trend (a game launch, a match, a viral format) from
// the admin console with a brief, what to make, what never to do and
// reference media. A trend is for every brand ("all"), for named industries
// or brands ("specific"), or a micro trend that only reaches its industries
// ("micro"). Generators get a matching trend only through `radarBlock`, and
// always make it in the brand's own style and world.
import type { IndustryId } from "@/lib/studio/knowledge/industries";

export const RADAR_SCOPES = ["all", "specific", "micro"] as const;
export type RadarScope = (typeof RADAR_SCOPES)[number];

export const RADAR_STATUSES = ["draft", "live", "archived"] as const;
export type RadarStatus = (typeof RADAR_STATUSES)[number];

export type RadarMedia = {
  path: string;
  kind: "image" | "video";
  caption?: string | null;
  /** Video: stills cut from it (paths), so writers can see it. */
  stills?: string[];
};

export type RadarTrend = {
  id: string;
  title: string;
  /** What is happening and why people care (staff-written). */
  brief: string;
  /** Kinds of posts brands should make from it. */
  whatToMake: string;
  /** What never to do (legal, taste, sensitivity). */
  doNots: string;
  scope: RadarScope;
  industries: string[];
  workspaceIds: string[];
  /** Content languages it suits (labels, as dna.look.writing.language); empty = any. */
  languages: string[];
  /** Platforms it suits; empty = any. */
  platforms: string[];
  /** Hashtags or keywords people use for it. */
  tags: string[];
  links: string[];
  media: RadarMedia[];
  /** Reference stills may be attached to a render as mood only. */
  allowMood: boolean;
  startsAt: string;
  endsAt: string | null;
  status: RadarStatus;
  /** Higher shows first (1-5). */
  priority: number;
};

export type RadarAudience = {
  workspaceId: string;
  industryId: IndustryId | null;
  /** The brand's content language label (e.g. "English"). */
  language?: string | null;
  today?: Date;
};

/** A trend is live for this moment: published and inside its window. */
export function isLive(
  trend: Pick<RadarTrend, "status" | "startsAt" | "endsAt">,
  now = new Date(),
): boolean {
  if (trend.status !== "live") return false;
  const start = Date.parse(trend.startsAt);
  if (Number.isFinite(start) && start > now.getTime()) return false;
  if (trend.endsAt) {
    const end = Date.parse(trend.endsAt);
    if (Number.isFinite(end) && end <= now.getTime()) return false;
  }
  return true;
}

/** Does this trend reach this brand? */
export function reaches(trend: RadarTrend, who: RadarAudience): boolean {
  if (!isLive(trend, who.today)) return false;
  if (trend.languages.length && who.language) {
    const lang = who.language.trim().toLowerCase();
    if (!trend.languages.some((l) => l.trim().toLowerCase() === lang)) return false;
  }
  const industryHit = !!who.industryId && trend.industries.includes(who.industryId);
  switch (trend.scope) {
    case "all":
      return true;
    case "specific":
      return trend.workspaceIds.includes(who.workspaceId) || industryHit;
    case "micro":
      return industryHit || trend.workspaceIds.includes(who.workspaceId);
  }
}

/** The trends that reach this brand, strongest and newest first. */
export function trendsForWorkspace(
  trends: readonly RadarTrend[],
  who: RadarAudience,
  limit = 6,
): RadarTrend[] {
  return trends
    .filter((t) => reaches(t, who))
    .sort((a, b) => {
      const fit = (t: RadarTrend) =>
        (t.workspaceIds.includes(who.workspaceId) ? 2 : 0) +
        (who.industryId && t.industries.includes(who.industryId) ? 1 : 0);
      return (
        b.priority - a.priority ||
        fit(b) - fit(a) ||
        Date.parse(b.startsAt) - Date.parse(a.startsAt)
      );
    })
    .slice(0, limit);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 1 || /\d/.test(w));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "launch",
  "day",
  "new",
  "trend",
  "of",
  "a",
  "is",
]);

/**
 * The trend this brief is about: the one a person picked (`trendId`), else a
 * live trend whose title or tags the brief names. Pure string work.
 */
export function radarForBrief(
  trends: readonly RadarTrend[] | null | undefined,
  brief: string,
  trendId?: string | null,
): RadarTrend | null {
  if (!trends?.length) return null;
  if (trendId) return trends.find((t) => t.id === trendId) ?? null;
  const text = ` ${words(brief).join(" ")} `;
  let best: { trend: RadarTrend; hits: number } | null = null;
  for (const trend of trends) {
    const keys = [
      words(trend.title)
        .filter((w) => !STOP.has(w))
        .join(" "),
      ...trend.tags.map((t) => words(t).join(" ")),
    ].filter((k) => k.length >= 3);
    const hits = keys.filter((k) => text.includes(` ${k} `)).length;
    if (hits && (!best || hits > best.hits)) best = { trend, hits };
  }
  return best?.trend ?? null;
}

/** The rules every trend post follows, whatever the trend. */
export const RADAR_RULES: readonly string[] = [
  "Make it in this brand's own style, colours and world, about what this brand really sells: the trend is the moment, the brand is the hero.",
  "Reference the moment with wit; never use the trend owner's logos, characters, artwork, screenshots, music or exact title treatment, and never suggest a partnership or endorsement.",
  "Only facts the trend brief or the brand states (dates, prices, offers); never invent them.",
];

/** The block a generator gets for one trend (wrapped as untrusted by the caller). */
export function radarBlock(trend: RadarTrend): string {
  return [
    `Trend: ${trend.title}`,
    trend.brief && `What is happening: ${trend.brief}`,
    trend.whatToMake && `What brands are making: ${trend.whatToMake}`,
    trend.doNots && `Never: ${trend.doNots}`,
    trend.tags.length ? `People use: ${trend.tags.slice(0, 8).join(", ")}` : "",
    ...RADAR_RULES,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2200);
}

/** Short lines for idea writers: every trend that reaches the brand. */
export function radarLines(trends: readonly RadarTrend[], limit = 4): string {
  return trends
    .slice(0, limit)
    .map(
      (t) =>
        `- ${t.title}: ${t.brief.slice(0, 220)}${t.whatToMake ? ` (make: ${t.whatToMake.slice(0, 160)})` : ""}`,
    )
    .join("\n");
}

/** A row from platform_trends (snake_case) as a RadarTrend. Never throws. */
export function radarFromRow(row: Record<string, unknown>): RadarTrend | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const id = str(row.id);
  const title = str(row.title).trim();
  if (!id || !title) return null;
  const scope = (RADAR_SCOPES as readonly string[]).includes(str(row.scope))
    ? (row.scope as RadarScope)
    : "all";
  const status = (RADAR_STATUSES as readonly string[]).includes(str(row.status))
    ? (row.status as RadarStatus)
    : "draft";
  const media = (Array.isArray(row.media) ? row.media : [])
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m?.path === "string")
    .map((m) => ({
      path: m.path as string,
      kind: m.kind === "video" ? ("video" as const) : ("image" as const),
      caption: typeof m.caption === "string" ? m.caption : null,
      stills: list(m.stills),
    }));
  return {
    id,
    title,
    brief: str(row.brief),
    whatToMake: str(row.what_to_make),
    doNots: str(row.do_nots),
    scope,
    industries: list(row.industries),
    workspaceIds: list(row.workspace_ids),
    languages: list(row.languages),
    platforms: list(row.platforms),
    tags: list(row.tags),
    links: list(row.links),
    media,
    allowMood: row.allow_mood === true,
    startsAt: str(row.starts_at) || new Date(0).toISOString(),
    endsAt: str(row.ends_at) || null,
    status,
    priority: Math.max(1, Math.min(5, Number(row.priority) || 3)),
  };
}
