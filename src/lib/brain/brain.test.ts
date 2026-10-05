import { describe, expect, it } from "vitest";
import {
  ago,
  audienceHealth,
  brandHealth,
  competitorsHealth,
  isBrainSection,
  marketHealth,
  mergeUpdates,
  newsSince,
  readiness,
  type BrainUpdate,
} from "./brain";

const u = (id: string, brain: BrainUpdate["brain"], at: string): BrainUpdate => ({
  id,
  brain,
  title: `t-${id}`,
  at,
});

describe("health", () => {
  it("is zero for an empty brain and grows with what is really there", () => {
    expect(brandHealth(null)).toBe(0);
    expect(brandHealth({ brandName: "Acme", voice: " " })).toBeLessThan(15);
    expect(
      brandHealth({
        brandName: "A",
        oneLiner: "b",
        about: "c",
        voice: "d",
        audience: "e",
        products: "f",
        positioning: "g",
        uniqueValueProp: "h",
        colors: [{ hex: "#000" }],
        fonts: ["Inter"],
        logoUrl: "https://a.test/l.png",
        doRules: "x",
        look: { visual: { mood: "calm" }, writing: { emoji: "none" } },
      }),
    ).toBe(100);
    expect(audienceHealth({ groups: 0, measured: 9 })).toBe(0);
    expect(audienceHealth({ groups: 3, measured: 3 })).toBe(100);
    expect(competitorsHealth({ tracked: 0, profiled: 0 })).toBe(0);
    expect(competitorsHealth({ tracked: 4, profiled: 4 })).toBe(100);
    expect(marketHealth({ hasResult: false, ageDays: null })).toBe(0);
    expect(marketHealth({ hasResult: true, ageDays: 1 })).toBeGreaterThan(
      marketHealth({ hasResult: true, ageDays: 40 }),
    );
  });
});

describe("mergeUpdates", () => {
  it("orders newest first, drops duplicates and rows with no time", () => {
    const merged = mergeUpdates([
      [u("a", "brand", "2026-10-01T10:00:00Z"), u("x", "market", "not a date")],
      [u("b", "competitors", "2026-10-03T10:00:00Z"), u("a", "brand", "2026-10-05T10:00:00Z")],
    ]);
    expect(merged.map((m) => m.id)).toEqual(["b", "a"]);
    expect(mergeUpdates([[u("a", "brand", "2026-10-01T10:00:00Z")]], 0)).toEqual([]);
  });
});

describe("newsSince", () => {
  it("counts only what arrived after the last look", () => {
    const updates = [
      u("a", "brand", "2026-10-01T10:00:00Z"),
      u("b", "market", "2026-10-03T10:00:00Z"),
      u("c", "market", "2026-10-04T10:00:00Z"),
    ];
    const seen = Date.parse("2026-10-02T00:00:00Z");
    expect(newsSince(updates, seen)).toMatchObject({ brand: 0, market: 2 });
    expect(newsSince(updates, null)).toMatchObject({ brand: 1, market: 2 });
  });
});

describe("readiness", () => {
  const base = {
    hasWebsite: true,
    brandHealth: 80,
    lookSet: true,
    audienceEnabled: true,
    groups: 2,
    tracked: 3,
    suggested: 0,
    marketFresh: true,
    strategy: "confirmed" as const,
    strategyStale: false,
  };

  it("is empty when everything is in place", () => {
    expect(readiness(base)).toEqual([]);
  });

  it("asks for the brand first and never for a strategy before it", () => {
    const needs = readiness({ ...base, brandHealth: 10, strategy: null });
    expect(needs[0].id).toBe("brand");
    expect(needs.some((n) => n.brain === "strategy")).toBe(false);
  });

  it("never asks for audience groups when Audience is off", () => {
    expect(readiness({ ...base, audienceEnabled: false, groups: 0 })).toEqual([]);
  });

  it("walks a strategy from missing to draft to stale", () => {
    expect(readiness({ ...base, strategy: null })[0].cta).toBe("Create");
    expect(readiness({ ...base, strategy: "draft" })[0].cta).toBe("Review");
    expect(readiness({ ...base, strategyStale: true })[0].id).toBe("strategy");
  });
});

describe("small helpers", () => {
  it("knows its sections", () => {
    expect(isBrainSection("strategy")).toBe(true);
    expect(isBrainSection("brand-kit")).toBe(false);
  });

  it("writes short ages", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(ago("2026-10-06T11:58:00Z", now)).toBe("2m");
    expect(ago("2026-10-06T07:00:00Z", now)).toBe("5h");
    expect(ago("2026-10-01T12:00:00Z", now)).toBe("5d");
    expect(ago(null, now)).toBe("");
  });
});
