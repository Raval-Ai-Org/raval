import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_GROUPS,
  CATEGORY_IDS,
  MEME_LAYOUTS,
  TEMPLATE_CATEGORY,
  categoriesFor,
  categoryById,
  categorySection,
  pickCategory,
  resolveCategory,
} from "./categories";
import { getCarouselStructure, pickCarouselStructure } from "./carousel/story";
import { getTemplate } from "./templates";
import { findRepeatedJoke, outputJoke, recentMemeLayouts } from "./novelty";
import { memorySection } from "./memory";
import { buildImagePromptDetailed } from "../post-image";
import type { StudioContext } from "./prompts";

type Recent = StudioContext["recent"];
const past = (over: Partial<Recent[number]>): Recent[number] => ({
  title: "Earlier post",
  type: "image",
  channel: "instagram",
  angle: null,
  createdAt: "2026-11-01",
  ...over,
});

describe("categories", () => {
  it("has one entry per stored id, each in a real group", () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([...CATEGORY_IDS].sort());
    const groups = new Set(CATEGORY_GROUPS.map((g) => g.id));
    for (const c of CATEGORIES) {
      expect(groups.has(c.group)).toBe(true);
      expect(c.formats.length).toBeGreaterThan(0);
      expect(c.write.length).toBeGreaterThan(0);
    }
  });

  it("only names carousel structures that exist", () => {
    for (const c of CATEGORIES) {
      if (c.carouselStructure) expect(getCarouselStructure(c.carouselStructure)).not.toBeNull();
    }
  });

  it("maps only real templates to real categories", () => {
    for (const [template, category] of Object.entries(TEMPLATE_CATEGORY)) {
      expect(getTemplate(template), template).toBeTruthy();
      expect(categoryById(category), category).toBeTruthy();
    }
  });

  it("a person's pick wins over the template's", () => {
    expect(resolveCategory({ category: "meme", template: "image-product-hero" })?.id).toBe("meme");
    expect(resolveCategory({ template: "image-meme" })?.id).toBe("meme");
    expect(resolveCategory({})).toBeNull();
  });

  it("an automatic pick suits the format and skips the last two", () => {
    for (let i = 0; i < 40; i++) {
      const picked = pickCategory({
        type: "carousel",
        goal: "engagement",
        recent: ["meme", "relatable"],
        seed: `s${i}`,
      });
      expect(picked.formats).toContain("carousel");
      expect(["meme", "relatable"]).not.toContain(picked.id);
    }
  });

  it("Auto never makes a meme, for any goal or format", () => {
    const goals = ["offer", "launch", "leads", "education", "engagement", "awareness"] as const;
    for (const type of ["image", "carousel", "story", "social"] as const)
      for (const goal of goals)
        for (let i = 0; i < 30; i++)
          expect(pickCategory({ type, goal, seed: `${type}${goal}${i}` }).id).not.toBe("meme");
  });

  it("the picker lists only what a format can make", () => {
    for (const c of categoriesFor("image")) expect(c.formats).toContain("image");
  });

  it("a meme carousel follows the meme structure", () => {
    const s = pickCarouselStructure({
      brief: "a few jokes",
      seed: "x",
      category: "meme",
    } as Parameters<typeof pickCarouselStructure>[0]);
    expect(s.id).toBe(categoryById("meme")!.carouselStructure);
  });

  it("fun categories carry the viral and new-joke rules", () => {
    expect(categorySection(categoryById("meme"), "image")).toMatch(/brand-new joke/i);
    expect(categorySection(categoryById("sale"), "image")).not.toMatch(/brand-new joke/i);
  });
});

describe("no joke twice", () => {
  const recent: Recent = [
    past({
      title: "Monday coffee meme",
      joke: "me at 9am / me after one sip of our cold brew",
      memeLayout: "top-bottom",
    }),
    past({ title: "Older", memeLayout: "pov" }),
    past({ title: "Oldest", memeLayout: "tweet" }),
  ];

  it("refuses the same joke, reworded or with the same punchline", () => {
    expect(
      findRepeatedJoke(
        { onImageLines: ["me at 9am", "me after one sip of our cold brew"] },
        recent,
      ),
    ).not.toBeNull();
    expect(
      findRepeatedJoke(
        { onImageLines: ["my boss on friday", "me after one sip of our cold brew"] },
        recent,
      ),
    ).not.toBeNull();
  });

  it("lets a new joke through", () => {
    expect(
      findRepeatedJoke(
        { onImageLines: ["nobody:", "me checking the oven light every 30 seconds"] },
        recent,
      ),
    ).toBeNull();
  });

  it("stores the joke and lists it as taken", () => {
    expect(outputJoke({ onImageLines: ["a", "b"] })).toBe("a / b");
    expect(memorySection(recent)).toContain("me after one sip of our cold brew");
  });

  it("rotates the meme layout away from the last two", () => {
    expect(recentMemeLayouts(recent)).toEqual(["top-bottom", "pov"]);
  });
});

describe("meme image prompt", () => {
  const meme = categoryById("meme")!;
  const layout = MEME_LAYOUTS[0];
  const base = {
    postBody: "Cold brew for people who hate mornings.",
    postTitle: "Cold brew",
    brand: { brandName: "Bean Co", colors: [{ name: "Ink", hex: "#111111" }] },
    workspaceName: "Bean Co",
    platform: "instagram" as const,
    size: "1024x1024" as const,
    seedKey: "k",
  };

  it("draws the scene first and sets the meme lines exactly", () => {
    const lines = layout.lines.map((_, i) => `line ${i + 1} words`);
    const { prompt } = buildImagePromptDetailed({
      ...base,
      scene: "A tired fictional man stares at an empty mug in a small kitchen.",
      category: meme,
      memeLayout: layout.id,
      onImageLines: lines,
    });
    expect(prompt.indexOf("tired fictional man")).toBeGreaterThan(-1);
    for (const l of lines) expect(prompt).toContain(l);
    expect(prompt).not.toMatch(/premium/i);
  });

  it("a scene makes a shorter prompt than none", () => {
    const withScene = buildImagePromptDetailed({ ...base, scene: "A cup on a desk." }).prompt;
    const without = buildImagePromptDetailed(base).prompt;
    expect(withScene.length).toBeLessThanOrEqual(without.length + 200);
  });
});
