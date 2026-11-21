import { describe, expect, it } from "vitest";
import { sentWords } from "@/lib/studio/creative-knowledge";
import { carouselCredits } from "@/lib/studio/billing";
import { cr } from "@/lib/billing/catalog";
import { carouselSlidePrompt, postImagePrompt } from "./visual-prompts.server";

// ADR-0051 round 3: a post's picture prompt is the director's prose plus only
// the exact words, the canvas and the logo corner.
describe("postImagePrompt", () => {
  const big = {
    brandName: "Northwind Coffee",
    concept: "A real photograph of a barista at work, headline on the dark band below. ".repeat(60),
    headline: "Join our roasting team",
    lines: ["Gulberg branch, Lahore", "eyebrow: Apply by Dec 5", "A third line is dropped"],
    ratio: "4:5",
    logoCorner: "bottom-right",
  };

  it("stays short, and never adds style recipes or checklists", () => {
    const prompt = postImagePrompt(big);
    expect(prompt.length).toBeLessThanOrEqual(3400);
    expect(prompt).not.toMatch(/POST STYLE|QUALITY CHECK|Type scale|BRAND STYLE/);
  });

  it("sends the exact words (two lines at most), and the review reads back the same words", () => {
    const prompt = postImagePrompt(big);
    expect(sentWords(prompt)).toEqual([
      "Join our roasting team",
      "Gulberg branch, Lahore",
      "Apply by Dec 5",
    ]);
  });

  it("keeps the logo corner clear and draws no logo", () => {
    expect(postImagePrompt(big)).toContain("bottom-right corner clear");
  });

  it("sends no words when the picture must carry none", () => {
    const prompt = postImagePrompt({ ...big, noText: true });
    expect(sentWords(prompt)).toBeNull();
    expect(prompt).not.toContain("Join our roasting team");
  });
});

describe("carousel price", () => {
  it("is one credit for the cover and ¾ per extra slide, rounded up to a half credit", () => {
    expect(carouselCredits({ slideCount: 6 })).toBe(cr(5));
    expect(carouselCredits({ slideCount: 3 })).toBe(cr(2.5));
    expect(carouselCredits({ slideCount: 10 })).toBe(cr(8));
  });
});

describe("director carousel slide", () => {
  const slides = [
    { role: "cover", heading: "Brew better pour-over", body: "" },
    {
      role: "point",
      heading: "Rinse the filter",
      body: "Hot water first, so the paper taste goes.",
      kicker: "Step 1",
    },
    { role: "cta", heading: "Try it this weekend", body: "" },
  ] as never[];
  const slide = (index: number) =>
    carouselSlidePrompt({
      slide: {
        ...(slides[index] as object),
        visual: "Hands rinsing a paper filter in a ceramic dripper, overhead.",
      } as never,
      index,
      slides,
      brandName: "Northwind Coffee",
      brandContext: "A coffee roaster.",
      ratio: "4:5",
      style: null,
      anchoredToCover: index > 0,
      look: "Cream #E9DCC3 background, one real photo in the top two thirds, heading in heavy dark green below.",
    });

  it("is the look, the slide's picture and its exact words, nothing else", () => {
    const prompt = slide(1);
    expect(prompt).toContain("Every slide shares one look: Cream #E9DCC3");
    expect(prompt).toContain("The first attached image is slide 1");
    expect(sentWords(prompt)).toEqual([
      "Step 1",
      "Rinse the filter",
      "Hot water first, so the paper taste goes.",
    ]);
    expect(prompt).not.toMatch(/CAROUSEL STYLE|QUALITY CHECK|Type scale|surreal/);
    expect(prompt.length).toBeLessThan(2600);
  });

  it("never anchors the cover on itself", () => {
    expect(slide(0)).not.toContain("The first attached image is slide 1");
  });
});
