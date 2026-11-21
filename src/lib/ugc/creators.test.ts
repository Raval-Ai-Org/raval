import { describe, expect, it } from "vitest";
import {
  STOCK_CREATORS,
  creatorPhotoPath,
  creatorPhotoPrompt,
  creatorsInOrder,
  customCreatorProblem,
  creatorPrompt,
  filterCreators,
  sameCreator,
  stockCreator,
  suggestCreators,
} from "./creators";
import { BriefSchema } from "./schemas";
import { buildVideoPrompt } from "./prompt";
import { resolveUgcModel } from "./models";
import { scriptFromText, scriptToText, typedWordCount } from "./script-text";
import { parseLook } from "@/lib/brand-look/spec";
import { resolveLook } from "@/lib/brand-look/resolve";

describe("stock creators", () => {
  it("have unique, stable ids and a described look", () => {
    const ids = STOCK_CREATORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of STOCK_CREATORS) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.look.length).toBeGreaterThan(20);
      expect(creatorPrompt(c)).toContain(c.name);
    }
    expect(STOCK_CREATORS.some((c) => c.gender === "woman")).toBe(true);
    expect(STOCK_CREATORS.some((c) => c.gender === "man")).toBe(true);
  });

  it("filters by gender and search words", () => {
    expect(filterCreators(STOCK_CREATORS, "woman", "").every((c) => c.gender === "woman")).toBe(
      true,
    );
    const gym = filterCreators(STOCK_CREATORS, "all", "gym");
    expect(gym.length).toBeGreaterThan(0);
    expect(
      filterCreators(STOCK_CREATORS, "suggested", "", ["maya", "nope"]).map((c) => c.id),
    ).toEqual(["maya"]);
  });

  it("suggests creators that fit the brand, and none for an empty profile", () => {
    expect(suggestCreators({})).toEqual([]);
    const skincare = suggestCreators({
      industry: "Skincare",
      audience: "Women 25-34 with sensitive skin",
    });
    expect(skincare.length).toBeGreaterThan(0);
    for (const id of skincare)
      expect(stockCreator(id)!.tags.join(" ")).toMatch(/skincare|beauty|wellness|self-care/);
    expect(stockCreator(skincare[0])!.gender).toBe("woman");
    const saas = suggestCreators({ industry: "B2B SaaS for finance teams" });
    expect(saas.some((id) => ["daniel", "priya", "ravi", "nina"].includes(id))).toBe(true);
  });

  it("matches a stored brand creator by id or person", () => {
    expect(sameCreator({ id: "maya" }, { id: "maya", name: "Maya" })).toBe(true);
    expect(sameCreator({ personAssetId: "a" }, { personAssetId: "b" })).toBe(false);
    expect(sameCreator(null, { id: "maya" })).toBe(false);
  });
});

describe("typed scripts", () => {
  it("splits typed words into timed beats spanning the clip", () => {
    const script = scriptFromText(
      "Okay, I didn't expect this. My skin felt calm all day. No fragrance at all. Link is below, go try it.",
      10,
    )!;
    expect(script.hook).toBe("Okay, I didn't expect this.");
    expect(script.scenes.length).toBeGreaterThanOrEqual(2);
    expect(script.scenes[0].start).toBe(0);
    expect(script.scenes.at(-1)!.end).toBe(10);
    for (let i = 1; i < script.scenes.length; i++)
      expect(script.scenes[i].start).toBe(script.scenes[i - 1].end);
    expect(scriptToText(script).replace(/\n/g, " ")).toBe(
      "Okay, I didn't expect this. My skin felt calm all day. No fragrance at all. Link is below, go try it.",
    );
  });

  it("keeps a given call to action and refuses an empty box", () => {
    expect(scriptFromText("   ", 10)).toBeNull();
    expect(scriptFromText("Just one line", 5, { cta: "Shop now" })!.cta).toBe("Shop now");
    expect(typedWordCount(" one two  three ")).toBe(3);
  });
});

describe("creator in the video prompt", () => {
  const product = {
    name: "Moisturiser",
    brand: "Northwind",
    url: null,
    description: "",
    price: "",
    category: "",
    images: [],
    facts: [],
    benefits: [],
    audienceHints: [],
    useCases: [],
  };
  const script = scriptFromText("Hello there. Try it today.", 10)!;
  const model = resolveUgcModel("standard");

  it("describes a ready-made creator exactly", () => {
    const prompt = buildVideoPrompt({
      product,
      brief: BriefSchema.parse({ creator: { characterId: "jordan" } }),
      script,
      model,
      durationSec: 10,
      aspectRatio: "9:16",
      imageCount: 0,
    });
    expect(prompt).toContain(stockCreator("jordan")!.look);
  });

  it("points at the first reference image for one of the brand's people", () => {
    if (model.images?.mode !== "references") return;
    const prompt = buildVideoPrompt({
      product,
      brief: BriefSchema.parse({}),
      script,
      model,
      durationSec: 10,
      aspectRatio: "9:16",
      imageCount: 2,
      creatorImage: true,
    });
    expect(prompt).toContain("The person in the first reference image");
    expect(prompt).toContain("other reference image(s)");
  });

  it("rejects an unknown creator id", () => {
    expect(BriefSchema.safeParse({ creator: { characterId: "someone-else" } }).success).toBe(false);
  });
});

describe("brand creator on the look", () => {
  it("is kept by parseLook and doesn't make the look customized", () => {
    const look = parseLook({ video: { creator: { id: "maya", name: "Maya" } } });
    expect(look.video?.creator?.id).toBe("maya");
    expect(resolveLook({ look } as never).customized).toBe(false);
    expect(
      resolveLook({ look: { video: { pacing: "fast", creator: { id: "maya" } } } } as never)
        .customized,
    ).toBe(true);
  });
});

describe("creator photos and custom creators", () => {
  it("puts creators with a photo first and points at public/creators", () => {
    const ordered = creatorsInOrder(STOCK_CREATORS);
    expect(ordered).toHaveLength(STOCK_CREATORS.length);
    const firstWithout = ordered.findIndex((c) => !creatorPhotoPath(c.id));
    const lastWith = ordered.map((c) => !!creatorPhotoPath(c.id)).lastIndexOf(true);
    if (firstWithout >= 0) expect(lastWith).toBeLessThan(firstWithout);
    expect(creatorPhotoPath("maya")).toBe("creators/maya.jpg");
    expect(creatorPhotoPath("nobody")).toBeNull();
  });

  it("refuses lookalikes and empty descriptions before anything is spent", () => {
    expect(customCreatorProblem("", "a tall woman with curly hair")).toMatch(/name/);
    expect(customCreatorProblem("Ana", "tall")).toMatch(/Describe/);
    expect(customCreatorProblem("Ana", "looks like a famous pop singer")).not.toBeNull();
    expect(customCreatorProblem("Ana", "resembles a celebrity chef")).not.toBeNull();
    expect(customCreatorProblem("Ana", "warm smile, short curly hair, denim jacket")).toBeNull();
  });

  it("asks for an original person with no text", () => {
    const prompt = creatorPhotoPrompt({
      gender: "woman",
      age: "25-34",
      look: "short curly hair, denim jacket.",
      place: "a sunny kitchen",
    });
    expect(prompt).toContain("original, fictional");
    expect(prompt).toContain("aged 25 to 34");
    expect(prompt).toMatch(/not resembling any real/i);
  });
});
