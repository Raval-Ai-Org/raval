import { describe, expect, it } from "vitest";
import { shortClipPlan, shortClipPrice } from "./short-clip";
import { studioChargeFor, studioPriceLabel } from "./billing";
import { creationPointsFor } from "@/lib/billing/creation";
import { MAX_USD_PER_CREDIT, SHORT_CLIP_CREDITS, shortClipCredits } from "@/lib/billing/catalog";
import type { StudioControls } from "./jobs";

const video = (controls: Partial<StudioControls>) => ({
  type: "video" as const,
  controls: { platforms: [], ...controls } as StudioControls,
});

describe("short clips are paid in credits, longer videos in video credits", () => {
  it("prices a picture brought to life (8 s, Standard) in credits", () => {
    const input = video({ videoModelKey: "standard", durationSec: 8, referenceAssetIds: ["p"] });
    expect(shortClipPlan(input)).toMatchObject({ ugcKey: "standard", clips: 1 });
    expect(studioChargeFor({ type: "video", ...input.controls })).toBe("studio_short_clip");
    expect(studioPriceLabel(input)).toBe("120 credits");
  });

  it("keeps longer, Premium and preview videos on their old prices", () => {
    expect(shortClipPlan(video({ videoModelKey: "standard", durationSec: 10 }))).toBeNull();
    expect(shortClipPlan(video({ videoModelKey: "premium", durationSec: 8 }))).toBeNull();
    expect(shortClipPlan(video({ videoModelKey: "standard" }))).toBeNull();
    expect(
      shortClipPlan(video({ videoModelKey: "draft", durationSec: 8, videoPreview: true })),
    ).toBeNull();
    expect(studioChargeFor({ type: "video", videoModelKey: "premium", durationSec: 8 })).toBe(
      "studio_video",
    );
  });

  it("prices each animated recap photo as one short clip", () => {
    const input = video({
      videoMode: "recap",
      recapMotion: "ai",
      videoModelKey: "draft",
      referenceAssetIds: ["a", "b", "c", "d"],
    });
    expect(shortClipPlan(input)).toMatchObject({ clips: 4, seconds: 5 });
    expect(studioPriceLabel(input)).toBe("240 credits");
    expect(creationPointsFor(input)).toBe(shortClipPrice(shortClipPlan(input)!).points);
    // Premium animation stays on video credits.
    expect(
      shortClipPlan(
        video({
          videoMode: "recap",
          recapMotion: "ai",
          videoModelKey: "premium",
          referenceAssetIds: ["a"],
        }),
      ),
    ).toBeNull();
  });

  it("covers a short video Story but never designed frames", () => {
    const story = (storyMode: string) => ({
      type: "story" as const,
      controls: { platforms: [], storyMode, videoModelKey: "draft", durationSec: 8 } as never,
    });
    expect(shortClipPlan(story("video"))).not.toBeNull();
    expect(shortClipPlan(story("frames"))).toBeNull();
  });

  it("pays in creation points when that is the payment source", () => {
    const input = video({ videoModelKey: "draft", durationSec: 6, paymentSource: "creation" });
    expect(studioPriceLabel(input)).toBe("5 creation points");
  });

  it("never charges less than the provider cost allows", () => {
    expect(shortClipCredits({ ugcKey: "standard", resolution: "720p" })).toBe(120);
    expect(shortClipCredits({ ugcKey: "draft", resolution: "1080p", clips: 2 })).toBe(160);
    // A pricier route lifts the price instead of losing money.
    const credits = shortClipCredits({
      ugcKey: "draft",
      resolution: "720p",
      providerCostUsd: 2,
    });
    expect(credits * MAX_USD_PER_CREDIT).toBeGreaterThanOrEqual(2);
    // The OpenRouter fallback (incl. fee) is covered at every catalog price.
    const fallback = {
      draft: { "720p": 0.42, "1080p": 0.68 },
      standard: { "720p": 0.84, "1080p": 1.01 },
    };
    for (const key of ["draft", "standard"] as const)
      for (const res of ["720p", "1080p"] as const)
        expect(SHORT_CLIP_CREDITS[key][res] * 0.01).toBeGreaterThan(fallback[key][res]);
  });
});
