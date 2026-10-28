import { describe, expect, it } from "vitest";
import { carouselSlidePrompt, storyFramePrompt } from "./visual-prompts.server";

describe("complete model-generated series prompts", () => {
  const common = {
    index: 0,
    brandName: "North Coffee",
    brandContext: "North Coffee sells single-origin beans and does not claim medical benefits.",
    style: {
      name: "Editorial",
      block: "Warm paper, natural morning light and documentary photography.",
      colors: ["#d6bc9a"],
      fonts: ["Inter"],
      references: { count: 2, strength: "close" as const },
    },
    spec: undefined,
  };

  it("directs the image model to finish every carousel slide with exact copy", () => {
    const slide = {
      heading: "From farm to cup",
      body: "Meet the growers behind each bag.",
      role: "cover" as const,
    };
    const prompt = carouselSlidePrompt({ ...common, ratio: "4:5", slide, slides: [slide] });
    expect(prompt).toContain('Exact headline to typeset: "From farm to cup"');
    expect(prompt).toContain('Exact supporting copy: "Meet the growers behind each bag."');
    expect(prompt).toContain("complete 4:5 social post frame");
    expect(prompt).toContain("Warm paper, natural morning light");
    expect(prompt).toContain("attached visual reference(s)");
    const enriched = carouselSlidePrompt({
      ...common,
      ratio: "4:5",
      slide,
      slides: [slide],
      visualTasteRules: "Follow the approved warm documentary treatment.",
    });
    // Removing the new layer gives the exact original prompt, including its copy/context.
    expect(enriched.replace("Follow the approved warm documentary treatment.\n\n", "")).toBe(
      prompt,
    );
  });

  it("reserves Story safe zones for native controls", () => {
    const frame = {
      role: "hook" as const,
      heading: "Morning starts here",
      body: "Our new roast is here.",
    };
    const prompt = storyFramePrompt({ ...common, frame, frames: [frame] });
    expect(prompt).toContain("top 15% and bottom 20% clear");
    expect(prompt).toContain('Exact headline: "Morning starts here"');
    expect(prompt).toContain("Do not draw simulated app controls");
    expect(prompt).toContain("QUALITY CHECK BEFORE FINALIZING");
  });

  it("sets slide copy as verbatim data with the brand's emphasis and a final check", () => {
    const slides = [
      { heading: "5 roasting myths", body: "", role: "cover" as const, emphasis: "myths" },
      {
        heading: "Darker is not stronger",
        body: "Caffeine barely changes with roast.",
        kicker: "Myth 1",
        role: "point" as const,
        emphasis: "not stronger",
      },
      { heading: "Taste before you buy", body: "", role: "cta" as const },
    ];
    const cover = carouselSlidePrompt({ ...common, style: null, slide: slides[0], slides });
    const inside = carouselSlidePrompt({
      ...common,
      style: null,
      index: 1,
      slide: slides[1],
      slides,
    });
    expect(cover).toContain("TEXT — RENDER VERBATIM");
    expect(cover).toContain("DELIVERABLE — Tips or how-to cover");
    expect(cover).toContain("ART DIRECTION");
    expect(inside).not.toContain("ART DIRECTION");
    expect(inside).toContain('Exact small label: "Myth 1"');
    expect(inside).toContain("Use exactly these 3 lines");
    expect(inside).toContain('Emphasis: the words "not stronger"');
    expect(inside).toContain("Type scale");
    expect(inside.trim().endsWith("Never fix it by adding.")).toBe(true);
  });

  it("asks a composed Story frame for no letters", () => {
    const frame = { role: "hook" as const, heading: "Morning starts here", body: "" };
    const prompt = storyFramePrompt({ ...common, frame, frames: [frame], noText: true });
    expect(prompt).toContain("No letters, numbers or logos anywhere");
    expect(prompt).not.toContain("Type scale");
  });
});
