import { describe, expect, it } from "vitest";
import { pickCarouselDesign } from "./design";
import { MAX_SLIDE_PHOTOS, assignPhotos, photoFrame, safePhotos } from "./photos";
import { carouselStoryIssue, normalizeSlides } from "./story";

const slides = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ heading: `Slide ${i + 1}`, body: "A body line." }));

describe("photos on carousel slides", () => {
  it("frames screens in a device and photos as photos", () => {
    expect(photoFrame({ width: 390, height: 844 }, true)).toBe("phone");
    expect(photoFrame({ width: 1440, height: 900 }, true)).toBe("browser");
    expect(photoFrame({ width: 1200, height: 800 }, false)).toBe("photo");
    expect(photoFrame({ width: 1080, height: 1350 }, false)).toBe("photo");
    // An unmarked very tall picture is a phone screenshot.
    expect(photoFrame({ width: 1170, height: 2532 }, false)).toBe("phone");
  });

  it("puts the first picture on the cover and keeps the last slide type-only", () => {
    const placed = assignPhotos(slides(6), 3);
    expect(placed.map((s) => s.photo)).toEqual([0, 1, 2, undefined, undefined, undefined]);
    const crowded = assignPhotos(slides(4), 6);
    expect(crowded.map((s) => s.photo)).toEqual([0, 1, 2, undefined]);
  });

  it("clears pictures from slides when there are none", () => {
    const placed = assignPhotos(
      slides(3).map((s, i) => ({ ...s, photo: i })),
      0,
    );
    expect(placed.every((s) => s.photo === undefined)).toBe(true);
  });

  it("keeps only well-formed stored photos, and at most the limit", () => {
    const good = { path: "ws/a.png", width: 1000, height: 800, frame: "photo" };
    expect(
      safePhotos([
        good,
        { ...good, frame: "poster" },
        { ...good, path: "" },
        { ...good, width: -1 },
        "nope",
        null,
      ]),
    ).toEqual([good]);
    expect(safePhotos(Array(10).fill(good))).toHaveLength(MAX_SLIDE_PHOTOS);
    expect(safePhotos({ path: "x" })).toEqual([]);
  });

  it("keeps a slide's picture index through normalizing, and only a sensible one", () => {
    const [a, b, c] = normalizeSlides(
      [
        { heading: "One", body: "A body line long enough to count.", photo: 0 },
        { heading: "Two", body: "A body line long enough to count.", photo: 9 },
        { heading: "Three", body: "A body line long enough to count.", photo: 1.5 },
      ],
      3,
    );
    expect(a.photo).toBe(0);
    expect(b.photo).toBeUndefined();
    expect(c.photo).toBeUndefined();
  });
});

describe("type-led carousels", () => {
  it("draws a reveal or an intro in the swiss look, always light", () => {
    for (const structure of ["reveal", "intro"])
      for (const seed of ["a", "b", "c", "d"]) {
        const design = pickCarouselDesign({ seed, structure, profileKey: seed });
        expect(design.look).toBe("swiss");
        expect(design.colorway).toBe("light");
      }
  });

  it("gives a running joke its corner glow", () => {
    const design = pickCarouselDesign({ seed: "x", structure: "running-joke", profileKey: "x" });
    expect(design.motif).toBe("glow");
  });

  it("never gives an ordinary carousel the swiss look by chance", () => {
    for (let i = 0; i < 40; i++)
      expect(pickCarouselDesign({ seed: `s${i}`, profileKey: `b${i}` }).look).not.toBe("swiss");
  });

  it("refuses a cover that promises more slides than there are", () => {
    const story = normalizeSlides(
      [
        { heading: "8 slides on naming a brand", body: "Swipe through." },
        ...slides(5).map((s) => ({ ...s, body: "A body line that is long enough to read." })),
      ],
      6,
    );
    expect(carouselStoryIssue(story)).toMatch(/8/);
  });
});
