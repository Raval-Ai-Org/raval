import { describe, expect, it } from "vitest";
import {
  FREE_VIDEO_UNITS,
  PLANS,
  VIDEO_PACKS,
  creditsForVideoUnits,
  videoCreditsFor,
} from "./catalog";
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

  it("takes credits once the free videos are used", () => {
    const plan = videoChargePlan({
      videoBalance: 99,
      option: "standard",
      seconds: 8,
      resolution: "720p",
    });
    expect(plan).toEqual({ meter: "credits", amount: 120, label: "120 credits" });
    expect(
      videoChargePlan({ videoBalance: 0, option: "standard", seconds: 24, resolution: "720p" }),
    ).toMatchObject({ meter: "credits", amount: 360 });
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
    ).toBe(240);
  });

  it("keeps the provider-cost floor in the credit price", () => {
    const cheap = videoCreditsFor("standard", 8, "720p", 0.3);
    const dear = videoCreditsFor("standard", 8, "720p", 3);
    expect(cheap).toBe(120);
    expect(dear).toBeGreaterThan(cheap);
    expect(dear % 5).toBe(0);
  });
});

describe("catalog", () => {
  it("gives paid plans 2 free videos a month and Free none", () => {
    expect(PLANS.free.allowances.videoUnits).toBe(0);
    for (const plan of ["starter", "growth", "agency", "scale"] as const)
      expect(PLANS[plan].allowances.videoUnits).toBe(2 * FREE_VIDEO_UNITS);
  });

  it("takes video packs off sale", () => {
    expect(VIDEO_PACKS.every((pack) => pack.availability === "later")).toBe(true);
  });

  it("rounds credits up to 5", () => {
    expect(creditsForVideoUnits(100)).toBe(120);
    expect(creditsForVideoUnits(125)).toBe(150);
    expect(creditsForVideoUnits(1)).toBe(5);
    expect(creditsForVideoUnits(0)).toBe(0);
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
