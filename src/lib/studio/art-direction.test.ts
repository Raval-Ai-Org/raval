import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  archetypeById,
  archetypeMenu,
  archetypePromptLines,
  carouselSeriesRules,
  heroSubject,
  pickArchetype,
  sellsPhysicalProduct,
} from "./art-direction";

const BRANDS = [
  "Nike",
  "Crocs",
  "Pepsi",
  "Fanta",
  "Starbucks",
  "Adidas",
  "ChatGPT",
  "Ronaldo",
  "Buzz",
  "Higgsfield",
  "PRSNLI",
  "KIKO",
  "Chicken Express",
  "Siri",
  "Tesla",
  "DAP",
];

describe("art direction library", () => {
  it("has unique ids and every layout is complete", () => {
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(ARCHETYPES.length);
    for (const a of ARCHETYPES) {
      expect(a.formats.length).toBeGreaterThan(0);
      expect(a.scene("the hero", true).length).toBeGreaterThan(40);
      expect(a.type && a.typeWithoutText && a.light && a.finish && a.avoid).toBeTruthy();
    }
  });

  it("never names another company in what reaches a prompt", () => {
    const text = [
      archetypeMenu(),
      ...ARCHETYPES.flatMap((a) => archetypePromptLines(a, { hero: "the hero" })),
    ].join("\n");
    for (const brand of BRANDS) expect(text).not.toContain(brand);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const input = { brandText: "premium skincare serum", seed: "post-1" };
    expect(pickArchetype(input).id).toBe(pickArchetype(input).id);
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => pickArchetype({ ...input, seed: `p${i}` }).id),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps product-only layouts to brands that sell a physical thing", () => {
    for (let i = 0; i < 60; i++) {
      const a = pickArchetype({ brandText: "B2B SaaS analytics platform", seed: `s${i}` });
      expect(a.physicalOnly).toBeFalsy();
    }
    expect(sellsPhysicalProduct("cold brew coffee in cans")).toBe(true);
    expect(sellsPhysicalProduct("marketing agency for coffee shops")).toBe(false);
  });

  it("respects a brand that rules out people or words", () => {
    for (let i = 0; i < 60; i++) {
      const a = pickArchetype({
        brandText: "fitness apparel",
        seed: `s${i}`,
        allowPeople: false,
        allowText: false,
      });
      expect(a.person).not.toBe("required");
      expect(a.needsText).toBeFalsy();
    }
  });

  it("prefers layouts made for the format", () => {
    const a = pickArchetype({ brandText: "", format: "before-after", seed: "x" });
    expect(a.formats).toContain("before-after");
  });

  it("uses the no-text treatment when words are added later", () => {
    const a = archetypeById("monument-object")!;
    const lines = archetypePromptLines(a, { hero: "a chair", allowText: false }).join("\n");
    expect(lines).toContain(a.typeWithoutText);
    expect(lines).not.toContain(a.type);
  });

  it("never invents a product for a brand without one", () => {
    expect(heroSubject({ products: "Accounting software", physical: false })).toContain(
      "everyday object",
    );
    expect(heroSubject({ products: "Oat milk latte", physical: true })).toContain("Oat milk latte");
  });

  it("gives the cover a poster brief and inside slides a locked system", () => {
    expect(carouselSeriesRules("cover").join(" ")).toContain("poster");
    expect(carouselSeriesRules("middle").join(" ")).toContain("same place");
  });

  it("rejects unknown ids", () => {
    expect(archetypeById("not-a-layout")).toBeNull();
    expect(archetypeById(undefined)).toBeNull();
  });
});
