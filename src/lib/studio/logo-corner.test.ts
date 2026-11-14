import { describe, expect, it } from "vitest";

import { pickLogoCorner } from "./logo-corner";

describe("pickLogoCorner", () => {
  it("keeps the brand's corner while it is clear", () => {
    expect(
      pickLogoCorner(
        { "bottom-right": 2, "bottom-left": 1, "top-right": 1, "top-left": 1 },
        "bottom-right",
      ),
    ).toEqual({ corner: "bottom-right", moved: false, skipped: false });
  });

  it("moves off a headline to the calmest corner (measured on a real post)", () => {
    // "one small bottle" ran into the bottom right; the sky above was empty.
    expect(
      pickLogoCorner(
        { "bottom-right": 47.6, "bottom-left": 25, "top-right": 1.7, "top-left": 2.4 },
        "bottom-right",
      ),
    ).toEqual({ corner: "top-right", moved: true, skipped: false });
  });

  it("stays put when its corner is only a little busy and nothing is clearly calmer", () => {
    expect(
      pickLogoCorner(
        { "bottom-right": 9, "bottom-left": 8, "top-right": 10, "top-left": 11 },
        "bottom-right",
      ).corner,
    ).toBe("bottom-right");
  });

  it("leaves the logo off rather than stamp it over words", () => {
    expect(
      pickLogoCorner(
        { "bottom-right": 40, "bottom-left": 30, "top-right": 22, "top-left": 19 },
        "bottom-right",
      ),
    ).toEqual({ corner: null, moved: false, skipped: true });
  });

  it("keeps the old behaviour when nothing could be measured", () => {
    expect(pickLogoCorner({}, "top-left").corner).toBe("top-left");
  });
});
