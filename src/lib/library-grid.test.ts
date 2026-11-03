import { describe, expect, it } from "vitest";
import { columnsFor, isNewSince, masonry, parseRatio } from "./library-grid";

describe("parseRatio", () => {
  it("reads stored ratios as width ÷ height", () => {
    expect(parseRatio("4:5")).toBeCloseTo(0.8);
    expect(parseRatio("9:16")).toBeCloseTo(0.5625);
    expect(parseRatio("16 x 9")).toBeCloseTo(1.7778, 3);
    expect(parseRatio(1)).toBe(1);
  });

  it("refuses anything that isn't a sane ratio", () => {
    expect(parseRatio("tall")).toBeNull();
    expect(parseRatio("1:0")).toBeNull();
    expect(parseRatio(null)).toBeNull();
    expect(parseRatio(40)).toBeNull();
  });
});

describe("masonry", () => {
  it("puts each tile in the shortest column, keeping reading order", () => {
    // Heights: a tall (2), then squares (1) fill the short column until it catches up.
    const ratios: Record<string, number> = { a: 0.5, b: 1, c: 1, d: 1, e: 1 };
    const cols = masonry(["a", "b", "c", "d", "e"], 2, (k) => ratios[k]);
    expect(cols).toEqual([
      ["a", "d"],
      ["b", "c", "e"],
    ]);
  });

  it("spreads equal tiles left to right", () => {
    expect(masonry([1, 2, 3, 4, 5], 3, () => 1)).toEqual([[1, 4], [2, 5], [3]]);
  });

  it("copes with one column and bad ratios", () => {
    expect(masonry(["x", "y"], 0, () => 0)).toEqual([["x", "y"]]);
  });

  it("picks columns from the container width", () => {
    expect(columnsFor(358)).toBe(2);
    expect(columnsFor(700)).toBe(3);
    expect(columnsFor(1000)).toBe(4);
    expect(columnsFor(1400)).toBe(5);
  });
});

describe("isNewSince", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  it("is new when made after the last visit", () => {
    expect(isNewSince("2026-10-29T11:00:00Z", "2026-10-29T10:00:00Z", now)).toBe(true);
    expect(isNewSince("2026-10-29T09:00:00Z", "2026-10-29T10:00:00Z", now)).toBe(false);
  });

  it("falls back to the last day on a first visit", () => {
    expect(isNewSince("2026-10-29T01:00:00Z", null, now)).toBe(true);
    expect(isNewSince("2026-10-27T01:00:00Z", null, now)).toBe(false);
    expect(isNewSince(null, null, now)).toBe(false);
  });
});
