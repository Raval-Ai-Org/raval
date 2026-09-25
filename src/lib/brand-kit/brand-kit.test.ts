import { describe, expect, it } from "vitest";
import { emptySpec, parseStyleSpec, specCompleteness } from "./spec";
import { paletteFromDnaColors, resolveStyle, styleAppliesTo } from "./resolve";
import {
  VISUAL_BLOCK_MAX,
  WRITING_BLOCK_MAX,
  styleBlockFor,
  videoStyleBlock,
  visualStyleBlock,
  writingStyleBlock,
} from "./prompt";
import {
  applySuggestion,
  clusterColors,
  markUserEdited,
  mergeAnalyses,
  rolesFromColors,
} from "./merge";
import { checkWritingConformance, countEmoji, extractHashtags } from "./conformance";
import { FONT_CATALOG, fontStack, googleFontHref, nearestCatalogFont } from "./fonts";

const STYLE_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

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

describe("parseStyleSpec", () => {
  it("round-trips a valid spec", () => {
    const spec = {
      inherit: { colors: false },
      writing: { voice: "Punchy", emoji: "none", tone: { casual: 80 } },
      visual: { palette: { primary: "#ABC" }, medium: "photo" },
      references: [{ assetId: ASSET_ID, strength: "exact" }],
    };
    const parsed = parseStyleSpec(spec);
    expect(parsed.inherit?.colors).toBe(false);
    expect(parsed.inherit?.fonts).toBe(true);
    expect(parsed.writing?.emoji).toBe("none");
    expect(parsed.visual?.palette?.primary).toBe("#aabbcc");
    expect(parsed.references?.[0].strength).toBe("exact");
    expect(parseStyleSpec(parsed)).toEqual(parsed);
  });

  it("drops bad fields but keeps good ones", () => {
    const parsed = parseStyleSpec({
      writing: { voice: "ok", emoji: "lots", tone: { casual: 900 } },
      visual: { palette: { primary: "not-a-color" }, mood: "calm" },
      references: [{ assetId: "nope" }, { assetId: ASSET_ID }],
    });
    expect(parsed.writing).toEqual({ voice: "ok" });
    expect(parsed.visual).toEqual({ mood: "calm" });
    expect(parsed.references).toEqual([{ assetId: ASSET_ID, strength: "close" }]);
  });

  it("never throws on junk", () => {
    expect(parseStyleSpec(null)).toEqual(emptySpec());
    expect(parseStyleSpec("x")).toEqual(emptySpec());
    expect(parseStyleSpec({ writing: 5 })).toEqual(emptySpec());
  });

  it("scores completeness", () => {
    expect(specCompleteness(emptySpec())).toBe(0);
    expect(specCompleteness({ writing: { voice: "x" }, visual: { mood: "y" } })).toBeCloseTo(0.2);
  });
});

describe("resolveStyle", () => {
  it("uses Brand DNA only when there is no style", () => {
    const r = resolveStyle(dna, null);
    expect(r.styleId).toBeNull();
    expect(r.writing.voice).toBe("Warm and direct");
    expect(r.visual.palette.primary).toBe("#ff5500");
    expect(r.visual.typography?.heading).toBe("Poppins");
    expect(r.visual.typography?.body).toBe("Inter");
    expect(r.logo).toEqual({ source: "dna", dnaUrl: dna.logoUrl });
    expect(r.fromDna).toMatchObject({
      colors: true,
      fonts: true,
      voice: true,
      logo: true,
      rules: true,
    });
  });

  it("style fields override Brand DNA", () => {
    const r = resolveStyle(dna, {
      id: STYLE_ID,
      name: "Bold",
      version: 3,
      spec: {
        writing: { voice: "Loud" },
        visual: {
          palette: { primary: "#000000" },
          typography: { heading: "Anton" },
          logo: { variant: "logo_dark" },
        },
      },
    });
    expect(r.writing.voice).toBe("Loud");
    expect(r.visual.palette.primary).toBe("#000000");
    // Unset roles still inherit.
    expect(r.visual.palette.secondary).toBeDefined();
    expect(r.visual.typography?.heading).toBe("Anton");
    expect(r.logo.source).toBe("kit");
    expect(r.fromDna.voice).toBe(false);
    expect(r.fromDna.colors).toBe(false);
  });

  it("respects inherit toggles", () => {
    const r = resolveStyle(dna, {
      id: STYLE_ID,
      name: "Own",
      version: 1,
      spec: { inherit: { colors: false, fonts: false, voice: false, logo: false, rules: false } },
    });
    expect(r.visual.palette).toEqual({});
    expect(r.visual.typography?.heading).toBeUndefined();
    expect(r.writing.voice).toBeUndefined();
    expect(r.logo.source).toBeNull();
    expect(r.rules).toEqual({ do: null, dont: null });
  });

  it("maps DNA colours to roles by name", () => {
    const p = paletteFromDnaColors([
      { name: "Background", hex: "#fff" },
      { name: "Accent", hex: "#f0f" },
      { name: "Main", hex: "#123456" },
    ]);
    expect(p.primary).toBe("#123456");
    expect(p.accent).toBe("#ff00ff");
    expect(p.background).toBe("#ffffff");
  });

  it("applies to listed formats only", () => {
    const r = resolveStyle(dna, {
      id: STYLE_ID,
      name: "x",
      version: 1,
      spec: {},
      applies_to: ["social"],
    });
    expect(styleAppliesTo(r, "social")).toBe(true);
    expect(styleAppliesTo(r, "article")).toBe(false);
    expect(styleAppliesTo(resolveStyle(dna, null), "article")).toBe(true);
  });
});

describe("prompt blocks", () => {
  const style = resolveStyle(dna, {
    id: STYLE_ID,
    name: "Launch",
    version: 1,
    spec: {
      writing: {
        tone: { casual: 90, bold: 85, playful: 50 },
        emoji: "none",
        hashtags: { count: 3, always: ["acme"] },
        bannedWords: ["synergy"],
        examples: ["x".repeat(790), "y".repeat(790), "z".repeat(790)],
        perFormat: { article: "Use H2 every 300 words" },
      },
      visual: { medium: "photo", mood: "bright", textPlacement: "bottom" },
      video: { pacing: "fast", captions: { position: "bottom", color: "#fff" } },
    },
  });

  it("is deterministic and capped", () => {
    const a = writingStyleBlock(style, "article");
    expect(a).toBe(writingStyleBlock(style, "article"));
    expect(a.length).toBeLessThanOrEqual(WRITING_BLOCK_MAX);
    expect(a).toContain("very casual");
    expect(a).toContain("No emoji.");
    expect(a).toContain("Never use: synergy");
    expect(a).toContain("Use H2 every 300 words");
    expect(a).toContain("<example 1>");
    expect(writingStyleBlock(style, "social")).not.toContain("Use H2");
  });

  it("describes the look for image prompts", () => {
    const v = visualStyleBlock(style);
    expect(v.length).toBeLessThanOrEqual(VISUAL_BLOCK_MAX);
    expect(v).toContain("primary #ff5500");
    expect(v).toContain("headline in Poppins");
    expect(v).toContain("Medium: photo");
  });

  it("describes video", () => {
    const v = videoStyleBlock(style);
    expect(v).toContain("Pacing: fast");
    expect(v).toContain("bottom of frame");
  });

  it("picks blocks by format", () => {
    expect(styleBlockFor(style, "carousel")).toContain("## Visual style");
    expect(styleBlockFor(style, "script")).toContain("## Video style");
    expect(styleBlockFor(style, "social")).not.toContain("## Visual style");
  });

  it("is empty with nothing to say", () => {
    const bare = resolveStyle(null, null);
    expect(writingStyleBlock(bare)).toBe("");
    expect(visualStyleBlock(bare)).toBe("");
    expect(videoStyleBlock(bare)).toBe("");
  });
});

describe("mergeAnalyses", () => {
  it("clusters colours and picks the most common values", () => {
    const s = mergeAnalyses([
      {
        kind: "visual",
        colors: ["#ff5500", "#ffffff", "#111111"],
        visual: { medium: "photo", mood: "warm" },
      },
      { kind: "visual", colors: ["#fe5602", "#fafafa"], visual: { medium: "photo" } },
      { kind: "visual", colors: ["#3399ff"], visual: { medium: "flat" } },
    ]);
    expect(s.spec.visual?.palette?.primary).toBe("#ff5500");
    expect(s.spec.visual?.palette?.background).toBe("#ffffff");
    expect(s.spec.visual?.medium).toBe("photo");
    expect(s.confidence["visual.medium"]).toBeCloseTo(2 / 3);
    expect(s.sources).toBe(3);
  });

  it("merges writing samples", () => {
    const s = mergeAnalyses([
      { kind: "writing", writing: { tone: { casual: 80 }, emoji: "light", hooks: ["Question"] } },
      {
        kind: "writing",
        writing: { tone: { casual: 60 }, emoji: "light", hooks: ["question", "Stat"] },
      },
    ]);
    expect(s.spec.writing?.tone?.casual).toBe(70);
    expect(s.spec.writing?.emoji).toBe("light");
    expect(s.spec.writing?.hooks).toEqual(["Question", "Stat"]);
  });

  it("clusterColors ignores junk", () => {
    expect(clusterColors([["nope", "#000"]])).toEqual(["#000000"]);
    expect(rolesFromColors([])).toEqual({});
  });
});

describe("applySuggestion", () => {
  it("never overwrites a user-set field", () => {
    const current = markUserEdited({ visual: { mood: "mine" } }, ["visual.mood"]);
    const next = applySuggestion(current, { visual: { mood: "theirs", medium: "photo" } });
    expect(next.visual?.mood).toBe("mine");
    expect(next.visual?.medium).toBe("photo");
    expect(next.provenance?.["visual.medium"]).toBe("analysis");
  });

  it("applies only chosen fields", () => {
    const next = applySuggestion({}, { visual: { mood: "a", medium: "flat" } }, ["visual.medium"]);
    expect(next.visual).toEqual({ medium: "flat" });
  });
});

describe("conformance", () => {
  const style = resolveStyle(null, {
    id: STYLE_ID,
    name: "x",
    version: 1,
    spec: {
      writing: {
        emoji: "none",
        bannedWords: ["synergy", "game-changer"],
        hashtags: { count: 2, always: ["acme"], casing: "lower" },
        formatting: { maxChars: 100 },
      },
    },
  });

  it("passes clean text", () => {
    const c = checkWritingConformance("Ship faster with less work. #acme #build", style);
    expect(c.issues).toEqual([]);
    expect(c.score).toBe(100);
  });

  it("flags every broken rule", () => {
    const c = checkWritingConformance(
      "This Game-Changer brings synergy 🚀 #Launch #a #b #c #d #e #f " + "x".repeat(80),
      style,
    );
    const codes = c.issues.map((i) => i.code);
    expect(codes).toContain("banned-word");
    expect(codes).toContain("emoji");
    expect(codes).toContain("missing-hashtag");
    expect(codes).toContain("hashtag-case");
    expect(codes).toContain("length");
    expect(c.score).toBeLessThan(50);
  });

  it("counts emoji and hashtags", () => {
    expect(countEmoji("hi 🚀🔥 there 1 #")).toBe(2);
    expect(extractHashtags("a #one b#no #Two_3")).toEqual(["one", "Two_3"]);
  });
});

describe("fonts", () => {
  it("has unique families", () => {
    const names = FONT_CATALOG.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(140);
  });

  it("maps guesses to real families", () => {
    expect(nearestCatalogFont("Poppins").family).toBe("Poppins");
    expect(nearestCatalogFont("a bold geometric sans like Futura").family).toBe("Outfit");
    expect(nearestCatalogFont("Helvetica Neue Bold").family).toBe("Inter");
    expect(nearestCatalogFont("something serif and classic").category).toBe("serif");
    expect(nearestCatalogFont("Montserrat ExtraBold").family).toBe("Montserrat");
    expect(nearestCatalogFont("").family).toBe("Inter");
  });

  it("builds a Google Fonts URL for catalogue families only", () => {
    expect(googleFontHref(["Inter", "Made Up Font", "Caveat"])).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Caveat&display=swap",
    );
    expect(googleFontHref(["Nope"])).toBeNull();
  });

  it("builds a fallback stack", () => {
    expect(fontStack("Lora")).toBe("'Lora', ui-serif, Georgia, serif");
    expect(fontStack(null)).toContain("sans-serif");
  });
});
