import { describe, expect, it } from "vitest";
import {
  namedProduct,
  pickFeaturedProduct,
  productPhotoControls,
  wantsProduct,
  type FeatureCandidate,
} from "./feature";

const p = (id: string, name: string, extra: Partial<FeatureCandidate> = {}): FeatureCandidate => ({
  id,
  name,
  kind: "product",
  hasPhoto: true,
  position: Number(id.replace(/\D/g, "")) || 0,
  ...extra,
});

const catalogue = [
  p("p1", "Glow Vitamin C Serum 30ml"),
  p("p2", "Glow Night Cream"),
  p("p3", "Hydra Cleanser"),
];

describe("namedProduct", () => {
  it("finds the product the brief names, whatever the case and punctuation", () => {
    expect(namedProduct("A launch post for our GLOW night-cream!", catalogue)?.id).toBe("p2");
    expect(namedProduct("Show the Hydra Cleanser in a bathroom", catalogue)?.id).toBe("p3");
  });

  it("matches on the words only one product has, not the shared brand word", () => {
    expect(namedProduct("why vitamin c serum works", catalogue)?.id).toBe("p1");
    expect(namedProduct("everything glow", catalogue)).toBeNull();
  });

  it("refuses a tie and plain briefs", () => {
    const twins = [p("a1", "Blue Mug"), p("a2", "Blue Bowl")];
    expect(namedProduct("our blue range", twins)).toBeNull();
    expect(namedProduct("three tips for better sleep", catalogue)).toBeNull();
  });

  it("needs a whole word, not part of one", () => {
    expect(namedProduct("hydrated skin all day", catalogue)).toBeNull();
  });
});

describe("wantsProduct", () => {
  it("reads selling briefs, goals and aims", () => {
    expect(wantsProduct({ text: "Our new drop is here" })).toBe(true);
    expect(wantsProduct({ text: "20% off this weekend" })).toBe(true);
    expect(wantsProduct({ text: "a story about our founder", goal: "launch" })).toBe(true);
    expect(wantsProduct({ text: "a story about our founder", aim: "act" })).toBe(true);
    expect(wantsProduct({ text: "five habits for calmer mornings" })).toBe(false);
  });
});

describe("pickFeaturedProduct", () => {
  it("always uses a named product, even without rotation", () => {
    expect(
      pickFeaturedProduct({
        text: "Hydra Cleanser close-up",
        products: catalogue,
        recent: ["p3"],
        rotate: false,
      }),
    ).toEqual({ id: "p3", reason: "named" });
  });

  it("never picks for a person when nothing is named", () => {
    expect(
      pickFeaturedProduct({ text: "shop now", products: catalogue, recent: [], rotate: false }),
    ).toBeNull();
  });

  it("moves through the catalogue: never shown first, then the one shown longest ago", () => {
    const pick = (recent: string[]) =>
      pickFeaturedProduct({
        text: "shop our bestsellers",
        products: catalogue,
        recent,
        rotate: true,
      })?.id;
    expect(pick(["p1"])).toBe("p2");
    expect(pick(["p2", "p1"])).toBe("p3");
    expect(pick(["p3", "p2", "p1"])).toBe("p1");
    expect(pick(["p1", "p3", "p2", "p1"])).toBe("p2");
  });

  it("leads a launch with the newest product not shown yet", () => {
    expect(
      pickFeaturedProduct({ text: "just launched", products: catalogue, recent: [], rotate: true })
        ?.id,
    ).toBe("p3");
  });

  it("prefers a product with a photo", () => {
    const products = [p("p1", "Alpha", { hasPhoto: false }), p("p2", "Beta")];
    expect(pickFeaturedProduct({ text: "shop now", products, recent: [], rotate: true })?.id).toBe(
      "p2",
    );
  });

  it("leaves a piece that isn't about selling alone", () => {
    expect(
      pickFeaturedProduct({
        text: "five habits for calmer mornings",
        products: catalogue,
        recent: [],
        rotate: true,
      }),
    ).toBeNull();
  });
});

describe("productPhotoControls", () => {
  const photos = ["a", "b", "c", "d"];
  const base = { photoIds: photos, revision: false, designEnabled: true };

  it("designs a single picture around the main photo", () => {
    for (const type of ["image", "ad"])
      expect(productPhotoControls({ ...base, type, controls: {} })).toEqual({
        referenceAssetIds: ["a"],
        referenceMode: "design",
      });
    expect(
      productPhotoControls({ ...base, type: "social", controls: { includeImage: true } }),
    ).toMatchObject({ referenceMode: "design" });
    expect(productPhotoControls({ ...base, type: "social", controls: {} })).toBeNull();
  });

  it("posts the photo as is when designing is off", () => {
    expect(
      productPhotoControls({ ...base, designEnabled: false, type: "image", controls: {} }),
    ).toEqual({ referenceAssetIds: ["a"], referenceMode: "preserve" });
  });

  it("puts up to three photos on a carousel, and starts Stories and videos from the main one", () => {
    expect(productPhotoControls({ ...base, type: "carousel", controls: {} })).toEqual({
      referenceAssetIds: ["a", "b", "c"],
      referenceMode: "preserve",
    });
    expect(
      productPhotoControls({ ...base, type: "story", controls: {} })?.referenceAssetIds,
    ).toEqual(["a"]);
    expect(
      productPhotoControls({ ...base, type: "video", controls: {} })?.referenceAssetIds,
    ).toEqual(["a"]);
    expect(
      productPhotoControls({ ...base, type: "video", controls: { videoMode: "brand" } }),
    ).toBeNull();
  });

  it("keeps a person's own photos, an edit, and pieces with no picture as they are", () => {
    expect(
      productPhotoControls({ ...base, type: "image", controls: { referenceAssetIds: ["x"] } }),
    ).toBeNull();
    expect(
      productPhotoControls({ ...base, revision: true, type: "image", controls: {} }),
    ).toBeNull();
    expect(productPhotoControls({ ...base, type: "article", controls: {} })).toBeNull();
    expect(productPhotoControls({ ...base, photoIds: [], type: "image", controls: {} })).toBeNull();
  });
});
