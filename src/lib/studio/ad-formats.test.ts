import { describe, expect, it } from "vitest";
import {
  AD_FORMATS,
  adFormatDirective,
  adFormatsFor,
  getAdFormat,
  onImageCopyLines,
  pickAdFormat,
} from "./ad-formats";

describe("AD_FORMATS", () => {
  it("has unique, short ids and complete directions", () => {
    const ids = AD_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of AD_FORMATS) {
      expect(f.id.length).toBeLessThanOrEqual(40);
      expect(f.layout.length).toBeGreaterThan(80);
      expect(f.copy).toContain("headline");
      expect(f.goals.length).toBeGreaterThan(0);
    }
  });

  it("never asks for an invented quote, offer or figure", () => {
    expect(getAdFormat("testimonial")!.copy).toMatch(/Never invent/);
    expect(getAdFormat("offer-banner")!.copy).toMatch(/states no offer/);
    expect(getAdFormat("big-number")!.copy).toMatch(/no real figure/);
    expect(getAdFormat("us-vs-them")!.copy).toMatch(/Never name a competitor/);
  });

  it("keeps product layouts for brands with a product", () => {
    expect(adFormatsFor(false).every((f) => !f.needsProduct)).toBe(true);
    expect(adFormatsFor(true)).toHaveLength(AD_FORMATS.length);
  });
});

describe("pickAdFormat", () => {
  it("follows a fitting choice", () => {
    expect(pickAdFormat({ chosen: "before-after", hasProduct: false, seed: "a" }).id).toBe(
      "before-after",
    );
  });

  it("ignores a product layout when there is no product", () => {
    const picked = pickAdFormat({ chosen: "product-hero", hasProduct: false, seed: "a" });
    expect(picked.needsProduct).toBe(false);
  });

  it("is stable per seed, suits the goal and avoids recent layouts", () => {
    const a = pickAdFormat({ goal: "offer", hasProduct: true, seed: "job-1" });
    expect(pickAdFormat({ goal: "offer", hasProduct: true, seed: "job-1" }).id).toBe(a.id);
    expect(a.goals).toContain("offer");
    for (let i = 0; i < 20; i++) {
      const picked = pickAdFormat({
        hasProduct: true,
        seed: `job-${i}`,
        recent: ["product-hero", "offer-banner", "lifestyle"],
      });
      expect(["product-hero", "offer-banner", "lifestyle"]).not.toContain(picked.id);
    }
  });

  it("mostly picks layouts built around the product when there is one", () => {
    const picks = Array.from({ length: 40 }, (_, i) =>
      pickAdFormat({ hasProduct: true, seed: `s${i}` }),
    );
    expect(picks.filter((f) => f.needsProduct).length).toBeGreaterThanOrEqual(28);
  });
});

describe("on-image copy", () => {
  it("lists only the words to typeset, quoted", () => {
    expect(
      onImageCopyLines({
        headline: "Cold brew in 5 minutes",
        support: "",
        badge: "20% off",
        points: ["No grinder", "No mess"],
        cta: "Shop now",
      }),
    ).toEqual([
      'Badge text: "20% off"',
      'Headline: "Cold brew in 5 minutes"',
      'Point 1: "No grinder"',
      'Point 2: "No mess"',
      'Button label: "Shop now"',
    ]);
  });

  it("tells the copy model to write onImage for the layout", () => {
    const text = adFormatDirective(getAdFormat("product-hero")!);
    expect(text).toContain("`onImage`");
    expect(text).toContain("Product hero");
  });
});
