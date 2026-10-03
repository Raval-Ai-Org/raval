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
  });
});
