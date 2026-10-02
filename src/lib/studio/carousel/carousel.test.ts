import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/color";
import {
  CAROUSEL_COLORWAYS,
  availableColorways,
  canRenderText,
  carouselTheme,
  pickCarouselDesign,
  safeDesign,
  safeTheme,
  slideColors,
} from "./design";
import {
  CAROUSEL_STRUCTURES,
  carouselStoryIssue,
  normalizeSlides,
  pickCarouselStructure,
  pointNumber,
  slidePlan,
  withRoles,
} from "./story";

const good = [
  { heading: "Your cold brew goes flat by day three", body: "For Sunday batch makers." },
  {
    heading: "Flat coffee is an oxygen problem",
    body: "Every time the jar opens, air gets in and the bright notes go first.",
  },
  {
    heading: "Grind coarser than you think",
    body: "Fine grounds keep extracting after you strain, so bitterness keeps building.",
    kicker: "Step 1",
    emphasis: "coarser",
  },
  {
    heading: "Strain it twice",
    body: "A metal sieve first, then paper to catch the fines that turn it muddy.",
    kicker: "Step 2",
  },
  { heading: "Save this for Sunday", body: "Then tell us how day five tastes." },
];

describe("carousel story", () => {
  it("gives every position a role, with a recap only when there is room", () => {
    expect(slidePlan(3)).toEqual(["cover", "point", "cta"]);
    expect(slidePlan(5)).toEqual(["cover", "context", "point", "point", "cta"]);
    expect(slidePlan(7)[5]).toBe("recap");
    expect(slidePlan(7)[6]).toBe("cta");
  });

  it("forces the cover and the close whatever the model says", () => {
    const slides = normalizeSlides(
      good.map((s, i) => ({ ...s, role: i === 0 ? "point" : i === 4 ? "context" : "cta" })),
      5,
    );
    expect(slides[0].role).toBe("cover");
    expect(slides[4].role).toBe("cta");
    expect(slides.slice(1, 4).every((s) => s.role !== "cta" && s.role !== "cover")).toBe(true);
  });

  it("drops emoji and highlights only words that are in the heading", () => {
    const [a, b] = normalizeSlides(
      [
        { heading: "Grind coarser 🚀 than you think", body: "x", emphasis: "COARSER" },
        { heading: "Strain it twice", body: "y", emphasis: "filter" },
        { heading: "End", body: "z" },
      ],
      3,
    );
    expect(a.heading).toBe("Grind coarser than you think");
    expect(a.emphasis).toBe("coarser");
    expect(b.emphasis).toBeUndefined();
  });

  it("numbers point slides in order and nothing else", () => {
    const slides = normalizeSlides(good, 5);
    expect(pointNumber(slides, 0)).toBeNull();
    expect(pointNumber(slides, 1)).toBeNull();
    expect(pointNumber(slides, 2)).toBe(1);
    expect(pointNumber(slides, 3)).toBe(2);
    expect(pointNumber(slides, 4)).toBeNull();
  });

  it("gives old slides roles without inventing a recap", () => {
    const old = Array.from({ length: 7 }, (_, i) => ({ heading: `Slide ${i}`, body: "text" }));
    const roles = withRoles(old).map((s) => s.role);
    expect(roles[0]).toBe("cover");
    expect(roles[6]).toBe("cta");
    expect(roles).not.toContain("recap");
  });

  it("accepts a connected carousel and names what is wrong with a broken one", () => {
    const slides = normalizeSlides(good, 5);
    expect(carouselStoryIssue(slides)).toBeNull();
    expect(carouselStoryIssue([slides[0], slides[2], { ...slides[2] }, slides[4]])).toMatch(
      /same heading/,
    );
    expect(
      carouselStoryIssue([
        slides[0],
        slides[2],
        { ...slides[3], heading: "Go coarser", body: slides[2].body },
        slides[4],
      ]),
    ).toMatch(/same thing/);
    expect(
      carouselStoryIssue([slides[0], { ...slides[2], body: "Too short." }, slides[4]]),
    ).toMatch(/too thin/);
  });

  it("follows the template, else avoids the structures used lately", () => {
    expect(pickCarouselStructure({ seed: "a", template: "carousel-myth-fact" }).id).toBe("myths");
    const recent = ["steps", "framework"];
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const picked = pickCarouselStructure({ seed, angleId: "how-to", recent });
      expect(picked.id).toBe("checklist");
    }
    expect(pickCarouselStructure({ seed: "a", preferred: "story", recent: ["story"] }).id).toBe(
      "story",
    );
    expect(new Set(CAROUSEL_STRUCTURES.map((s) => s.id)).size).toBe(CAROUSEL_STRUCTURES.length);
  });
});

describe("carousel design", () => {
  const palette = { primary: "#1f5f4a", secondary: "#f2b84b", accent: "#e4572e" };

  it("keeps one look per brand and never repeats the last carousel's colourway or motif", () => {
    let previous: { colorway?: string; motif?: string }[] = [];
    const looks = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const design = pickCarouselDesign({
        profileKey: "ws-1",
        seed: `job-${i}`,
        previous,
        palette,
      });
      looks.add(design.look);
      if (previous[0]) {
        expect(design.colorway).not.toBe(previous[0].colorway);
        expect(design.motif).not.toBe(previous[0].motif);
      }
      previous = [design, ...previous];
    }
    expect(looks.size).toBe(1);
  });

  it("keeps text readable in every colourway, including the closing slide", () => {
    for (const colors of [palette, { primary: "#ffe14d" }, { primary: "#0a0a0a" }, {}]) {
      for (const colorway of CAROUSEL_COLORWAYS) {
        const theme = carouselTheme({ palette: colors, colorway });
        expect(contrastRatio(theme.ink, theme.bg)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(theme.accent, theme.bg)).toBeGreaterThanOrEqual(2.5);
        expect(contrastRatio(theme.accentInk, theme.accent)).toBeGreaterThanOrEqual(4.5);
        const close = slideColors(theme, "cta");
        expect(contrastRatio(close.ink, close.bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("does not offer a brand canvas for a near-white or near-black brand colour", () => {
    expect(availableColorways(palette)).toContain("brand");
    expect(availableColorways({ primary: "#ffffff" })).not.toContain("brand");
    expect(availableColorways({ primary: "#050505" })).not.toContain("brand");
  });

  it("maps any font name to a real catalogue family", () => {
    const theme = carouselTheme({ fonts: { heading: "Helvetica Neue Bold" }, colorway: "light" });
    expect(theme.headingFont).toBe("Inter");
    expect(theme.bodyFont).toBe("Inter");
  });

  it("refuses stored looks that are not well-formed", () => {
    expect(safeDesign({ look: "bold", colorway: "dark", motif: "wave" })).toEqual({
      v: 1,
      look: "bold",
      colorway: "dark",
      motif: "wave",
    });
    expect(safeDesign({ look: "x", colorway: "dark", motif: "wave" })).toBeNull();
    expect(safeTheme({ bg: "url(javascript:1)", ink: "#000000", accent: "#ff0000" })).toBeNull();
    const theme = safeTheme({ bg: "#fff", ink: "#000000", accent: "#ff0000", headingFont: "x'y" });
    expect(theme?.bg).toBe("#ffffff");
    expect(theme?.headingFont).not.toContain("'");
  });

  it("knows which scripts the slide fonts can draw", () => {
    expect(canRenderText("Café déjà vu — “quoted” 50% €10")).toBe(true);
    expect(canRenderText("Привет")).toBe(true);
    expect(canRenderText("مرحبا")).toBe(false);
    expect(canRenderText("नमस्ते")).toBe(false);
    expect(canRenderText("你好")).toBe(false);
  });
});
