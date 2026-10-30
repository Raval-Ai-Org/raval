import { describe, expect, it } from "vitest";
import { resolvePhotoMode } from "./mode";
import { studioChargeFor, studioPriceLabel } from "../billing";
import { creditsFor } from "@/lib/billing/catalog";

const photo = "00000000-0000-4000-8000-000000000001";
const base = {
  type: "image" as const,
  intent: { brief: "Make a post from this photo" },
  controls: { platforms: [], referenceAssetIds: [photo], referenceMode: "preserve" as const },
};

describe("resolvePhotoMode", () => {
  it("keeps a photo posted as is unless something is asked for on it", () => {
    expect(resolvePhotoMode(base)).toBe("preserve");
    expect(
      resolvePhotoMode({ ...base, intent: { brief: 'Add "Same-day plumbing" and some badges' } }),
    ).toBe("design");
  });

  it("designs when a person edits the picture or asks for more versions", () => {
    expect(
      resolvePhotoMode({
        ...base,
        parentJobId: "job",
        refine: { instruction: "make it brighter", target: "media" },
      }),
    ).toBe("design");
    expect(
      resolvePhotoMode({
        ...base,
        parentJobId: "job",
        refine: { instruction: "more", target: "variations" },
      }),
    ).toBe("design");
  });

  it("leaves other modes and other types alone", () => {
    expect(
      resolvePhotoMode({ ...base, controls: { ...base.controls, referenceMode: "inspire" } }),
    ).toBe("inspire");
    expect(
      resolvePhotoMode({
        ...base,
        type: "carousel",
        controls: { ...base.controls, referenceMode: "design" },
      }),
    ).toBe("edit");
    expect(resolvePhotoMode({ ...base, controls: { platforms: [] } })).toBeUndefined();
  });
});

describe("photo design pricing", () => {
  it("prices exact designs as a photo design and blends as a generated picture", () => {
    const design = { type: "image" as const, referenceAssetIds: [photo], referenceMode: "design" };
    expect(studioChargeFor(design)).toBe("photo_design");
    expect(studioChargeFor({ ...design, photoFidelity: "blend" })).toBe("image_post");
    expect(studioChargeFor({ ...design, type: "ad", photoFidelity: "blend" })).toBe("ad_set");
  });

  it("prices a product poster as one, and keeps it a poster through resolving", () => {
    const hero = { type: "ad" as const, referenceAssetIds: [photo], referenceMode: "hero" };
    expect(studioChargeFor(hero)).toBe("product_hero");
    expect(studioChargeFor({ ...hero, referenceAssetIds: [] })).not.toBe("product_hero");
    expect(
      resolvePhotoMode({ ...base, controls: { ...base.controls, referenceMode: "hero" } }),
    ).toBe("hero");
  });

  it("shows the design price when words are asked for on a kept photo", () => {
    expect(studioPriceLabel({ ...base, intent: { brief: 'add the headline "Open now"' } })).toBe(
      `${creditsFor("photo_design")} credits`,
    );
    expect(studioPriceLabel(base)).toBe(`${creditsFor("post_set")} credits`);
  });
});
