import { describe, expect, it } from "vitest";
import { brandLimitCopy, brandRoom, mayRestoreFreeScan } from "./brand-room";

const on = (brands: number, used: number, activeBrands?: number) => ({
  enforcement: "on" as const,
  limits: { brands },
  usage: { brands: used, activeBrands },
});

describe("brandRoom", () => {
  it("never blocks when limits aren't enforced", () => {
    expect(brandRoom({ ...on(1, 5), enforcement: "shadow" })).toBeNull();
    expect(brandRoom({ ...on(1, 5), enforcement: "off" })).toBeNull();
    expect(brandRoom(null)).toBeNull();
  });

  it("is full when every place is used", () => {
    expect(brandRoom(on(1, 1, 1))).toEqual({ used: 1, max: 1, left: 0, full: true });
    expect(brandRoom(on(3, 2, 2))).toMatchObject({ left: 1, full: false });
  });

  it("gives a deleted brand's place back", () => {
    expect(brandRoom(on(3, 2, 2))?.full).toBe(false);
    expect(brandRoom(on(1, 0, 0))?.full).toBe(false);
  });

  it("counts only active brands, like the database check", () => {
    // Downgraded with two paused brands, then deleted the active one.
    expect(brandRoom(on(1, 2, 0))).toMatchObject({ used: 0, full: false });
  });
});

describe("mayRestoreFreeScan", () => {
  it("restores the free scan a few times a month", () => {
    expect(mayRestoreFreeScan(0)).toBe(true);
    expect(mayRestoreFreeScan(2)).toBe(true);
    expect(mayRestoreFreeScan(3)).toBe(false);
  });
});

describe("brandLimitCopy", () => {
  it("names the plan, the brand using the place and the wanted site", () => {
    const copy = brandLimitCopy({
      plan: "starter",
      max: 1,
      usedBy: ["acme.com"],
      wanted: "newsite.com",
    });
    expect(copy.title).toBe("Your Starter plan includes 1 brand");
    expect(copy.text).toBe(
      "It's in use for acme.com. Upgrade to add newsite.com as another brand.",
    );
    expect(copy.hint).toMatch(/delete a brand/);
  });

  it("summarises many brands", () => {
    const copy = brandLimitCopy({ plan: "growth", max: 3, usedBy: ["a.com", "b.com", "c.com"] });
    expect(copy.title).toBe("Your Growth plan includes 3 brands");
    expect(copy.text).toBe("In use: a.com, b.com and 1 more. Upgrade to add another brand.");
  });
});
