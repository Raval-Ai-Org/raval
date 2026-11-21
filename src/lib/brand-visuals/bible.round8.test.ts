// Round 8 (ADR-0048): designed graphic systems — register, text density, the
// brand's logo habit, the series frame and reusable building blocks.
import { describe, expect, it } from "vitest";
import {
  BIBLE_RULES_LIMIT,
  bibleEmphasis,
  bibleRichText,
  bibleRules,
  bibleWantsLogo,
} from "./bible";
import { BibleSchema, DirectionSchema } from "./contracts";
import { buildImagePromptDetailed } from "../post-image";

const designed = {
  world: {
    medium: "Flat vector layouts with framed screenshots",
    paletteMood: "white, black, coral red",
  },
  type: { headline: "Heavy geometric grotesk", emphasis: "colour-words", casing: "all caps" },
  composition: { logo: "top-left", headlineZone: "left column", density: "full" },
  register: "designed-system",
  text: "rich",
  logo: "sometimes",
  frame:
    "dark top band with the white mark left and an accent slide counter pill; dark footer band with the site address",
  components: [
    { kind: "eyebrow-pill", description: "Outlined accent pill with a short caps label" },
    { kind: "icon-list", description: "Line icons in rounded outlined squares with labels" },
    { kind: "cta-pair", description: "Filled accent button beside an outlined one" },
    { kind: "not-a-kind", description: "dropped" },
  ],
};

const direction = (patch: Record<string, unknown> = {}) =>
  DirectionSchema.parse({
    name: "System",
    summary: "s",
    visual: {},
    bible: { ...designed, ...patch },
  });

describe("round 8 schema", () => {
  it("defaults an older bible to headline text, an often-shown logo and no frame", () => {
    const b = BibleSchema.parse({ world: { medium: "Watercolour" } });
    expect(b.register).toBe("mixed");
    expect(b.text).toBe("headline");
    expect(b.logo).toBe("often");
    expect(b.frame).toBe("");
    expect(b.components).toEqual([]);
  });

  it("drops only an unknown building block, keeping the rest", () => {
    const b = BibleSchema.parse(designed);
    expect(b.components.map((c) => c.kind)).toEqual(["eyebrow-pill", "icon-list", "cta-pair"]);
    expect(b.register).toBe("designed-system");
    expect(BibleSchema.parse({ ...designed, components: "nonsense" }).components).toEqual([]);
  });

  it("falls back on unknown enum values", () => {
    const b = BibleSchema.parse({ ...designed, register: "cubist", text: "lots", logo: "never" });
    expect([b.register, b.text, b.logo]).toEqual(["mixed", "headline", "often"]);
  });
});

describe("bibleWantsLogo", () => {
  const seeds = Array.from({ length: 400 }, (_, i) => `job-${i}`);
  const share = (use: string) =>
    seeds.filter((s) => bibleWantsLogo(direction({ logo: use }), s)).length / seeds.length;

  it("always places the logo without a bible or when the brand always shows it", () => {
    expect(bibleWantsLogo(undefined, "x")).toBe(true);
    expect(seeds.every((s) => bibleWantsLogo(direction({ logo: "always" }), s))).toBe(true);
  });

  it("is the same answer for the same piece", () => {
    const d = direction({ logo: "sometimes" });
    for (const s of seeds.slice(0, 50)) expect(bibleWantsLogo(d, s)).toBe(bibleWantsLogo(d, s));
  });

  it("follows the brand's habit roughly", () => {
    expect(share("often")).toBeGreaterThan(0.6);
    expect(share("sometimes")).toBeGreaterThan(0.35);
    expect(share("sometimes")).toBeLessThan(0.65);
    expect(share("rarely")).toBeLessThan(0.35);
  });
});

describe("round 8 rules", () => {
  const ok = { components: designed.components.slice(0, 3) };

  it("says the medium, the series frame and the building blocks", () => {
    const rules = bibleRules(direction(ok));
    expect(rules).toMatch(/clean designed graphic/);
    expect(rules).toMatch(/Series frame/);
    expect(rules).toMatch(/Building blocks/);
    expect(rules).toMatch(/Outlined accent pill/);
    expect(rules.length).toBeLessThanOrEqual(BIBLE_RULES_LIMIT);
  });

  it("uses colour-words emphasis", () => {
    expect(bibleEmphasis(direction(ok).bible)).toMatch(/key words .* accent colour/);
  });

  it("stays under the cap with every field full", () => {
    const long = "x".repeat(300);
    const d = direction({
      frame: long,
      components: Array.from({ length: 8 }, () => ({ kind: "quote", description: long })),
      signatures: Array.from({ length: 5 }, () => ({
        kind: "motif",
        description: long,
        sourceIds: [],
      })),
      avoid: [long, long, long, long],
    });
    expect(bibleRules(d).length).toBeLessThanOrEqual(BIBLE_RULES_LIMIT);
  });

  it("knows a rich-text brand", () => {
    expect(bibleRichText(direction(ok))).toBe(true);
    expect(bibleRichText(direction({ text: "minimal" }))).toBe(false);
    expect(bibleRichText(undefined)).toBe(false);
  });
});

describe("rich supporting lines reach the image prompt verbatim", () => {
  const build = (lines: string[] | null) =>
    buildImagePromptDetailed({
      postBody: "Three ways we build games people keep playing.",
      brand: { brandName: "Studio" },
      size: "1024x1024",
      seedKey: "rich-1",
      onImageText: "Games people keep playing",
      onImageLines: lines,
    }).prompt;

  it("sets the eyebrow first, then the headline, then the rest", () => {
    const prompt = build(["eyebrow: Our process", "item: Clear hooks", "button: Follow for more"]);
    const eyebrow = prompt.indexOf("Our process");
    const headline = prompt.indexOf("Games people keep playing");
    expect(eyebrow).toBeGreaterThan(-1);
    expect(headline).toBeGreaterThan(eyebrow);
    expect(prompt.indexOf("Clear hooks")).toBeGreaterThan(headline);
    expect(prompt).toContain("Follow for more");
  });

  it("ignores lines without a role", () => {
    expect(build(["just some words"])).not.toContain("just some words");
  });
});

describe("wantsSupportingLines", () => {
  it("gives campaign pieces a heading, never a word-free brand", async () => {
    const { wantsSupportingLines } = await import("./bible");
    expect(wantsSupportingLines(undefined, "Spring launch")).toBe(true);
    expect(wantsSupportingLines(undefined, "  ")).toBe(false);
    expect(wantsSupportingLines(undefined)).toBe(false);
    expect(wantsSupportingLines(direction({ text: "rich" }))).toBe(true);
    expect(wantsSupportingLines(direction({ text: "minimal" }), "Spring launch")).toBe(false);
  });
});
