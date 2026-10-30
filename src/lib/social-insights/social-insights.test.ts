import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/analytics/ranges";
import {
  engagementOf,
  feedFormat,
  feedThumbnail,
  normalizeFeedMetrics,
  platformFromFeed,
} from "./normalize";
import { buildSocialReport, MIN_POSTS_FOR_WEEKDAYS, type StoredSocialPost } from "./report";

describe("normalizeFeedMetrics", () => {
  it("reads each network by its own field names", () => {
    expect(
      normalizeFeedMetrics("instagram", {
        views: 100,
        reach: 80,
        likes: 9,
        comments: 2,
        saved: 3,
        shares: 1,
        follows: 4,
        profile_visits: 5,
      }),
    ).toEqual({
      views: 100,
      reach: 80,
      likes: 9,
      comments: 2,
      saves: 3,
      shares: 1,
      follows: 4,
      profileVisits: 5,
    });
    expect(
      normalizeFeedMetrics("x", {
        public_metrics: {
          impression_count: 500,
          like_count: 10,
          reply_count: 2,
          retweet_count: 3,
          quote_count: 1,
          bookmark_count: 4,
        },
        non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 6 },
      }),
    ).toEqual({
      views: 500,
      likes: 10,
      comments: 2,
      shares: 4,
      saves: 4,
      linkClicks: 7,
      profileVisits: 6,
    });
    expect(
      normalizeFeedMetrics("pinterest", {
        lifetime_metrics: { impression: 40, save: 3, outbound_click: 2, profile_visit: null },
      }),
    ).toEqual({ views: 40, saves: 3, linkClicks: 2 });
  });

  it("leaves out what a network doesn't report, never 0", () => {
    const bluesky = normalizeFeedMetrics("bluesky", {
      likeCount: 5,
      replyCount: 1,
      repostCount: 2,
      quoteCount: 0,
    });
    expect(bluesky.views).toBeUndefined();
    expect(bluesky).toEqual({ likes: 5, comments: 1, shares: 2 });
    expect(normalizeFeedMetrics("tiktok", { view_count: 10 })).toEqual({ views: 10 });
    expect(normalizeFeedMetrics("instagram", null)).toEqual({});
    expect(normalizeFeedMetrics("instagram", { likes: -3, views: Number.NaN })).toEqual({});
  });

  it("reads a TikTok business answer in either name", () => {
    const m = { video_views: 90, reach: 70, likes: 5, favorites: 2, website_clicks: 1 };
    expect(normalizeFeedMetrics("tiktok", m)).toEqual(normalizeFeedMetrics("tiktok_business", m));
    expect(normalizeFeedMetrics("tiktok", m).linkClicks).toBe(1);
  });

  it("maps platform names and media", () => {
    expect(platformFromFeed("x")).toBe("twitter");
    expect(platformFromFeed("tiktok_business")).toBe("tiktok");
    expect(feedFormat([])).toBe("text");
    expect(feedFormat([{ url: "https://cdn.example.com/a.mp4" }])).toBe("video");
    expect(feedFormat([[{ url: "https://cdn.example.com/a.jpg" }]])).toBe("image");
    expect(feedFormat(undefined)).toBe("post");
    expect(
      feedThumbnail([{ url: "https://cdn.example.com/a.mp4", thumbnail_url: "https://t/x.jpg" }]),
    ).toBe("https://t/x.jpg");
    expect(feedThumbnail([{ url: "http://insecure/a.jpg" }])).toBeNull();
    expect(engagementOf({})).toBeUndefined();
    expect(engagementOf({ likes: 2, saves: 1 })).toBe(3);
  });
});

describe("buildSocialReport", () => {
  const range = resolveRange({ preset: "7d" }, "2026-10-30"); // Oct 23–29 vs Oct 16–22
  const status = { state: "ready" as const, accounts: 1, reconnect: 0, lastSyncedAt: null };
  let n = 0;
  const post = (
    date: string,
    metrics: StoredSocialPost["metrics"],
    extra: Partial<StoredSocialPost> = {},
  ): StoredSocialPost => ({
    id: `p${n++}`,
    platform: "instagram",
    account: "@acme",
    url: null,
    caption: "",
    thumbnail_url: null,
    format: "image",
    posted_at: `${date}T12:00:00Z`,
    metrics,
    content_item_id: "c1",
    ...extra,
  });

  it("counts a post on the day it went out and compares with the period before", () => {
    const report = buildSocialReport({
      range,
      status,
      firstPostedDate: "2026-10-01",
      posts: [
        post("2026-10-25", { views: 1000, likes: 50, comments: 10 }),
        post("2026-10-27", { views: 500, likes: 20 }),
        post("2026-10-18", { views: 300, likes: 6 }),
        post("2026-09-01", { views: 99999 }), // outside both windows
      ],
    });
    const views = report.kpis.find((k) => k.key === "social.views")!;
    expect(views.value).toBe(1500);
    expect(views.comparison.previous).toBe(300);
    expect(views.comparison.direction).toBe("up");
    expect(report.kpis.find((k) => k.key === "social.engagementRate")!.value).toBeCloseTo(
      80 / 1500,
    );
    expect(report.kpis.find((k) => k.key === "social.posts")!.value).toBe(2);
    expect(report.series.views.find((p) => p.date === "2026-10-25")!.value).toBe(1000);
    expect(report.series.views).toHaveLength(7);
    expect(report.previousByPlatform?.[0].views).toBe(300);
  });

  it("keeps an unreported number null and refuses a comparison without history", () => {
    const report = buildSocialReport({
      range,
      status,
      firstPostedDate: "2026-10-24",
      posts: [post("2026-10-25", { likes: 3 }, { platform: "bluesky" })],
    });
    expect(report.kpis.find((k) => k.key === "social.views")!.value).toBeNull();
    expect(report.kpis.find((k) => k.key === "social.engagement")!.comparison.status).toBe(
      "insufficient_history",
    );
    expect(report.series.views.every((p) => p.value === null)).toBe(true);
    expect(report.byPlatform[0]).toMatchObject({ platform: "bluesky", views: null });
    expect(report.previousByPlatform).toBeNull();
  });

  it("shows patterns only with enough posts", () => {
    const few = buildSocialReport({
      range,
      status,
      firstPostedDate: null,
      posts: [
        post("2026-10-25", { views: 10 }),
        post("2026-10-26", { views: 10 }, { content_item_id: null }),
      ],
    });
    expect(few.weekdays).toBeNull();
    expect(few.origin).toBeNull();
    expect(few.formats[0].avgViews).toBe(10);

    const many = buildSocialReport({
      range,
      status,
      firstPostedDate: null,
      posts: Array.from({ length: MIN_POSTS_FOR_WEEKDAYS }, (_, i) =>
        post(
          i % 2 ? "2026-10-25" : "2026-10-27",
          { views: 100 + i },
          {
            content_item_id: i < 4 ? "c1" : null,
          },
        ),
      ),
    });
    expect(many.weekdays?.map((w) => w.key)).toEqual(["0", "2"]);
    expect(many.origin?.mellox.posts).toBe(4);
    expect(many.origin?.other.posts).toBe(4);
  });
});
