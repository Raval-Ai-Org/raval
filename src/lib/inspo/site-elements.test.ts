import { describe, expect, it } from "vitest";
import {
  effectiveStyles,
  pictureStyleLines,
  toggleStyle,
  cleanStyleIds,
} from "@/lib/brand-look/picture-styles";
import { pickRotationMedia, type RotationMedia } from "./media-rotation";
import {
  elementFits,
  elementKey,
  elementLabel,
  isElementCandidate,
  pickSiteElements,
} from "./site-elements";

describe("site art", () => {
  it("keeps big pictures and refuses logos, icons and svgs", () => {
    expect(
      isElementCandidate({ url: "https://a.com/astronaut.png", width: 600, height: 700 }),
    ).toBe(true);
    expect(isElementCandidate({ url: "https://a.com/logo.png", width: 600, height: 600 })).toBe(
      false,
    );
    expect(isElementCandidate({ url: "https://a.com/hero.svg", width: 900, height: 600 })).toBe(
      false,
    );
    expect(
      isElementCandidate({ url: "https://a.com/x.png", alt: "Visa icon", width: 400, height: 400 }),
    ).toBe(false);
    expect(isElementCandidate({ url: "https://a.com/band.jpg", width: 1400, height: 200 })).toBe(
      false,
    );
    expect(elementFits({ width: 200, height: 900 })).toBe(false);
    expect(elementFits({ width: 800, height: 900 })).toBe(true);
  });

  it("counts one picture once across sizes and pages", () => {
    expect(elementKey("https://www.a.com/img/hero-800.jpg")).toBe(
      elementKey("https://a.com/img/hero.jpg"),
    );
    const picked = pickSiteElements(
      [
        { url: "https://a.com/hero-800.jpg", width: 800, height: 600 },
        { url: "https://a.com/hero-1600.jpg", width: 1600, height: 1200 },
        { url: "https://a.com/mascot.png", width: 500, height: 500 },
      ],
      { seen: new Set([elementKey("https://a.com/mascot.png")]) },
    );
    expect(picked.map((p) => p.url)).toEqual(["https://a.com/hero-1600.jpg"]);
  });

  it("names a picture by its alt text, else its file", () => {
    expect(
      elementLabel({ url: "https://a.com/x.png", alt: "Astronaut waving", width: 1, height: 1 }),
    ).toBe("Astronaut waving");
    expect(elementLabel({ url: "https://a.com/anime-girl_hero.webp", width: 1, height: 1 })).toBe(
      "Site art · anime girl hero",
    );
  });
});

describe("Custom picture style", () => {
  const facts = { industry: "fintech app" };
  it("is what auto picks when the brand has its own design", () => {
    expect(effectiveStyles(null, facts, { ownDesign: true }).ids).toEqual(["custom"]);
    expect(effectiveStyles(null, facts).ids).not.toContain("custom");
    // A person's own template picks still win.
    expect(effectiveStyles({ styles: ["3d"] }, facts, { ownDesign: true }).ids).toEqual(["3d"]);
  });

  it("stands alone", () => {
    expect(toggleStyle(["3d", "people"], "custom")).toEqual(["custom"]);
    expect(toggleStyle(["custom"], "3d")).toEqual(["3d"]);
    expect(cleanStyleIds(["3d", "custom"])).toEqual(["custom"]);
  });

  it("carries the brand's own design into the prompt, never a template", () => {
    const line = pictureStyleLines(["custom"], "Anime watercolour world with a fox mascot.");
    expect(line).toContain("fox mascot");
    expect(line).not.toContain("3D render:");
  });
});

describe("site art in rotation", () => {
  const art: RotationMedia = {
    assetId: "a1",
    kind: "image",
    purpose: "element",
    lifetime: "permanent",
    addedAt: new Date().toISOString(),
  };
  const photo: RotationMedia = { ...art, assetId: "p1", purpose: "person" };
  it("draws site art into the picture and never mixes it with a photo", () => {
    let pick = null;
    for (let i = 0; i < 200 && !pick; i++)
      pick = pickRotationMedia({
        media: [art],
        uses: [],
        now: new Date(),
        format: "image",
        seed: `s${i}`,
        frequency: "often",
      });
    expect(pick?.mode).toBe("inspire");
    let mixed = null;
    for (let i = 0; i < 200 && !mixed; i++)
      mixed = pickRotationMedia({
        media: [photo, art],
        uses: [],
        now: new Date(),
        format: "carousel",
        seed: `m${i}`,
        frequency: "often",
      });
    expect(mixed?.assetIds.length).toBe(1);
  });
});
