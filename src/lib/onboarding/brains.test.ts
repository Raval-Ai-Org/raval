import { describe, expect, it } from "vitest";
import { brainFill, foundSoFar } from "./brains";

describe("brainFill", () => {
  it("is empty before the scan and full after it", () => {
    expect(brainFill("idle", 0, 0, {})).toEqual({
      brand: 0,
      audience: 0,
      competitors: 0,
      market: 0,
    });
    expect(brainFill("ok", 0, 0, {})).toEqual({ brand: 1, audience: 1, competitors: 1, market: 1 });
  });

  it("only fills market and competitors once the research ran", () => {
    const early = brainFill("loading", 0, 20, {});
    expect(early.brand).toBeCloseTo(0.2);
    expect(early.market).toBe(0);
    expect(early.competitors).toBe(0);
    const found = brainFill("loading", 2, 60, {
      market: { mentions: 3, about: 1, competitors: 2, reviews: 0 },
    });
    expect(found.market).toBeGreaterThan(0.5);
    expect(found.competitors).toBeLessThan(1);
  });
});

describe("foundSoFar", () => {
  it("says nothing until something was found", () => {
    expect(foundSoFar({})).toBeNull();
    expect(
      foundSoFar({
        identity: {
          colors: ["#000", "#fff"],
          fonts: [],
          structuredData: 0,
          headings: 0,
          socialPlatforms: [],
        },
      }),
    ).toBe("2 colours");
  });
});
