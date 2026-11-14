import { describe, expect, it } from "vitest";
import {
  creativeRedo,
  creativeScore,
  hardImageDefects,
  keepFirstRender,
  reviewKindOf,
} from "./image-defects";

describe("hardImageDefects", () => {
  it("keeps the defects a person can't publish", () => {
    const hard = [
      'The headline is misspelled: "Summmer" instead of "Summer".',
      "Garbled letters in the bottom corner.",
      "A second product appears next to the bottle.",
      "The product is shown inside a frame instead of in the scene.",
      "The badge covers the person's face.",
      "The hand has extra fingers.",
      "An invented price tag is on the shelf.",
    ];
    expect(hardImageDefects(hard)).toEqual(hard);
  });

  it("leaves taste notes as notes", () => {
    expect(
      hardImageDefects([
        "The composition feels a little crowded.",
        "Colours could be warmer to match the brand.",
        "Lighting is flat.",
        "Could use more negative space at the top.",
      ]),
    ).toEqual([]);
  });
});

describe("creative rubric", () => {
  it("weights each kind on what it must do", () => {
    const scores = { brief: 8, legibility: 8, craft: 8, joke: 3 };
    expect(creativeScore(scores, "meme")).toBeLessThan(6.5);
    expect(
      creativeScore({ brief: 8, hierarchy: 8, legibility: 8, brand: 8, craft: 8 }, "designed"),
    ).toBe(8);
    expect(creativeScore(undefined, "designed")).toBeNull();
  });

  it("redoes a weak picture once, only with fixes", () => {
    const weak = {
      issues: [],
      scores: { brief: 4, hierarchy: 4, legibility: 5, brand: 5, craft: 4 },
    };
    expect(creativeRedo(weak, "designed", 0).redo).toBe(false);
    const withFixes = { ...weak, fixes: ["Make the product twice as large and centred"] };
    expect(creativeRedo(withFixes, "designed", 0)).toMatchObject({ redo: true, reason: "score" });
    expect(creativeRedo(withFixes, "designed", 1).redo).toBe(false);
  });

  it("always redoes a hard defect, never a good picture", () => {
    expect(creativeRedo({ issues: ["The headline is misspelled."] }, "sales", 0).reason).toBe(
      "hard",
    );
    const good = {
      issues: [],
      scores: { brief: 8, hierarchy: 8, legibility: 9, brand: 8, craft: 8, offer: 8 },
      fixes: ["tiny"],
    };
    expect(creativeRedo(good, "sales", 0).redo).toBe(false);
  });

  it("keeps the first picture only when it was clearly better", () => {
    expect(keepFirstRender({ score: 6, hard: false }, { score: 7.5, hard: false })).toBe(false);
    expect(keepFirstRender({ score: 6, hard: false }, { score: 5, hard: false })).toBe(true);
    expect(keepFirstRender({ score: 6, hard: false }, { score: 9, hard: true })).toBe(true);
    expect(keepFirstRender({ score: 6, hard: true }, { score: 2, hard: false })).toBe(false);
  });

  it("knows a meme, a sale and a native photo", () => {
    expect(reviewKindOf({ category: { id: "meme", group: "fun", register: "native" } })).toBe(
      "meme",
    );
    expect(reviewKindOf({ type: "ad" })).toBe("sales");
    expect(reviewKindOf({ category: { id: "ugc", group: "trust", register: "native" } })).toBe(
      "native",
    );
    expect(reviewKindOf({})).toBe("designed");
  });
});

describe("hardImageDefects: overlapping elements", () => {
  it("treats a logo on the headline or words over the product as hard", () => {
    const hard = [
      "The logo overlaps the headline in the bottom-right corner.",
      "Headline text runs into the product.",
      "The badge is covering the text.",
      "The headline is cut off at the edge.",
    ];
    expect(hardImageDefects(hard)).toEqual(hard);
  });

  it("does not catch plain layout notes", () => {
    expect(hardImageDefects(["The text could be larger.", "The logo is small."])).toEqual([]);
  });
});

describe("learned style (ADR-0048)", () => {
  it("asks for the style score only when the brand has a learned style", async () => {
    const { rubricFor } = await import("./image-defects");
    expect(rubricFor("designed")).not.toContain("style");
    expect(rubricFor("designed", { style: true })).toContain("style");
  });
  it("an off-style picture earns the one redo", async () => {
    const { creativeRedo } = await import("./image-defects");
    const decision = creativeRedo(
      { issues: ["off-style: a photograph where the brand paints watercolour"] },
      "designed",
      0,
    );
    expect(decision).toMatchObject({ redo: true, reason: "hard" });
    expect(creativeRedo({ issues: ["off-style: photo"] }, "designed", 1).redo).toBe(false);
  });
});
