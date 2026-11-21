import { describe, expect, it } from "vitest";
import {
  briefIssues,
  briefSlideLines,
  carouselSlidesLine,
  describeSettings,
  fitBriefSlides,
} from "./prompt-writer";
import { normalizeSlides } from "./carousel/story";
import { ANGLES, buildCarouselPrompt, emptyContext } from "./prompts";

// The 2026-11-17 bug: 6 slides picked, Surprise me wrote 6 inside slides plus
// a cover and a last slide (8), and the carousel came out with 8.
const eightSlideBrief = [
  "Idea: Why slow mornings sell more coffee",
  "Cover: Your slow morning, sorted — for busy parents",
  "Slides:",
  ...[1, 2, 3, 4, 5, 6].map((n) => `Slide ${n}: Point ${n} — a short line`),
  "Last slide: Try the 8-slide guide — order today",
  "Caption: A calmer start.",
].join("\n");

describe("carousel slide count", () => {
  it("tells the brief writer the exact split", () => {
    expect(carouselSlidesLine(6)).toBe("6 in total: the cover, 4 inside slides and the last slide");
    expect(describeSettings("carousel", { slideCount: 6 })).toContain("Slides: 6 in total");
    expect(describeSettings("carousel", {})).toContain("Slides: 6 in total");
  });

  it("flags a brief that lists too many slides", () => {
    const issues = briefIssues({
      prompt: eightSlideBrief,
      type: "carousel",
      known: "",
      slideCount: 6,
    });
    expect(issues.join(" ")).toMatch(/lists 6 slides but the carousel has 4 inside slides/);
  });

  it("trims and renumbers the brief to the stepper", () => {
    const fitted = fitBriefSlides(eightSlideBrief, 6);
    expect(briefSlideLines(fitted)).toBe(4);
    expect(fitted).toContain("Slide 2: Point 1");
    expect(fitted).toContain("Slide 5: Point 4");
    expect(fitted).not.toContain("Point 5");
    expect(fitted).toContain("6-slide guide");
    expect(fitBriefSlides(eightSlideBrief, 8)).toContain("Slide 7: Point 6");
  });

  it("keeps the slides to the count picked, with the close last", () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ heading: `Heading ${i + 1}`, body: "x" }));
    const slides = normalizeSlides(raw, 6);
    expect(slides).toHaveLength(6);
    expect(slides[0].role).toBe("cover");
    expect(slides[5].heading).toBe("Heading 8");
    expect(slides[5].role).toBe("cta");
    expect(normalizeSlides(raw.slice(0, 5), 6)).toHaveLength(5);
  });

  it("tells the carousel writer the picked count wins over the brief", () => {
    const prompt = buildCarouselPrompt({
      ctx: { ...emptyContext("Bench Cafe"), industry: "Cafe", brandText: "A cosy cafe." },
      intent: { brief: eightSlideBrief, goal: "awareness" } as never,
      controls: { platforms: ["instagram"], slideCount: 6 } as never,
      angle: ANGLES[0],
    });
    expect(prompt.system).toContain("Write exactly 6 slides");
    expect(prompt.system).toContain("6 wins");
  });
});
