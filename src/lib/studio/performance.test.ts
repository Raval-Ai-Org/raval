import { describe, expect, it } from "vitest";
import { recentPerformanceSignals } from "./performance";

describe("measured creation feedback", () => {
  it("uses only published results with enough views and excludes rejected work", () => {
    const signals = recentPerformanceSignals(
      [
        { id: "useful", title: "Practical setup guide", status: "published" },
        { id: "tiny", title: "One lucky view", status: "published" },
        { id: "rejected", title: "Rejected idea", status: "rejected" },
      ],
      [
        {
          content_item_id: "useful",
          platform: "linkedin",
          status: "published",
          metrics: { views: 500, saves: 25, shares: 10, comments: 5 },
        },
        {
          content_item_id: "useful",
          platform: "instagram",
          status: "published",
          metrics: { views: 400, saves: 8, shares: 4 },
        },
        {
          content_item_id: "tiny",
          platform: "linkedin",
          status: "published",
          metrics: { views: 1, likes: 1 },
        },
        {
          content_item_id: "rejected",
          platform: "linkedin",
          status: "published",
          metrics: { views: 500, likes: 200 },
        },
      ],
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toContain("Practical setup guide");
    expect(signals[0]).toContain("500 views");
  });
});
