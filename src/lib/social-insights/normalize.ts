// normalize.ts — one shape for the numbers every network reports through
// Post for Me's account feed (expand=metrics). Pure and browser-safe.
//
// A number the network doesn't report is left out, never set to 0: Bluesky
// has no views, consumer TikTok has no reach, LinkedIn only reports company
// pages. The report then says "not reported" instead of showing a false zero.

export const SOCIAL_METRIC_KEYS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "profileVisits",
  "follows",
  "linkClicks",
  "watchSeconds",
] as const;

export type SocialMetricKey = (typeof SOCIAL_METRIC_KEYS)[number];

export type SocialMetrics = Partial<Record<SocialMetricKey, number>>;

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

function num(raw: Raw | undefined, ...keys: string[]): number | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

/** Sum of the parts that were reported; undefined when none was. */
function sum(...values: Array<number | undefined>): number | undefined {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length ? known.reduce((a, b) => a + b, 0) : undefined;
}

/** Post for Me's platform names → Mellox's distribution platform names. */
export function platformFromFeed(platform: string): string {
  const p = platform.toLowerCase();
  if (p === "x") return "twitter";
  if (p === "tiktok_business") return "tiktok";
  return p;
}

function clean(m: SocialMetrics): SocialMetrics {
  const out: SocialMetrics = {};
  for (const key of SOCIAL_METRIC_KEYS) {
    const v = m[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = Math.round(v);
  }
  return out;
}

/** The feed entry's raw metrics → SocialMetrics, by the network's own field names. */
export function normalizeFeedMetrics(platform: string, metrics: unknown): SocialMetrics {
  if (!isRaw(metrics)) return {};
  const m = metrics;
  switch (platform.toLowerCase()) {
    case "instagram":
      return clean({
        views: num(m, "views"),
        reach: num(m, "reach"),
        likes: num(m, "likes"),
        comments: num(m, "comments"),
        shares: num(m, "shares"),
        saves: num(m, "saved", "saves"),
        profileVisits: num(m, "profile_visits"),
        follows: num(m, "follows"),
        watchSeconds: msToSec(num(m, "ig_reels_video_view_total_time")),
      });
    case "facebook":
      return clean({
        views: num(m, "media_views", "video_views"),
        reach: num(m, "reach"),
        likes: num(m, "reactions_total", "reactions_like"),
        comments: num(m, "comments"),
        shares: num(m, "shares"),
        watchSeconds: msToSec(num(m, "video_view_time")),
      });
    case "tiktok_business":
      return clean({
        views: num(m, "video_views"),
        reach: num(m, "reach"),
        likes: num(m, "likes"),
        comments: num(m, "comments"),
        shares: num(m, "shares"),
        saves: num(m, "favorites"),
        profileVisits: num(m, "profile_views"),
        follows: num(m, "new_followers"),
        linkClicks: num(m, "website_clicks"),
        watchSeconds: num(m, "total_time_watched"),
      });
    case "tiktok":
      // Consumer TikTok; a business account may still answer in the business shape.
      if ("video_views" in m) return normalizeFeedMetrics("tiktok_business", m);
      return clean({
        views: num(m, "view_count"),
        likes: num(m, "like_count"),
        comments: num(m, "comment_count"),
        shares: num(m, "share_count"),
      });
    case "youtube":
      return clean({
        views: num(m, "views"),
        likes: num(m, "likes"),
        comments: num(m, "comments"),
        shares: num(m, "shares"),
        follows: num(m, "subscribersGained"),
        watchSeconds: minToSec(num(m, "estimatedMinutesWatched")),
      });
    case "x":
    case "twitter": {
      const pub = isRaw(m.public_metrics) ? m.public_metrics : undefined;
      const priv = isRaw(m.non_public_metrics) ? m.non_public_metrics : undefined;
      const org = isRaw(m.organic_metrics) ? m.organic_metrics : undefined;
      return clean({
        views: num(pub, "impression_count") ?? num(org, "impression_count"),
        likes: num(pub, "like_count") ?? num(org, "like_count"),
        comments: num(pub, "reply_count") ?? num(org, "reply_count"),
        shares: sum(
          num(pub, "retweet_count") ?? num(org, "retweet_count"),
          num(pub, "quote_count"),
        ),
        saves: num(pub, "bookmark_count"),
        profileVisits: num(priv, "user_profile_clicks") ?? num(org, "user_profile_clicks"),
        linkClicks: num(priv, "url_link_clicks") ?? num(org, "url_link_clicks"),
      });
    }
    case "threads":
      return clean({
        views: num(m, "views"),
        likes: num(m, "likes"),
        comments: num(m, "replies"),
        shares: sum(num(m, "reposts"), num(m, "quotes"), num(m, "shares")),
      });
    case "linkedin":
      return clean({
        views: num(m, "impressionCount", "videoView"),
        reach: num(m, "viewer"),
        likes: num(m, "likeCount"),
        comments: num(m, "commentCount"),
        shares: num(m, "shareCount"),
        linkClicks: num(m, "clickCount"),
        watchSeconds: msToSec(num(m, "timeWatched")),
      });
    case "bluesky":
      return clean({
        likes: num(m, "likeCount"),
        comments: num(m, "replyCount"),
        shares: sum(num(m, "repostCount"), num(m, "quoteCount")),
      });
    case "pinterest": {
      const life = isRaw(m.lifetime_metrics) ? m.lifetime_metrics : undefined;
      return clean({
        views: num(life, "impression"),
        likes: num(life, "reaction"),
        comments: num(life, "comment"),
        saves: num(life, "save"),
        profileVisits: num(life, "profile_visit"),
        follows: num(life, "user_follow"),
        linkClicks: num(life, "outbound_click"),
        watchSeconds: msToSec(num(life, "video_total_time")),
      });
    }
    default:
      return clean({
        views: num(m, "views", "view_count", "impressions"),
        reach: num(m, "reach"),
        likes: num(m, "likes", "like_count"),
        comments: num(m, "comments", "comment_count"),
        shares: num(m, "shares", "share_count"),
        saves: num(m, "saves", "saved"),
      });
  }
}

function msToSec(v: number | undefined): number | undefined {
  return v === undefined ? undefined : v / 1000;
}

function minToSec(v: number | undefined): number | undefined {
  return v === undefined ? undefined : v * 60;
}

/** Likes + comments + shares + saves, from what was reported. */
export function engagementOf(m: SocialMetrics): number | undefined {
  return sum(m.likes, m.comments, m.shares, m.saves);
}

/** Video, image, text or unknown — from the feed entry's media, defensively. */
export function feedFormat(media: unknown): "video" | "image" | "text" | "post" {
  const items = flatMedia(media);
  if (!Array.isArray(media)) return "post";
  if (!items.length) return "text";
  const isVideo = (it: Raw) =>
    String(it.type ?? it.media_type ?? "")
      .toLowerCase()
      .includes("video") || /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(String(it.url ?? ""));
  return items.some(isVideo) ? "video" : "image";
}

/** A picture to show next to the post, if the feed gave one. */
export function feedThumbnail(media: unknown): string | null {
  for (const it of flatMedia(media)) {
    for (const key of ["thumbnail_url", "thumbnail", "preview_url", "url"]) {
      const v = it[key];
      if (typeof v === "string" && /^https:\/\//.test(v) && v.length <= 2000) {
        if (key === "url" && /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(v)) continue;
        return v;
      }
    }
  }
  return null;
}

function flatMedia(media: unknown): Raw[] {
  if (!Array.isArray(media)) return [];
  return media.flat(2).filter(isRaw);
}
