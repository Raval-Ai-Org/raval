import { describe, expect, it } from "vitest";
import { deriveCreativeBrief } from "./creative-brief";
import { evaluateCreativePreflight, refinementInstructions } from "./creative-qa";
import { deriveCreativeStrategy, hasMeaningfulDiversity } from "./creative-strategy";

const brief = deriveCreativeBrief({ body: "", size: "1024x1024" });

describe("creative intelligence engine", () => {
  it("changes strategy and format for conversion", () => {
    const strategy = deriveCreativeStrategy({
      body: "Book a demo of our new platform",
      brief,
      size: "1024x1024",
    });
    expect(strategy.objective).toBe("conversion");
    expect(strategy.format).toBe("product-focused");
    expect(strategy.ctaStrategy).toBe("direct");
  });

  it("creates materially different concepts for variants", () => {
    const variants = [0, 1, 2].map((variation) =>
      deriveCreativeStrategy({
        body: "A memorable brand idea",
        brief,
        size: "1024x1024",
        variation,
      }),
    );
    expect(hasMeaningfulDiversity(variants)).toBe(true);
  });

  it("diagnoses missing portrait crop guidance and returns a targeted fix", () => {
    const strategy = deriveCreativeStrategy({ body: "Book a demo", brief, size: "1024x1792" });
    const qa = evaluateCreativePreflight({
      strategy,
      prompt: "Create a product image",
      size: "1024x1792",
      brandPresent: false,
      attempt: 1,
    });
    expect(qa.issues.map((issue) => issue.code)).toContain("PLATFORM_CROP");
    expect(refinementInstructions(qa).join(" ")).toContain("safe-area");
  });
});
