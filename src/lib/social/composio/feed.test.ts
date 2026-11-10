import { describe, expect, it } from "vitest";
import { INTEGRATION_APPS, integrationApp, allowedTool } from "@/lib/integrations/catalog";
import { normalizeFeedMetrics } from "@/lib/social-insights/normalize";
import { FEED_PLATFORMS, feedListCall, insightsCall, mergeInsights, readFeed } from "./feed";

describe("composio feed", () => {
  it("only uses catalog read tools", () => {
    for (const p of FEED_PLATFORMS) {
      const app = integrationApp(p)!;
      const calls = [feedListCall(p, "123"), ...insightsCall(p, ["1", "2"])];
      for (const c of calls) {
        const tool = allowedTool(app, c.tool);
        expect(tool, `${p} ${c.tool}`).not.toBeNull();
        expect(tool!.write).toBe(false);
      }
    }
    expect(INTEGRATION_APPS.length).toBeGreaterThan(0);
  });

  it("reads Instagram media and merges insights", () => {
    const entries = readFeed("instagram", {
      data: {
        data: [
          {
            id: "17900",
            caption: "Hello",
            media_type: "REELS",
            thumbnail_url: "https://cdn.example/t.jpg",
            permalink: "https://www.instagram.com/p/abc/",
            timestamp: "2026-11-01T10:00:00+0000",
            like_count: 12,
            comments_count: 3,
          },
          { caption: "no id" },
        ],
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].media).toEqual([
      { type: "video", thumbnail_url: "https://cdn.example/t.jpg" },
    ]);
    const merged = mergeInsights(
      "instagram",
      entries,
      { postId: "17900" },
      {
        data: [
          { name: "views", values: [{ value: 400 }] },
          { name: "reach", values: [{ value: 300 }] },
        ],
      },
    );
    expect(normalizeFeedMetrics("instagram", merged[0].metrics)).toEqual({
      likes: 12,
      comments: 3,
      views: 400,
      reach: 300,
    });
  });

  it("leaves numbers out rather than zero", () => {
    const [e] = readFeed("facebook", { data: [{ id: "1_2", message: "Hi" }] });
    expect(normalizeFeedMetrics("facebook", e.metrics)).toEqual({});
  });

  it("reads Facebook counts", () => {
    const [e] = readFeed("facebook", {
      data: [
        {
          id: "1_2",
          created_time: "2026-11-01T10:00:00+0000",
          reactions: { summary: { total_count: 9 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        },
      ],
    });
    expect(normalizeFeedMetrics("facebook", e.metrics)).toEqual({
      likes: 9,
      comments: 2,
      shares: 1,
    });
  });

  it("reads YouTube ids in any shape and string statistics", () => {
    const listed = readFeed("youtube", {
      items: [
        { id: { videoId: "v1" }, snippet: { title: "A", publishedAt: "2026-11-01T00:00:00Z" } },
      ],
    });
    expect(listed[0].platform_url).toBe("https://www.youtube.com/watch?v=v1");
    const merged = mergeInsights(
      "youtube",
      listed,
      { postId: null },
      {
        data: { items: [{ id: "v1", statistics: { viewCount: "1500", likeCount: "20" } }] },
      },
    );
    expect(normalizeFeedMetrics("youtube", merged[0].metrics)).toEqual({ views: 1500, likes: 20 });
  });

  it("reads Pinterest lifetime metrics", () => {
    const [e] = readFeed("pinterest", {
      items: [
        { id: "p1", title: "Pin", pin_metrics: { lifetime_metrics: { impression: 50, save: 4 } } },
      ],
    });
    expect(normalizeFeedMetrics("pinterest", e.metrics)).toEqual({ views: 50, saves: 4 });
  });
});
