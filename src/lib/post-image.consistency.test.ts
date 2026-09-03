import { describe, it, expect } from "vitest";
import {
  buildImagePromptDetailed,
  getBrandVisualSystem,
  getStyleSeed,
  type BrandDnaLite,
  type ImgSize,
} from "./post-image";

const SIZES: ImgSize[] = ["1024x1024", "1792x1024", "1024x1792"];

const brand: BrandDnaLite = {
  brandName: "Mellox AI",
  oneLiner: "The marketing intelligence layer.",
  voice: "Confident, concise, editorial.",
  audience: "Marketing leads at growth-stage SaaS.",
  values: "Clarity, evidence, momentum.",
  doRules: "Lead with data. Keep type crisp.",
  dontRules: "No emojis. No stock gradients.",
  colors: [
    { name: "Ink", hex: "#0B1220" },
    { name: "Bone", hex: "#F8FAFC" },
    { name: "Signal", hex: "#22C55E" },
  ],
  fonts: ["Space Grotesk", "Inter"],
  logoUrl: "https://example.com/logo.svg",
};

function build(size: ImgSize) {
  return buildImagePromptDetailed({
    postBody: "How AI-native brands earn LLM visibility in 2026.\n\nA teardown of what works.",
    postTitle: "LLM visibility teardown",
    brand,
    workspaceName: "Mellox AI",
    platform: "linkedin",
    size,
    seedKey: "post-abc-123",
    autoSize: false,
  });
}

describe("post image consistency across aspect ratios", () => {
  const results = SIZES.map(build);
  const [sq, land, port] = results;

  it("uses the same stable style seed for every size", () => {
    const seed = getStyleSeed(brand, "post-abc-123", "Mellox AI");
    for (const r of results) expect(r.styleSeed).toBe(seed);
    expect(new Set(results.map((r) => r.styleSeed)).size).toBe(1);
  });

  it("applies the same palette (bg, surface, fg, muted, accent) across sizes", () => {
    const keys = ["id", "bg", "surface", "fg", "muted", "accent"] as const;
    for (const k of keys) {
      expect(land.visual.palette[k]).toBe(sq.visual.palette[k]);
      expect(port.visual.palette[k]).toBe(sq.visual.palette[k]);
    }
  });

  it("applies the same typography family + description across sizes", () => {
    expect(land.visual.typographyFamily).toBe(sq.visual.typographyFamily);
    expect(port.visual.typographyFamily).toBe(sq.visual.typographyFamily);
    expect(land.visual.typographyDescription).toBe(sq.visual.typographyDescription);
    expect(port.visual.typographyDescription).toBe(sq.visual.typographyDescription);
  });

  it("applies the same composition (layout element) across sizes", () => {
    expect(land.visual.composition).toBe(sq.visual.composition);
    expect(port.visual.composition).toBe(sq.visual.composition);
  });

  it("uses the same brand DNA field set (same values, same used flags) across sizes", () => {
    const norm = (r: typeof sq) =>
      r.brandFields.map((f) => `${f.key}:${f.used ? 1 : 0}:${f.value}`).join("|");
    expect(norm(land)).toBe(norm(sq));
    expect(norm(port)).toBe(norm(sq));
  });

  it("differs only in the aspect-specific safe-zone line, not visual identity", () => {
    // The aspect line MUST be different per size (crop rules differ).
    expect(sq.aspectLine).not.toBe(land.aspectLine);
    expect(sq.aspectLine).not.toBe(port.aspectLine);
    expect(land.aspectLine).not.toBe(port.aspectLine);

    // But the palette hexes and style seed MUST appear in every prompt.
    for (const r of results) {
      expect(r.prompt).toContain(r.styleSeed);
      expect(r.prompt).toContain(sq.visual.palette.accent);
      expect(r.prompt).toContain(sq.visual.palette.bg);
    }
  });

  it("is deterministic � regenerating the same post yields the same visual system", () => {
    const again = build("1024x1024");
    expect(again.styleSeed).toBe(sq.styleSeed);
    expect(again.visual.palette).toEqual(sq.visual.palette);
    expect(again.visual.typographyFamily).toBe(sq.visual.typographyFamily);
    expect(again.visual.composition).toBe(sq.visual.composition);
  });

  it("falls back to a seeded visual system consistently when Brand DNA is empty", () => {
    const empty = getBrandVisualSystem(null, "post-xyz", "Solo Brand");
    const empty2 = getBrandVisualSystem(null, "post-xyz", "Solo Brand");
    expect(empty.paletteSource).toBe("seeded");
    expect(empty.typographySource).toBe("seeded");
    expect(empty2.palette).toEqual(empty.palette);
    expect(empty2.typography.fontFamily).toBe(empty.typography.fontFamily);
    expect(empty2.composition).toBe(empty.composition);
  });
});
