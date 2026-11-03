import { describe, expect, it } from "vitest";
import { applyLean } from "./bias";
import { tasteBlock, tasteChips, tasteSummary } from "./block";
import { EMPTY_TASTE, type Traits } from "./contracts";
import { hasLean, learnTaste, lovesToLearn } from "./learn";
import { parseTraits, traitsOf } from "./traits";
import { HOOK_STYLES, consistencySection, pickHookStyle } from "@/lib/studio/memory";
import { pickAdFormat } from "@/lib/studio/ad-formats";
import { pickCarouselDesign } from "@/lib/studio/carousel/design";
import { archetypeMenu } from "@/lib/studio/art-direction";

const love = (traits: Traits) => ({ reaction: "love" as const, traits });
const less = (traits: Traits) => ({ reaction: "less" as const, traits });

describe("traitsOf", () => {
  it("reads only stored ids from the content row and the job", () => {
    const traits = traitsOf({
      meta: {
        studio_type: "carousel",
        platform: "instagram",
        hook_style: "question",
        angle: "how-to",
        aspect_ratio: "4:5",
        carousel: { structure: "steps", design: { colorway: "dark", motif: "wave" } },
      },
      job: {
        type: "carousel",
        input: { intent: { aim: "teach" }, controls: { ratio: "1:1" } },
        output: { artDirection: "monument-object", adFormat: "<script>" },
      },
    });
    expect(traits).toEqual({
      format: "carousel",
      platform: "instagram",
      aim: "teach",
      hook: "question",
      angle: "how-to",
      layout: "monument-object",
      colorway: "dark",
      motif: "wave",
      structure: "steps",
      ratio: "4:5",
    });
  });

  it("parses stored jsonb back to known kinds only", () => {
    expect(parseTraits({ format: "ad", nope: "x", hook: "  " })).toEqual({ format: "ad" });
    expect(parseTraits(null)).toEqual({});
  });
});

describe("learnTaste", () => {
  it("never learns from a single post", () => {
    const taste = learnTaste([love({ format: "carousel" }), less({ colorway: "dark" })]);
    expect(hasLean(taste)).toBe(false);
    expect(lovesToLearn(taste)).toBe(1);
  });

  it("learns liked and avoided values from two agreeing posts", () => {
    const taste = learnTaste([
      love({ format: "carousel", hook: "question" }),
      love({ format: "carousel", hook: "claim" }),
      less({ colorway: "dark" }),
      less({ colorway: "dark", format: "ad" }),
    ]);
    expect(taste.loves).toBe(2);
    expect(taste.lesses).toBe(2);
    expect(taste.lean.format).toEqual({ liked: ["carousel"], avoided: [] });
    expect(taste.lean.colorway).toEqual({ liked: [], avoided: ["dark"] });
    expect(taste.lean.hook).toBeUndefined();
    expect(lovesToLearn(taste)).toBe(0);
  });

  it("does not call something liked when it was passed on as often", () => {
    const taste = learnTaste([
      love({ format: "ad" }),
      love({ format: "ad" }),
      less({ format: "ad" }),
      less({ format: "ad" }),
    ]);
    expect(taste.lean.format?.liked ?? []).toEqual([]);
  });
});

describe("tasteBlock and chips", () => {
  const taste = learnTaste([
    love({ format: "carousel", hook: "question", motif: "orbit" }),
    love({ format: "carousel", hook: "question", motif: "orbit" }),
    less({ colorway: "dark" }),
    less({ colorway: "dark" }),
  ]);

  it("says nothing until something is learned", () => {
    expect(tasteBlock(EMPTY_TASTE)).toBe("");
    expect(tasteBlock(null)).toBe("");
  });

  it("names learned choices in plain words, never unlabelled ids", () => {
    const block = tasteBlock(taste);
    expect(block).toContain("Format: Carousel");
    expect(block).toContain("Opening: Opens with a question");
    expect(block).toContain("Carousel background: Dark backgrounds");
    expect(block).not.toContain("orbit");
    const chips = tasteChips(taste);
    expect(chips.map((c) => c.label)).toEqual([
      "Carousel",
      "Opens with a question",
      "Dark backgrounds",
    ]);
    expect(tasteSummary(taste).toLearn).toBe(0);
  });
});

describe("applyLean", () => {
  const items = ["a", "b", "c", "d"];
  const id = (s: string) => s;

  it("changes nothing without a taste", () => {
    expect(applyLean(items, null, "s", id)).toEqual(items);
  });

  it("drops avoided values but never empties the list", () => {
    expect(applyLean(items, { liked: [], avoided: ["b"] }, "s", id)).toEqual(["a", "c", "d"]);
    expect(applyLean(["b"], { liked: [], avoided: ["b"] }, "s", id)).toEqual(["b"]);
  });

  it("keeps loved values on most seeds and leaves the rest open", () => {
    let narrowed = 0;
    for (let i = 0; i < 300; i++) {
      const out = applyLean(items, { liked: ["c"], avoided: [] }, `seed-${i}`, id);
      if (out.length === 1) narrowed++;
      else expect(out).toEqual(items);
    }
    expect(narrowed).toBeGreaterThan(150);
    expect(narrowed).toBeLessThan(260);
  });
});

describe("pickers follow the taste", () => {
  it("pickHookStyle is unchanged without a taste and skips avoided openings", () => {
    for (let i = 0; i < 40; i++) {
      const seed = `k-${i}`;
      expect(pickHookStyle(seed, [])).toEqual(pickHookStyle(seed, [], null, null));
      const avoided = HOOK_STYLES.filter((h) => h.id !== "lesson").map((h) => h.id);
      expect(pickHookStyle(seed, [], null, { liked: [], avoided }).id).toBe("lesson");
    }
  });

  it("pickHookStyle still never repeats a recent opening for a loved one", () => {
    for (let i = 0; i < 40; i++) {
      const pick = pickHookStyle(`r-${i}`, ["question"], null, {
        liked: ["question"],
        avoided: [],
      });
      expect(pick.id).not.toBe("question");
    }
  });

  it("pickAdFormat leans toward a loved layout", () => {
    let hits = 0;
    let before = 0;
    for (let i = 0; i < 60; i++) {
      const seed = `ad-${i}`;
      if (pickAdFormat({ hasProduct: false, seed }).id === "big-number") before++;
      const leaned = pickAdFormat({
        hasProduct: false,
        seed,
        lean: { liked: ["big-number"], avoided: [] },
      });
      if (leaned.id === "big-number") hits++;
    }
    expect(hits).toBeGreaterThan(30);
    expect(hits).toBeGreaterThan(before);
  });

  it("pickCarouselDesign keeps the never-repeat rule with a taste", () => {
    for (let i = 0; i < 40; i++) {
      const d = pickCarouselDesign({
        profileKey: "ws:brand",
        seed: `c-${i}`,
        previous: [{ colorway: "light", motif: "wave" }],
        lean: { colorway: { liked: ["light"], avoided: [] } },
      });
      expect(d.colorway).not.toBe("light");
      expect(d.motif).not.toBe("wave");
    }
  });

  it("archetypeMenu drops avoided layouts and marks loved ones", () => {
    const menu = archetypeMenu({ liked: ["hero-world"], avoided: ["monument-object"] });
    expect(menu).not.toContain("- monument-object:");
    expect(menu).toMatch(/- hero-world:.*The team loved this layout/);
    expect(archetypeMenu()).toContain("- monument-object:");
  });

  it("loved captions lead the voice reference", () => {
    const loved = "A loved caption that is long enough to be a real voice reference, honestly.";
    const section = consistencySection([], null, [loved]);
    expect(section).toContain("<published 1>");
    expect(section).toContain(loved);
    expect(consistencySection([])).toBe("");
  });
});
