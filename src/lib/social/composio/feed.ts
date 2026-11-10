// What a Composio-connected social account has posted, with the network's own
// numbers (ADR-0042, Phase 2). Pure: builds the read tools' arguments and
// turns their results into feed entries for social_account_posts, in the
// shape `normalizeFeedMetrics` already knows per network — so Analytics →
// Social counts these accounts exactly like Post for Me's.
//
// A number a network doesn't report is left out, never 0. LinkedIn is not
// read: its API doesn't let an app list a member's own posts.
import type { FeedEntry } from "@/lib/postforme/feeds";
import type { ComposioSocialPlatform } from "./requests";

/** Posts read per account per sync. */
export const COMPOSIO_FEED_LIMIT = 50;
/** The newest posts that also get a per-post insights read (views, reach). */
export const COMPOSIO_INSIGHTS_PER_SYNC = 10;

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** A count the network reported (Google sends numbers as strings); undefined otherwise. */
function count(v: unknown): number | undefined {
  const n = typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

const https = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\//.test(s) && s.length <= 2000 ? s : null;
};

/** The first array at data, data.data, items, data.items. */
function list(data: unknown): Obj[] {
  const top = obj(data);
  const inner = obj(top?.data);
  const candidates = [data, top?.data, top?.items, inner?.data, inner?.items, top?.results];
  const found = candidates.find((c) => Array.isArray(c)) as unknown[] | undefined;
  return (found ?? []).map(obj).filter((x): x is Obj => x !== null);
}

/** Drop undefined so a missing number stays missing. */
function defined(m: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
  return out;
}

/** Networks whose posts Mellox can read back through Composio. */
export const FEED_PLATFORMS = ["instagram", "facebook", "youtube", "pinterest"] as const;
export type FeedPlatform = (typeof FEED_PLATFORMS)[number];

export function isFeedPlatform(p: string): p is FeedPlatform {
  return (FEED_PLATFORMS as readonly string[]).includes(p);
}

/** The list tool and its arguments for one destination. Every slug is a catalog read tool. */
export function feedListCall(
  platform: FeedPlatform,
  destination: string,
): { tool: string; args: Obj } {
  switch (platform) {
    case "instagram":
      return {
        tool: "INSTAGRAM_GET_IG_USER_MEDIA",
        args: {
          ig_user_id: destination,
          limit: COMPOSIO_FEED_LIMIT,
          fields:
            "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
        },
      };
    case "facebook":
      return {
        tool: "FACEBOOK_GET_PAGE_POSTS",
        args: {
          page_id: destination,
          limit: COMPOSIO_FEED_LIMIT,
          fields:
            "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{media_type}",
        },
      };
    case "youtube":
      return {
        tool: "YOUTUBE_LIST_CHANNEL_VIDEOS",
        args: { channelId: destination, part: "snippet", maxResults: COMPOSIO_FEED_LIMIT },
      };
    case "pinterest":
      return {
        tool: "PINTEREST_LIST_PINS",
        args: { board_id: destination, page_size: COMPOSIO_FEED_LIMIT, include_metrics: true },
      };
  }
}

/** The posts in a list tool's result. */
export function readFeed(platform: FeedPlatform, data: unknown): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const item of list(data)) {
    switch (platform) {
      case "instagram": {
        const id = str(item.id);
        if (!id) break;
        const type = String(item.media_type ?? "").toLowerCase();
        const picture = https(item.thumbnail_url) ?? https(item.media_url);
        out.push({
          platform: "instagram",
          platform_post_id: id,
          platform_url: https(item.permalink) ?? undefined,
          caption: str(item.caption) ?? "",
          media: [
            {
              type: type.includes("video") || type.includes("reel") ? "video" : "image",
              ...(picture ? { thumbnail_url: picture } : {}),
            },
          ],
          metrics: defined({ likes: count(item.like_count), comments: count(item.comments_count) }),
          posted_at: str(item.timestamp) ?? undefined,
        });
        break;
      }
      case "facebook": {
        const id = str(item.id);
        if (!id) break;
        const attachment = list(item.attachments)[0];
        const type = String(attachment?.media_type ?? "").toLowerCase();
        const picture = https(item.full_picture);
        out.push({
          platform: "facebook",
          platform_post_id: id,
          platform_url: https(item.permalink_url) ?? undefined,
          caption: str(item.message) ?? "",
          media:
            picture || type
              ? [{ type: type || "photo", ...(picture ? { thumbnail_url: picture } : {}) }]
              : [],
          metrics: defined({
            reactions_total: count(obj(obj(item.reactions)?.summary)?.total_count),
            comments: count(obj(obj(item.comments)?.summary)?.total_count),
            shares: count(obj(item.shares)?.count),
          }),
          posted_at: str(item.created_time) ?? undefined,
        });
        break;
      }
      case "youtube": {
        // Channel lists answer with the video id at `id`, `id.videoId` or
        // `contentDetails.videoId`; details answer with `id`.
        const id =
          str(item.id) ??
          str(obj(item.id)?.videoId) ??
          str(obj(item.contentDetails)?.videoId) ??
          str(obj(obj(item.snippet)?.resourceId)?.videoId);
        if (!id) break;
        const snippet = obj(item.snippet);
        const thumbs = obj(snippet?.thumbnails);
        const picture =
          https(obj(thumbs?.high)?.url) ??
          https(obj(thumbs?.medium)?.url) ??
          https(obj(thumbs?.default)?.url);
        const stats = obj(item.statistics);
        out.push({
          platform: "youtube",
          platform_post_id: id,
          platform_url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
          caption: str(snippet?.title) ?? "",
          media: [{ type: "video", ...(picture ? { thumbnail_url: picture } : {}) }],
          metrics: defined({
            views: count(stats?.viewCount),
            likes: count(stats?.likeCount),
            comments: count(stats?.commentCount),
          }),
          posted_at: str(snippet?.publishedAt) ?? undefined,
        });
        break;
      }
      case "pinterest": {
        const id = str(item.id);
        if (!id) break;
        const media = obj(item.media);
        const images = obj(media?.images);
        const picture =
          https(obj(images?.["600x"])?.url) ??
          https(obj(images?.["400x300"])?.url) ??
          https(obj(images?.["150x150"])?.url) ??
          https(media?.cover_image_url);
        const metrics = obj(item.pin_metrics);
        const lifetime = obj(metrics?.lifetime_metrics) ?? obj(metrics?.all_time);
        const ninety = obj(metrics?.["90d"]);
        const source = lifetime ?? ninety;
        out.push({
          platform: "pinterest",
          platform_post_id: id,
          platform_url: `https://www.pinterest.com/pin/${encodeURIComponent(id)}/`,
          caption: str(item.title) ?? str(item.description) ?? "",
          media: [
            {
              type: String(media?.media_type ?? "image").toLowerCase(),
              ...(picture ? { thumbnail_url: picture } : {}),
            },
          ],
          metrics: source
            ? {
                lifetime_metrics: defined({
                  impression: count(source.impression),
                  save: count(source.save),
                  outbound_click: count(source.outbound_click),
                  reaction: count(source.reaction),
                  comment: count(source.comment),
                  profile_visit: count(source.profile_visit),
                }),
              }
            : {},
          posted_at: str(item.created_at) ?? undefined,
        });
        break;
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const id = e.platform_post_id as string;
    return !seen.has(id) && !!seen.add(id);
  });
}

/** The per-post insights call that adds views and reach, where the network has one. */
export function insightsCall(
  platform: FeedPlatform,
  postIds: string[],
): Array<{ postId: string | null; tool: string; args: Obj }> {
  const ids = postIds.slice(0, COMPOSIO_INSIGHTS_PER_SYNC);
  switch (platform) {
    case "instagram":
      return ids.map((id) => ({
        postId: id,
        tool: "INSTAGRAM_GET_IG_MEDIA_INSIGHTS",
        args: { ig_media_id: id, metric: ["views", "reach", "saved", "shares"] },
      }));
    case "facebook":
      return ids.map((id) => ({
        postId: id,
        tool: "FACEBOOK_GET_POST_INSIGHTS",
        args: { post_id: id, metrics: "post_media_view,post_total_media_view_unique" },
      }));
    case "youtube":
      // One batch read gives every video's numbers.
      return postIds.length
        ? [
            {
              postId: null,
              tool: "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
              args: { id: postIds.slice(0, 50), parts: ["snippet", "statistics"] },
            },
          ]
        : [];
    case "pinterest":
      return [];
  }
}

/** Graph insights: `[{ name, values: [{ value }] }]` or `total_value`. */
function graphInsights(data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of list(data)) {
    const name = str(row.name);
    if (!name) continue;
    const values = Array.isArray(row.values) ? row.values : [];
    const value =
      count(obj(values[0])?.value) ?? count(obj(row.total_value)?.value) ?? count(row.value);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Merge one insights result into the feed entries. Returns the entries with
 * the extra numbers; an unreadable result changes nothing.
 */
export function mergeInsights(
  platform: FeedPlatform,
  entries: FeedEntry[],
  call: { postId: string | null },
  data: unknown,
): FeedEntry[] {
  if (platform === "youtube") {
    const byId = new Map(readFeed("youtube", data).map((e) => [e.platform_post_id, e]));
    return entries.map((e) => {
      const detail = byId.get(e.platform_post_id);
      return detail
        ? { ...e, metrics: { ...(obj(e.metrics) ?? {}), ...(obj(detail.metrics) ?? {}) } }
        : e;
    });
  }
  const found = graphInsights(data);
  if (!Object.keys(found).length) return entries;
  const extra =
    platform === "instagram"
      ? defined({
          views: found.views ?? found.plays,
          reach: found.reach,
          saved: found.saved,
          shares: found.shares,
        })
      : defined({
          media_views: found.post_media_view,
          reach: found.post_total_media_view_unique,
        });
  return entries.map((e) =>
    e.platform_post_id === call.postId
      ? { ...e, metrics: { ...(obj(e.metrics) ?? {}), ...extra } }
      : e,
  );
}

/** Narrow a publishing platform to one Mellox can read back. */
export function feedPlatformOf(platform: ComposioSocialPlatform | string): FeedPlatform | null {
  return isFeedPlatform(platform) ? platform : null;
}
