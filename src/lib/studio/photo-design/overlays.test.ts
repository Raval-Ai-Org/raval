import { describe, expect, it } from "vitest";
import {
  faceCover,
  overlayById,
  overlayPromptLines,
  pickOverlay,
  PHOTO_OVERLAYS,
} from "./overlays";
import { NEUTRAL_READING } from "./read";
import { planPhotoDesign } from "./plan";
import { designLayerPrompt } from "./prompt";

describe("photo overlay treatments", () => {
  it("has unique ids and complete, in-canvas zones", () => {
    expect(new Set(PHOTO_OVERLAYS.map((o) => o.id)).size).toBe(PHOTO_OVERLAYS.length);
    for (const o of PHOTO_OVERLAYS) {
      expect(o.design.length).toBeGreaterThan(80);
      for (const z of o.zones) {
        expect(z.x + z.w).toBeLessThanOrEqual(1);
        expect(z.y + z.h).toBeLessThanOrEqual(1);
      }
      // The photo stays the hero (the overlay prompt keeps 55% key colour).
      expect(o.zones.reduce((n, z) => n + z.w * z.h, 0)).toBeLessThan(0.45);
    }
  });

  it("never picks a treatment that covers a face", () => {
    const face = { x: 0.3, y: 0.05, w: 0.3, h: 0.2 };
    for (let i = 0; i < 40; i++) {
      const picked = pickOverlay({ faces: [face], words: 6, seed: `s${i}` });
      expect(picked).not.toBeNull();
      expect(faceCover(picked!, [face])).toBe(0);
    }
  });

  it("returns null with no words or when every treatment would cover a face", () => {
    expect(pickOverlay({ faces: [], words: 0, seed: "a" })).toBeNull();
    expect(pickOverlay({ faces: [{ x: 0, y: 0, w: 1, h: 1 }], words: 5, seed: "a" })).toBeNull();
  });

  it("fits the words, keeps a caption band free and avoids recent treatments", () => {
    for (let i = 0; i < 40; i++) {
      const long = pickOverlay({ faces: [], words: 15, seed: `l${i}` });
      expect(long!.maxWords).toBeGreaterThanOrEqual(15);
      expect(
        pickOverlay({ faces: [], words: 4, seed: `b${i}`, keepBottomClear: true })!.usesBottom,
      ).toBe(false);
      expect(
        pickOverlay({
          faces: [],
          words: 4,
          seed: `r${i}`,
          recent: ["header-band", "sky-headline"],
        })!.id,
      ).not.toMatch(/^(header-band|sky-headline)$/);
    }
  });

  it("is deterministic per seed", () => {
    const args = { faces: [], words: 5, seed: "same" };
    expect(pickOverlay(args)!.id).toBe(pickOverlay(args)!.id);
  });

  it("reaches the design-layer prompt through the plan", () => {
    const plan = planPhotoDesign({
      readings: [{ ...NEUTRAL_READING, faces: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] }],
      sizes: [{ width: 1080, height: 1350 }],
      ratio: "4:5",
      copy: [{ label: "Headline", text: "Sauna season, sale prices" }],
      brief: "post our sauna",
    });
    expect(plan.layout).toBe("overlay");
    const overlay = overlayById(plan.treatment);
    expect(overlay).not.toBeNull();
    const prompt = designLayerPrompt({
      plan,
      brand: { brandName: "Test", colours: [], fonts: [] },
      brief: "post our sauna",
    });
    expect(prompt).toContain(overlayPromptLines(overlay!)[0]);
  });

  it("leaves a plan without words untreated", () => {
    const plan = planPhotoDesign({
      readings: [NEUTRAL_READING],
      sizes: [{ width: 1080, height: 1350 }],
      ratio: "4:5",
      copy: [],
      brief: "post it",
    });
    expect(plan.treatment).toBeUndefined();
  });
});
