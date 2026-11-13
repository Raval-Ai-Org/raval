import { describe, expect, it } from "vitest";
import { capBlock } from "./caps";
import {
  ANGLES,
  buildAdPrompt,
  buildCarouselPrompt,
  buildSocialPrompt,
  buildVisualBriefPrompt,
  emptyContext,
} from "./prompts";

// The system prompt is the part every call pays for; these ceilings keep a
// new rule from quietly doubling the bill (Round 5). Raise one only with a reason.
const SYSTEM_MAX_CHARS = { social: 9000, carousel: 10000, ad: 10000, image: 13000, meme: 12000 };

function base(category: string | null, goal = "awareness") {
  return {
    ctx: {
      ...emptyContext("Bench Cafe"),
      industry: "Cafe",
      brandText: "A cosy cafe serving coffee.",
    },
    intent: { brief: "Our new oat latte", goal, ...(category ? { category } : {}) } as never,
    controls: { platforms: ["instagram"] } as never,
    angle: ANGLES[0],
  };
}

describe("system prompt size", () => {
  it("stays under each ceiling", () => {
    expect(buildSocialPrompt(base("sale", "offer")).system.length).toBeLessThan(
      SYSTEM_MAX_CHARS.social,
    );
    expect(buildCarouselPrompt(base("tips")).system.length).toBeLessThan(SYSTEM_MAX_CHARS.carousel);
    expect(buildAdPrompt(base("sale", "offer")).system.length).toBeLessThan(SYSTEM_MAX_CHARS.ad);
    expect(
      buildVisualBriefPrompt({ ...base("product"), medium: "image" }).system.length,
    ).toBeLessThan(SYSTEM_MAX_CHARS.image);
    const meme = buildVisualBriefPrompt({ ...base("meme"), medium: "image" });
    expect(meme.route).toBe("studio.meme.concept");
    expect(meme.system.length).toBeLessThan(SYSTEM_MAX_CHARS.meme);
  });
  it("sends a shortlist of layouts, not all of them", () => {
    const { system } = buildVisualBriefPrompt({ ...base("product"), medium: "image" });
    const menu = system.split("\n").filter((l) => /^- [a-z-]+: .+Best for/.test(l));
    expect(menu.length).toBeLessThanOrEqual(8);
  });
});

describe("capBlock", () => {
  it("cuts at a line boundary", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} of the block`).join("\n");
    const cut = capBlock(text, 200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("block")).toBe(true);
  });
});
