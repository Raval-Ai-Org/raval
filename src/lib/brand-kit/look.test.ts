// A Style learned from examples must decide how an image looks: the colours'
// jobs come from what the reader saw, one odd example never sets the style,
// and the style leads the image prompt instead of trailing a random layout.
import { describe, expect, it } from "vitest";
import { buildImagePromptDetailed, restyleImagePrompt } from "@/lib/post-image";
import { contrastRatio, hexToHsv, hsvToHex, isHex, readableOn } from "./color";
import { mergeAnalyses, paletteFromRoles } from "./merge";
import { imageStyleInput } from "./prompt";
import { resolveStyle } from "./resolve";

describe("colour maths", () => {
  it("round-trips hex through HSV", () => {
    for (const hex of ["#ff5500", "#111111", "#ffffff", "#3399ff", "#7c9a2e", "#000000"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(hexToHsv("#f00")).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("checks hex and contrast", () => {
    expect(isHex("#abc")).toBe(true);
    expect(isHex("abcdef")).toBe(true);
    expect(isHex("#abcd")).toBe(false);
    expect(isHex(undefined)).toBe(false);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(3);
    expect(readableOn("#ffee00")).toBe("#111111");
    expect(readableOn("#102040")).toBe("#ffffff");
  });
});

describe("learning from examples", () => {
  it("gives each colour the job it had in the examples", () => {
    // A dark-navy brand: brightness guessing would call white the background.
    const roles = { background: "#0b1d3a", text: "#ffffff", primary: "#ffb400" };
    const s = mergeAnalyses([
      { kind: "visual", colors: ["#0b1d3a", "#ffb400", "#ffffff"], roles },
      { kind: "visual", colors: ["#0c1e3b", "#ffb300", "#fefefe", "#22c55e"], roles },
    ]);
    expect(s.spec.visual?.palette).toMatchObject({
      background: "#0b1d3a",
      text: "#ffffff",
      primary: "#ffb400",
      secondary: "#22c55e",
    });
  });

  it("falls back to guessing for examples read before roles existed", () => {
    expect(paletteFromRoles([undefined, {}], ["#ff5500"])).toBeNull();
    const s = mergeAnalyses([{ kind: "visual", colors: ["#ff5500", "#ffffff", "#111111"] }]);
    expect(s.spec.visual?.palette?.primary).toBe("#ff5500");
    expect(s.spec.visual?.palette?.background).toBe("#ffffff");
  });

  it("an odd-one-out example never sets the layout", () => {
    const s = mergeAnalyses([
      {
        kind: "visual",
        visual: { composition: "headline top left, product photo fills the right half" },
      },
      {
        kind: "visual",
        visual: { composition: "headline at top left, product photo on the right half" },
      },
      {
        kind: "visual",
        visual: {
          composition:
            "centered quote inside a thick rounded frame with a very long decorative flourish underneath it",
        },
      },
    ]);
    expect(s.spec.visual?.composition).toContain("product photo");
  });

  it("keeps the background treatment", () => {
    const s = mergeAnalyses([{ kind: "visual", visual: { background: "solid cream" } }]);
    expect(s.spec.visual?.background).toBe("solid cream");
  });
});

describe("the style leads the image prompt", () => {
  const style = resolveStyle(
    { brandName: "Acme", colors: [{ hex: "#123456" }], fonts: ["Inter"] },
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Launch",
      version: 1,
      spec: {
        inherit: { colors: false, fonts: false },
        visual: {
          palette: { primary: "#ffb400", background: "#0b1d3a", text: "#ffffff" },
          typography: { heading: "Poppins" },
          mood: "bold and energetic",
          composition: "headline top left, product photo fills the right half",
          background: "solid navy",
          textOnImage: { maxWords: 4 },
        },
        references: [{ assetId: "22222222-2222-4222-8222-222222222222", strength: "close" }],
      },
    },
  );
  const base = {
    postBody: "Our new feature ships today",
    brand: { brandName: "Acme", colors: [{ hex: "#123456" }], voice: "calm and minimal" },
    size: "1024x1024" as const,
    seedKey: "seed",
  };

  it("comes before the brief and replaces the random layout and mood", () => {
    const input = imageStyleInput(style, 2);
    const p = buildImagePromptDetailed({ ...base, style: input }).prompt;
    expect(p.indexOf('BRAND STYLE "Launch"')).toBeLessThan(p.indexOf("BRAND DNA"));
    expect(p.indexOf("REFERENCE IMAGES (2 attached)")).toBeLessThan(p.indexOf("POST MESSAGE"));
    expect(p).toContain("• Composition: headline top left, product photo fills the right half");
    expect(p).toContain("• Visual mood: bold and energetic.");
    expect(p).toContain("Background: solid navy");
    expect(p).not.toContain("derived from brand voice");
    expect(p).not.toContain("Canvas defaults");
    expect(p).not.toContain("stock-photo");
  });

  it("follows the examples' layout when the style has no layout of its own", () => {
    const bare = resolveStyle(null, {
      id: "x",
      name: "Refs",
      version: 1,
      spec: { visual: { palette: { primary: "#ffb400" } } },
    });
    const p = buildImagePromptDetailed({ ...base, style: imageStyleInput(bare, 3) }).prompt;
    expect(p).toContain("• Composition: follow the layout of the attached reference images");
  });

  it("restyles a prompt the browser built without the style", () => {
    const plain = buildImagePromptDetailed(base).prompt;
    expect(plain).toContain("#123456");
    const p = restyleImagePrompt(plain, imageStyleInput(style, 2)!);
    expect(p.startsWith('BRAND STYLE "Launch"')).toBe(true);
    expect(p).toContain("primary #ffb400");
    expect(p).not.toContain("#123456");
    expect(p).not.toContain("EXACT brand palette");
    // The seeded layout is gone; the only layout left is the style's own.
    const seeded = plain.split("\n").find((l) => l.startsWith("• Composition:"))!;
    expect(p).not.toContain(seeded);
    expect(p).toContain("• Composition: headline top left");
    expect(p).not.toContain("derived from brand voice");
    expect(p).toContain("max 4 words");
    expect(p).not.toContain("max 6 words");
    // The brief itself is untouched.
    expect(p).toContain("Our new feature ships today");
    expect(p).toContain("GUARDRAILS:");
  });

  it("only leads a prompt it doesn't recognise", () => {
    const p = restyleImagePrompt("A photo of a red bicycle", imageStyleInput(style)!);
    expect(p.startsWith('BRAND STYLE "Launch"')).toBe(true);
    expect(p.endsWith("A photo of a red bicycle")).toBe(true);
  });
});
