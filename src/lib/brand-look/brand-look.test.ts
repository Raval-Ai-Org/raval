import { describe, expect, it } from "vitest";
import { buildImagePromptDetailed, restyleImagePrompt } from "@/lib/post-image";
import { checkWritingConformance, conformanceFixInstruction } from "./conformance";
import { imageStyleInput, styleBlockFor, styleProtectedTerms, ugcStyleNotes } from "./prompt";
import { lookReady, paletteFromDnaColors, resolveLook } from "./resolve";
import { lookCompleteness, parseLook } from "./spec";

const dna = {
  brandName: "Acme",
  voice: "Warm and direct",
  doRules: "Lead with the benefit",
  dontRules: "No jargon",
  colors: [
    { name: "Primary", hex: "#FF5500" },
    { name: "Ink", hex: "#111111" },
    { name: "Sky", hex: "#3399ff" },
  ],
  fonts: ["Poppins", "Inter"],
  logoUrl: "https://acme.test/logo.png",
};

const look = {
  writing: {
    tone: { casual: 85, playful: 20 },
    emoji: "none",
    hashtags: { count: 2, always: ["acme"] },
    bannedWords: ["synergy"],
    signaturePhrases: ["Made simple"],
  },
  visual: {
    palette: { primary: "#0a0" },
    typography: { heading: "Fraunces" },
    medium: "photo",
    mood: "calm and bright",
    logo: { use: true, corner: "top-left" },
    textOnImage: { maxWords: 4 },
  },
  video: { pacing: "fast", captions: { position: "bottom" } },
};

describe("parseLook", () => {
  it("keeps what fits and drops what doesn't, never throwing", () => {
    const parsed = parseLook({
      writing: { emoji: "lots", tone: { casual: 900 }, voice: "ok" },
      visual: {
        palette: { primary: "not-a-colour" },
        mood: "calm",
        logo: { variant: "logo_dark" },
      },
      references: [{ assetId: "x" }],
      inherit: { colors: false },
    });
    expect(parsed.writing).toEqual({ voice: "ok" });
    expect(parsed.visual?.mood).toBe("calm");
    expect(parsed).not.toHaveProperty("references");
    expect(parsed).not.toHaveProperty("inherit");
    expect(parseLook(null)).toEqual({ v: 1 });
    expect(parseLook(parsed)).toEqual(parsed);
  });

  it("measures how filled a look is", () => {
    expect(lookCompleteness(parseLook(null))).toBe(0);
    expect(lookCompleteness(parseLook(look))).toBeGreaterThan(0.7);
  });
});

describe("resolveLook", () => {
  it("is plain Brand DNA when no look is set", () => {
    const r = resolveLook(dna);
    expect(r.customized).toBe(false);
    expect(r.visual.palette).toMatchObject({
      primary: paletteFromDnaColors(dna.colors).primary,
      secondary: "#111111",
      accent: "#3399ff",
    });
    expect(r.visual.typography).toMatchObject({ heading: "Poppins", body: "Inter" });
    expect(r.writing.voice).toBe("Warm and direct");
    expect(r.rules).toEqual({ do: "Lead with the benefit", dont: "No jargon" });
    expect(r.logoUrl).toBe(dna.logoUrl);
  });

  it("lets the look win field by field and keeps the rest from Brand DNA", () => {
    const r = resolveLook({ ...dna, look });
    expect(r.customized).toBe(true);
    expect(r.visual.palette.primary).toBe("#00aa00");
    expect(r.visual.palette.secondary).toBe("#111111");
    expect(r.visual.typography).toMatchObject({ heading: "Fraunces", body: "Inter" });
    expect(r.writing.voice).toBe("Warm and direct");
  });

  it("survives a workspace with nothing saved", () => {
    const r = resolveLook(null);
    expect(r.customized).toBe(false);
    expect(r.visual.palette).toEqual({});
    expect(lookReady(r)).toBe(false);
  });

  it("is ready only with colours, a headline font, an image look and a mood", () => {
    expect(lookReady(resolveLook({ ...dna, look }))).toBe(true);
    expect(lookReady(resolveLook(dna))).toBe(false);
    expect(lookReady(resolveLook({ look }))).toBe(true);
    expect(lookReady(resolveLook({ ...dna, look: { visual: { medium: "photo" } } }))).toBe(false);
  });
});

describe("prompt blocks", () => {
  const r = resolveLook({ ...dna, look });

  it("writes the writing rules for text and adds visuals only where they matter", () => {
    const social = styleBlockFor(r, "social");
    expect(social).toContain("## Writing style");
    expect(social).toContain("Tone: very casual, very serious");
    expect(social).toContain("No emoji.");
    expect(social).toContain("always include acme");
    expect(social).not.toContain("## Visual style");
    expect(styleBlockFor(r, "carousel")).toContain("## Visual style");
    expect(styleBlockFor(r, "video")).toContain("## Video style");
    expect(styleBlockFor(r, "social")).toBe(styleBlockFor(r, "social"));
  });

  it("drives an image prompt: palette, fonts, words on the picture and the logo corner", () => {
    const input = imageStyleInput(r)!;
    expect(input.colors[0]).toBe("#00aa00");
    expect(input.fonts).toEqual(["Fraunces", "Inter"]);
    expect(input.maxWords).toBe(4);
    expect(input.logoCorner).toBe("top-left");
    const base = {
      postBody: "Our new blend is here.",
      brand: { brandName: "Acme", colors: dna.colors, fonts: dna.fonts, logoUrl: dna.logoUrl },
      size: "1024x1024" as const,
      seedKey: "k",
    };
    const prompt = buildImagePromptDetailed({ ...base, style: input } as never).prompt;
    expect(prompt).toContain("#00aa00");
    expect(prompt).toContain("calm and bright");
    expect(restyleImagePrompt("A photo of a red bicycle", input)).toContain("BRAND STYLE");
  });

  it("gives nothing to say when the brand has nothing set", () => {
    expect(imageStyleInput(resolveLook(null))).toBeNull();
    expect(styleBlockFor(resolveLook(null), "social")).toBe("");
  });

  it("names what a rewrite must keep, and a short note for UGC", () => {
    expect(styleProtectedTerms(r)).toEqual(["Made simple", "#acme"]);
    expect(ugcStyleNotes(r)).toContain("fast pacing");
  });
});

describe("conformance", () => {
  const r = resolveLook({ ...dna, look });

  it("flags what breaks the brand's own rules and says how to fix it", () => {
    const bad = checkWritingConformance(
      "Real synergy 🚀 for everyone #one #two #three #four #five",
      r,
    );
    const codes = bad.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["banned-word", "emoji", "missing-hashtag"]));
    expect(bad.score).toBeLessThan(100);
    expect(conformanceFixInstruction(bad)).toContain("Keep every fact");
  });

  it("passes copy that follows them, and checks nothing when no rules are set", () => {
    expect(checkWritingConformance("Coffee, made simple. #acme #beans", r).issues).toEqual([]);
    expect(checkWritingConformance("anything 🚀", resolveLook(dna)).checked).toBe(0);
  });
});
