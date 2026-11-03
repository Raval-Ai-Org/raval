import { describe, expect, it } from "vitest";
import {
  END_CARD_SECONDS,
  MAX_CLIP_SECONDS,
  MAX_EDIT_SECONDS,
  OVERLAY_SECONDS,
  overlayOpacity,
  planClips,
  recapSeconds,
  videoCanvas,
} from "./clip-edit";
import { studioChargeFor, studioPriceLabel } from "./billing";
import { creationPointsFor } from "@/lib/billing/creation";
import { layerOverlay, KEY_GREEN } from "./photo-design/geometry";
import { planPhotoDesign } from "./photo-design/plan";
import { NEUTRAL_READING } from "./photo-design/read";

describe("clip timeline", () => {
  it("keeps each clip under the cap and the video under a minute with its end card", () => {
    expect(planClips([30])[0]).toEqual({ index: 0, start: 0, seconds: MAX_CLIP_SECONDS });
    const plan = planClips([30, 30, 30, 30]);
    const total = plan.reduce((sum, piece) => sum + piece.seconds, 0);
    expect(total).toBeLessThanOrEqual(MAX_EDIT_SECONDS - END_CARD_SECONDS);
    // The minute is shared, so all four clips appear.
    expect(plan.length).toBe(4);
  });

  it("drops clips too short to show anything", () => {
    expect(planClips([0.2, 5, Number.NaN]).map((p) => p.index)).toEqual([1]);
  });

  it("sizes recaps and canvases", () => {
    expect(recapSeconds(4, "camera")).toBe(4 * 4 + END_CARD_SECONDS);
    expect(recapSeconds(3, "ai")).toBe(3 * 5 + END_CARD_SECONDS);
    for (const ratio of ["9:16", "16:9", "1:1", "4:5", "3:4", "4:3"] as const) {
      const { width, height } = videoCanvas(ratio);
      expect((width % 2) + (height % 2)).toBe(0);
      expect(Math.min(width, height)).toBe(720);
    }
  });

  it("fades the opening design in and out", () => {
    expect(overlayOpacity(0)).toBe(0);
    expect(overlayOpacity(2)).toBe(1);
    expect(overlayOpacity(OVERLAY_SECONDS + 0.1)).toBe(0);
    expect(overlayOpacity(0.25)).toBeCloseTo(0.5);
  });
});

describe("own footage pricing", () => {
  it("prices branded clips and camera recaps without video units", () => {
    expect(studioChargeFor({ type: "video", videoMode: "brand" })).toBe("clip_brand");
    expect(studioChargeFor({ type: "video", videoMode: "recap" })).toBe("photo_recap");
    expect(studioChargeFor({ type: "video", videoMode: "recap", recapMotion: "ai" })).toBe(
      "studio_video",
    );
  });

  it("prices animated photos at five seconds each", () => {
    const label = studioPriceLabel({
      type: "video",
      controls: {
        platforms: [],
        videoMode: "recap",
        recapMotion: "ai",
        referenceAssetIds: ["a", "b", "c"],
        durationSec: 60,
      } as never,
    });
    const long = studioPriceLabel({
      type: "video",
      controls: { platforms: [], durationSec: 60 } as never,
    });
    expect(label).not.toBe(long);
  });

  it("uses a few creation points for own footage and two for a photo design", () => {
    expect(
      creationPointsFor({
        type: "video",
        controls: { platforms: [], videoMode: "brand" } as never,
      }),
    ).toBe(3);
    expect(
      creationPointsFor({
        type: "social",
        controls: { platforms: [], referenceAssetIds: ["a"], referenceMode: "design" } as never,
      }),
    ).toBe(2);
  });
});

describe("opening design over footage", () => {
  it("is see-through where the footage shows and solid on the design", () => {
    const design = new Uint8Array([0, 255, 0, 255, 200, 10, 10, 255]);
    const out = layerOverlay(design, new Float32Array([1, 0]), KEY_GREEN);
    expect(out[3]).toBe(0);
    expect(Array.from(out.slice(4, 8))).toEqual([200, 10, 10, 255]);
  });

  it("can be forced to an overlay or a framed layout", () => {
    const base = {
      readings: [NEUTRAL_READING],
      sizes: [{ width: 1000, height: 1000 }],
      ratio: "9:16" as const,
      copy: [],
      brief: "a poster",
    };
    expect(planPhotoDesign({ ...base, layout: "overlay" }).layout).toBe("overlay");
    expect(planPhotoDesign(base).layout).toBe("windows");
  });
});
