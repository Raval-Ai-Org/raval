import { describe, expect, it } from "vitest";

import {
  coverCrop,
  letterboxedVideo,
  looksLetterboxed,
  openingFrameFit,
  reframePrompt,
  wantsLogoInVideo,
  type FrameProfile,
} from "./opening-frame";

describe("openingFrameFit", () => {
  it("recreates a square or 4:5 post for a 9:16 video instead of laying it on bars", () => {
    expect(openingFrameFit({ width: 1024, height: 1024 }, "9:16")).toBe("reframe");
    expect(openingFrameFit({ width: 1080, height: 1350 }, "9:16")).toBe("reframe");
  });

  it("keeps a post that is already the video's shape, and zooms off only a thin edge", () => {
    expect(openingFrameFit({ width: 1080, height: 1920 }, "9:16")).toBe("same");
    expect(openingFrameFit({ width: 1080, height: 1351 }, "4:5")).toBe("same");
    // 3:4 into 4:5 cuts about 6% of the width: a zoom, never a recreation.
    expect(openingFrameFit({ width: 1024, height: 1365 }, "4:5")).toBe("zoom");
    expect(coverCrop({ width: 1024, height: 1024 }, "9:16")).toBeCloseTo(0.4375, 3);
  });

  it("recreates a same-shape post when its corner badge must come off", () => {
    expect(openingFrameFit({ width: 1080, height: 1920 }, "9:16", { clearBadge: true })).toBe(
      "reframe",
    );
  });
});

describe("wantsLogoInVideo", () => {
  it("is off unless the person asks", () => {
    expect(wantsLogoInVideo("A product demo of the serum")).toBe(false);
    expect(wantsLogoInVideo(undefined, null, "")).toBe(false);
  });

  it("is on when asked, and 'no logo' always wins", () => {
    expect(wantsLogoInVideo("Add our logo in the corner")).toBe(true);
    expect(wantsLogoInVideo("keep the branding visible")).toBe(true);
    expect(wantsLogoInVideo("A clean reel, no logo please")).toBe(false);
    expect(wantsLogoInVideo("without the watermark")).toBe(false);
    expect(wantsLogoInVideo("don't add the logo")).toBe(false);
  });
});

describe("reframePrompt", () => {
  it("clears the badge unless the logo was asked for, and never draws bars", () => {
    const clean = reframePrompt({
      ratio: "9:16",
      brandName: "Blume",
      keepLogo: false,
      badgeCorner: "bottom-right",
    });
    expect(clean).toMatch(/Leave out any small logo badge/);
    expect(clean).toMatch(/bottom right/);
    expect(clean).toMatch(/Never add borders, bars, a blurred copy/);
    const kept = reframePrompt({ ratio: "9:16", brandName: "Blume", keepLogo: true });
    expect(kept).toMatch(/Keep the brand's logo/);
    expect(kept).not.toMatch(/Leave out any small logo badge/);
  });
});

/** A synthetic profile: seams at `seam` rows from each edge, given band detail. */
function profile(opts: {
  rows?: number;
  seam?: number | null;
  coverage?: number;
  detail?: Partial<FrameProfile["detail"]>;
}): FrameProfile {
  const n = opts.rows ?? 320;
  const rows = Array.from({ length: n }, () => 0.05);
  if (opts.seam != null) {
    rows[opts.seam] = opts.coverage ?? 0.7;
    rows[n - opts.seam] = opts.coverage ?? 0.7;
  }
  return {
    rows,
    cols: Array.from({ length: 180 }, () => 0.05),
    detail: { top: 1.6, bottom: 1.9, left: 6, right: 6, middle: 24, ...opts.detail },
  };
}

describe("looksLetterboxed", () => {
  it("finds a picture sitting on blurred bars (measured on a real Reel)", () => {
    // Values measured on a 720×1280 video whose square post sat on its blurred copy.
    expect(looksLetterboxed(profile({ seam: 48 }))).toBe(true);
  });

  it("leaves a full-frame studio shot alone: soft edges but no mirrored seams", () => {
    expect(looksLetterboxed(profile({ seam: null }))).toBe(false);
    // One table edge low in the frame is not a pair of bars.
    const table = profile({ seam: null });
    table.rows[230] = 0.9;
    expect(looksLetterboxed(table)).toBe(false);
  });

  it("needs the outside of the seams to be flat", () => {
    expect(looksLetterboxed(profile({ seam: 48, detail: { top: 14, bottom: 12 } }))).toBe(false);
  });

  it("calls a video letterboxed only when most of its frames are", () => {
    const boxed = profile({ seam: 48 });
    const clean = profile({ seam: null });
    expect(letterboxedVideo([boxed, boxed, clean])).toBe(true);
    expect(letterboxedVideo([boxed, clean, clean])).toBe(false);
    expect(letterboxedVideo([])).toBe(false);
  });
});
