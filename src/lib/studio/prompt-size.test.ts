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
// The post writer is brief-first (ADR-0051). ADR-0052 added the concept round
// and the house craft (three ideas scored before one is written): about 7.5k,
// ceiling 8k, roughly $0.002 more per post on Sonnet.
const SYSTEM_MAX_CHARS = { social: 9000, carousel: 10000, ad: 10000, image: 8000, meme: 12000 };

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
    // Memes are retired (categories.ts): a retired kind is never resolved, so
    // the meme concept route is no longer reached from a picked kind.
  });
  it("sends the director no style menus or layout lists", () => {
    // ADR-0051 round 3: the director writes the picture itself; menus of
    // styles and layouts made every post a template.
    const { system, user } = buildVisualBriefPrompt({ ...base("product"), medium: "image" });
    expect(user).not.toContain("## Post styles");
    expect(user).not.toContain("Layout");
    expect(system).toContain("image prompt");
    expect(user).toContain("Our new oat latte");
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
