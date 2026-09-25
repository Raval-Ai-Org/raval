// The Style reaches the generators: Studio text prompts, image prompts, UGC.
import { describe, expect, it } from "vitest";
import { buildArticlePrompt, buildSocialPrompt, emptyContext } from "@/lib/studio/prompts";
import { buildImagePromptDetailed } from "@/lib/post-image";
import { buildVideoPrompt } from "@/lib/ugc/prompt";
import { resolveStyle } from "./resolve";
import { imageStyleInput, styleProtectedTerms, ugcStyleNotes } from "./prompt";

const style = resolveStyle(
  { brandName: "Acme", colors: [{ name: "Primary", hex: "#ff5500" }], fonts: ["Poppins"] },
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Launch",
    version: 2,
    spec: {
      writing: {
        voice: "Short, punchy, founder-led",
        emoji: "none",
        bannedWords: ["synergy"],
        signaturePhrases: ["Ship it."],
        hashtags: { always: ["acme"] },
        perFormat: { article: "One H2 every 250 words" },
      },
      visual: {
        medium: "flat",
        mood: "bright and optimistic",
        textPlacement: "bottom",
        textOnImage: { maxWords: 3 },
        logo: { use: true, corner: "top-right" },
      },
      video: { pacing: "fast" },
      references: [{ assetId: "22222222-2222-4222-8222-222222222222", strength: "exact" }],
    },
  },
);

const args = (withStyle: boolean) => ({
  ctx: { ...emptyContext("Acme"), style: withStyle ? style : null },
  intent: { brief: "Announce our new feature" },
  controls: { platforms: ["linkedin" as const] },
  angle: { id: "how-to", label: "Practical how-to", directive: "Teach one thing." },
});

describe("Studio prompts", () => {
  it("carry the style section when a style is chosen", () => {
    const built = buildSocialPrompt(args(true) as never);
    expect(built.user).toContain("## Style (follow exactly)");
    expect(built.user).toContain("Short, punchy, founder-led");
    expect(built.user).toContain("Never use: synergy");
    expect(built.user).not.toContain("One H2 every 250 words");
  });

  it("use the per-format rules for articles", () => {
    const built = buildArticlePrompt(args(true) as never);
    expect(built.user).toContain("One H2 every 250 words");
  });

  it("are unchanged without a style", () => {
    const built = buildSocialPrompt(args(false) as never);
    expect(built.user).not.toContain("Style (follow exactly)");
  });
});

describe("image prompts", () => {
  const base = {
    postBody: "Our new feature ships today",
    brand: { brandName: "Acme", colors: [{ hex: "#123456" }], logoUrl: "https://x.test/l.png" },
    size: "1024x1024" as const,
    seedKey: "seed",
  };

  it("apply the style's palette, look, logo corner and word limit", () => {
    const p = buildImagePromptDetailed({ ...base, style: imageStyleInput(style, 2) }).prompt;
    expect(p).toContain('BRAND STYLE "Launch"');
    expect(p).toContain("#ff5500");
    expect(p).not.toContain("#123456");
    expect(p).toContain("Medium: flat");
    expect(p).toContain("top-right corner");
    expect(p).toContain("max 3 words");
    expect(p).toContain("REFERENCE IMAGES (2 attached)");
    expect(p).toContain("exact series");
  });

  it("are unchanged without a style", () => {
    const p = buildImagePromptDetailed(base).prompt;
    expect(p).not.toContain("BRAND STYLE");
    expect(p).toContain("#123456");
    expect(p).toContain("max 6 words");
  });

  it("drop text entirely when the style says so", () => {
    const noText = resolveStyle(null, {
      id: "x",
      name: "Clean",
      version: 1,
      spec: { visual: { textPlacement: "none" } },
    });
    const p = buildImagePromptDetailed({ ...base, style: imageStyleInput(noText) }).prompt;
    expect(p).toContain("NO text on the image at all");
  });
});

describe("UGC and naturalize", () => {
  it("adds the brand look to UGC renders", () => {
    const notes = ugcStyleNotes(style);
    expect(notes).toContain("fast pacing");
    expect(notes).toContain("#ff5500");
  });

  it("protects signature phrases and hashtags", () => {
    expect(styleProtectedTerms(style)).toEqual(["Ship it.", "#acme"]);
  });

  it("buildVideoPrompt prints BRAND LOOK", async () => {
    const { UGC_MODELS } = await import("@/lib/ugc/models");
    const model = Object.values(UGC_MODELS)[0];
    const { ProductSchema, BriefSchema } = await import("@/lib/ugc/schemas");
    const prompt = buildVideoPrompt({
      product: ProductSchema.parse({ name: "Widget" }),
      brief: BriefSchema.parse({}),
      script: {
        hook: "Hi",
        scenes: [
          {
            id: "s1",
            start: 0,
            end: 4,
            shot: "close",
            action: "",
            dialogue: "Hi",
            productPlacement: "",
            caption: "",
          },
        ],
        cta: "Buy",
      } as never,
      model,
      durationSec: 4,
      aspectRatio: "9:16",
      imageCount: 0,
      styleNotes: "mood calm",
    } as never);
    expect(prompt).toContain("BRAND LOOK: mood calm");
  });
});
