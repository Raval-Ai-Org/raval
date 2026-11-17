import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "@/lib/studio/art-direction";
import { sentWords } from "@/lib/studio/creative-knowledge";
import { carouselCredits } from "@/lib/studio/billing";
import { cr } from "@/lib/billing/catalog";
import { postImagePrompt } from "./visual-prompts.server";

// ADR-0051: a post's picture prompt is short and coherent like a Story's,
// never cut at the image model's 10,000 characters.
describe("postImagePrompt", () => {
  const big = {
    brandName: "Northwind Coffee",
    concept: "A warm, editorial hiring poster. ".repeat(120),
    layout: ARCHETYPES[0]?.id,
    deliverable: "hiring" as const,
    headline: "Join our roasting team",
    lines: [
      "eyebrow: Now hiring",
      "body: Two roaster roles open in Lahore, apply by Dec 5.",
      "button: Apply now",
    ],
    ratio: "4:5",
    style: null,
    palette: ["#1F2A1C", "#E9DCC3", "#C2410C"],
    fonts: ["Space Grotesk", "Inter"],
    visualTasteRules: "Keep it calm and editorial. ".repeat(100),
    logoCorner: "bottom-right",
    avoidLayouts: ["product-world", "oversized-object"],
    emphasisSeed: "seed",
  };

  it("stays far under the 10,000 cut with maximum inputs", () => {
    expect(postImagePrompt(big).length).toBeLessThanOrEqual(6500);
  });

  it("sends the exact words, and the review reads back the same words", () => {
    const prompt = postImagePrompt(big);
    expect(prompt).toContain('"Join our roasting team"');
    expect(sentWords(prompt)).toEqual([
      "Join our roasting team",
      "Now hiring",
      "Two roaster roles open in Lahore, apply by Dec 5.",
      "Apply now",
    ]);
  });

  it("never asks for type behind the subject", () => {
    expect(postImagePrompt(big).toLowerCase()).not.toContain("behind the subject");
  });

  it("sends no words when the picture must carry none", () => {
    const prompt = postImagePrompt({ ...big, noText: true });
    expect(sentWords(prompt)).toBeNull();
    expect(prompt).not.toContain("Join our roasting team");
  });
});

describe("carousel price", () => {
  it("is one credit for the cover and half a credit per extra slide", () => {
    expect(carouselCredits({ slideCount: 6 })).toBe(cr(3.5));
    expect(carouselCredits({ slideCount: 3 })).toBe(cr(2));
    expect(carouselCredits({ slideCount: 10 })).toBe(cr(5.5));
  });
});
