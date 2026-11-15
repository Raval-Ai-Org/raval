import { describe, expect, it } from "vitest";
import { FREE_VIDEO_UNITS, PLANS, UNITS_PER_CREDIT, VIDEO_PACKS, videoCreditsFor } from "./catalog";
import { freeVideoLabel, freeVideosLeft, videoChargePlan } from "./video-charge";

describe("videoChargePlan", () => {
  it("uses a free video for Draft and Standard while one is left", () => {
    for (const option of ["draft", "standard"] as const)
      expect(
        videoChargePlan({ videoBalance: 200, option, seconds: 24, resolution: "720p" }),
      ).toEqual({ meter: "video", amount: 100, label: "Free video" });
  });

  it("covers any offered length with one free video", () => {
    const long = videoChargePlan({
      videoBalance: 100,
      option: "standard",
      seconds: 32,
      resolution: "1080p",
    });
    expect(long).toMatchObject({ meter: "video", amount: FREE_VIDEO_UNITS });
  });

  it("takes credits once the legacy free videos are used (3 a second on Standard)", () => {
    const plan = videoChargePlan({
      videoBalance: 99,
      option: "standard",
      seconds: 8,
      resolution: "720p",
    });
    expect(plan).toEqual({ meter: "credits", amount: 24 * UNITS_PER_CREDIT, label: "24 credits" });
    expect(
      videoChargePlan({ videoBalance: 0, option: "standard", seconds: 24, resolution: "720p" }),
    ).toMatchObject({ meter: "credits", amount: 72 * UNITS_PER_CREDIT });
  });

  it("always charges credits for Premium, Cinematic and Long", () => {
    for (const option of ["premium", "cinematic", "long", "variation"] as const) {
      const plan = videoChargePlan({
        videoBalance: 10_000,
        option,
        seconds: 10,
        resolution: "1080p",
      });
      expect(plan.meter).toBe("credits");
    }
    expect(
      videoChargePlan({ videoBalance: 200, option: "premium", seconds: 10, resolution: "1080p" })
        .amount,
    ).toBe(50 * UNITS_PER_CREDIT);
  });

  it("uses a premium video for Premium, Cinematic and Long up to 24 s, then credits", () => {
    for (const option of ["premium", "cinematic", "long"] as const)
      expect(
        videoChargePlan({
          videoBalance: 0,
          premiumBalance: 2,
          option,
          seconds: 24,
          resolution: "720p",
        }),
      ).toEqual({ meter: "premium_video", amount: 1, label: "Premium video" });
    // Longer than one premium video, none left, or not a premium option: credits.
    expect(
      videoChargePlan({
        videoBalance: 0,
        premiumBalance: 2,
        option: "long",
        seconds: 30,
        resolution: "720p",
      }).meter,
    ).toBe("credits");
    expect(
      videoChargePlan({
        videoBalance: 0,
        premiumBalance: 0,
        option: "premium",
        seconds: 8,
        resolution: "720p",
      }).meter,
    ).toBe("credits");
    // A free Standard video stays free; premium videos are never spent on it.
    expect(
      videoChargePlan({
        videoBalance: 0,
        premiumBalance: 5,
        option: "standard",
        seconds: 16,
        resolution: "720p",
      }).meter,
    ).toBe("credits");
  });

  it("grants no new premium videos: video is priced in credits (pricing v4)", () => {
    for (const plan of ["free", "starter", "growth", "agency", "scale"] as const)
      expect(PLANS[plan].allowances.premiumVideos).toBe(0);
  });

  it("keeps the provider-cost floor in the credit price", () => {
    const cheap = videoCreditsFor("standard", 8, "720p", 0.3);
    const dear = videoCreditsFor("standard", 8, "720p", 3);
    expect(cheap).toBe(24 * UNITS_PER_CREDIT);
    expect(dear).toBeGreaterThan(cheap);
    expect(dear % UNITS_PER_CREDIT).toBe(0);
  });
});

describe("catalog", () => {
  it("grants no new free videos (pricing v4)", () => {
    for (const plan of ["free", "starter", "growth", "agency", "scale"] as const)
      expect(PLANS[plan].allowances.videoUnits).toBe(0);
  });

  it("takes video packs off sale", () => {
    expect(VIDEO_PACKS.every((pack) => pack.availability === "later")).toBe(true);
  });

  it("prices video per second in whole credits", () => {
    expect(videoCreditsFor("standard", 10, "720p")).toBe(30 * UNITS_PER_CREDIT);
    expect(videoCreditsFor("premium", 10, "1080p")).toBe(50 * UNITS_PER_CREDIT);
    expect(videoCreditsFor("draft", 5, "720p")).toBe(8 * UNITS_PER_CREDIT);
    expect(videoCreditsFor("cinematic", 10, "2k")).toBe(120 * UNITS_PER_CREDIT);
  });
});

describe("free video words", () => {
  it("counts whole videos", () => {
    expect(freeVideosLeft(200)).toBe(2);
    expect(freeVideosLeft(150)).toBe(1);
    expect(freeVideosLeft(-50)).toBe(0);
  });

  it("says how many of the month's free videos are left", () => {
    expect(freeVideoLabel(2, 2)).toBe("Free video · 2 of 2 left");
    expect(freeVideoLabel(1, 2)).toBe("Free video · 1 of 2 left");
    expect(freeVideoLabel(7, 2)).toBe("Free video · 7 left");
  });
});
