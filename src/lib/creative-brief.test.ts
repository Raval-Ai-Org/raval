import { describe, expect, it } from "vitest";
import { deriveCreativeBrief, validateCreativeBrief } from "./creative-brief";

describe("creative brief", () => {
  it("derives conversion strategy from commercial intent", () => {
    const brief = deriveCreativeBrief({
      body: "Book a demo and see the new offer",
      size: "1024x1024",
    });
    expect(brief.objective).toBe("conversion");
    expect(brief.funnel).toBe("bottom");
    expect(validateCreativeBrief(brief)).toHaveLength(3);
  });

  it("adds portrait platform chrome guidance", () => {
    const brief = deriveCreativeBrief({ body: "A practical insight", size: "1024x1792" });
    expect(brief.qaRules.at(-1)).toContain("UI-chrome");
  });
});
