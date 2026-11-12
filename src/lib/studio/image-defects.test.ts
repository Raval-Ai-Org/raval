import { describe, expect, it } from "vitest";
import { hardImageDefects } from "./image-defects";

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
