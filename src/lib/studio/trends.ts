// Social trends: what is working on each platform this month, read from recent
// published coverage (src/server/studio/social-trends.server.ts collects it on a
// schedule and stores one shared snapshot). This module is the pure half: the
// shape, the grounding rule, and how a trend reaches a prompt.
//
// Grounding: a trend is kept only if it points at a source the search really
// returned. A model never adds a trend of its own. Browser-safe.
import type { PlatformId } from "@/lib/social-platforms";

export const TREND_KINDS = ["format", "hook", "topic", "style"] as const;
export type TrendKind = (typeof TREND_KINDS)[number];

export type SocialTrend = {
  platform: PlatformId | "all";
  kind: TrendKind;
  title: string;
  /** What it is and how a brand can use it, in one or two sentences. */
  detail: string;
  /** The source it came from. */
  url: string;
};

export type SocialTrends = {
  collectedAt: string;
  items: SocialTrend[];
};

const PLATFORM_IDS: readonly string[] = [
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
];

/** After this many days a snapshot is too old to call current. */
export const TREND_MAX_AGE_DAYS = 21;

export function trendsAreFresh(
  trends: Pick<SocialTrends, "collectedAt"> | null | undefined,
  now = new Date(),
): boolean {
  const at = Date.parse(trends?.collectedAt ?? "");
  return Number.isFinite(at) && now.getTime() - at <= TREND_MAX_AGE_DAYS * 86_400_000;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Keep only trends that cite a supplied source by its number. `sources` is the
 * list the model was shown; the URL always comes from there, never from the model.
 */
export function groundTrends(raw: unknown, sources: readonly { url: string }[]): SocialTrend[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: SocialTrend[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const index = Number(row.source);
    const source = Number.isInteger(index) ? sources[index - 1] : undefined;
    if (!source?.url) continue;
    const title = text(row.title, 90);
    const detail = text(row.detail, 280);
    if (title.length < 6 || detail.length < 20) continue;
    const platformRaw = text(row.platform, 20).toLowerCase();
    const platform = (
      platformRaw === "x" ? "twitter" : PLATFORM_IDS.includes(platformRaw) ? platformRaw : "all"
    ) as SocialTrend["platform"];
    const kind = TREND_KINDS.find((k) => k === row.kind) ?? "format";
    const key = `${platform}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform, kind, title, detail, url: source.url });
    if (out.length >= 40) break;
  }
  return out;
}

/** The trends that matter for these platforms, platform-specific ones first. */
export function trendsFor(
  trends: SocialTrends | null | undefined,
  platforms: readonly PlatformId[],
  limit = 6,
): SocialTrend[] {
  if (!trends || !trendsAreFresh(trends)) return [];
  const wanted = new Set<string>(platforms);
  const own = trends.items.filter((t) => wanted.has(t.platform));
  const general = trends.items.filter((t) => t.platform === "all");
  // Spread across the requested platforms rather than taking six for one.
  const picked: SocialTrend[] = [];
  const perPlatform = Math.max(1, Math.floor((limit - 2) / Math.max(1, wanted.size)));
  for (const id of platforms)
    picked.push(...own.filter((t) => t.platform === id).slice(0, perPlatform));
  for (const t of [...general, ...own]) {
    if (picked.length >= limit) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.slice(0, limit);
}

export const TRENDS_RULE =
  "Use what fits this brand and this brief to shape the format, the opening and the pacing. Never write that something is trending, never name a source, and leave out any trend that would feel forced.";

/** Prompt lines for a job, or an empty string when nothing current is known. */
export function trendLines(
  trends: SocialTrends | null | undefined,
  platforms: readonly PlatformId[],
  limit = 6,
): string {
  return trendsFor(trends, platforms, limit)
    .map(
      (t) => `- [${t.platform === "all" ? "all platforms" : t.platform}] ${t.title}: ${t.detail}`,
    )
    .join("\n");
}
