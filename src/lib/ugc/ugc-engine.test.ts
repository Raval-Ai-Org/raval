import { describe, expect, it } from "vitest";
import { checkScriptClaims, findClaims, validFactIds } from "./grounding";
import {
  checkRenderSettings,
  coerceRenderSettings,
  durationsFor,
  renderCredits,
  UGC_MODELS,
  UGC_MODEL_KEYS,
} from "./models";
import { PLATFORMS } from "./options";
import {
  buildVideoPrompt,
  dialogueWordBudget,
  fitScenes,
  productDisplayName,
  scriptWordCount,
} from "./prompt";
import { BriefSchema, ProductSchema, ScriptSchema, StartRenderBody } from "./schemas";

const product = ProductSchema.parse({
  name: "GlowSerum Vitamin C",
  brand: "Lumen",
  url: "https://lumen.example/serum",
  description: "A lightweight vitamin C face serum for daily use.",
  category: "Skincare",
  facts: [
    { id: "f1", text: "Contains 15% vitamin C", source: "page" },
    { id: "f2", text: "Fragrance-free and vegan", source: "page" },
    { id: "f3", text: "30 ml glass dropper bottle", source: "page" },
  ],
  useCases: ["apply it after cleansing in the morning"],
});

const brief = BriefSchema.parse({
  objective: "sales",
  platform: "tiktok",
  format: "problem_solution",
  tone: "authentic",
  language: "en",
  audience: "women 25-40 with dull skin",
  cta: "Shop now",
  creator: { gender: "woman", age: "25-34", vibe: "relatable", setting: "bathroom" },
});

const script = ScriptSchema.parse({
  hook: "My skin looked so tired until this",
  scenes: [
    {
      id: "s1",
      start: 0,
      end: 3,
      shot: "Close-up selfie in the bathroom mirror",
      action: "She touches her cheek, unimpressed",
      dialogue: "My skin looked so tired, honestly.",
      productPlacement: "Bottle not yet visible",
    },
    {
      id: "s2",
      start: 3,
      end: 9,
      shot: "Medium selfie",
      action: "She holds up the serum and applies two drops",
      dialogue: "This vitamin C serum is fragrance-free. Grab yours.",
      productPlacement: "Label facing the camera",
    },
  ],
  cta: "Shop now",
  factIds: ["f1", "f2", "nope"],
});

describe("model registry", () => {
  it("every model has pricing for each resolution it offers", () => {
    for (const key of UGC_MODEL_KEYS) {
      const m = UGC_MODELS[key];
      for (const r of m.resolutions) expect(renderCredits(m.pricing, r, 8)).toBeGreaterThan(0);
    }
  });

  it("Veo reference renders are 8 seconds only; Quality takes a first frame", () => {
    const fast = UGC_MODELS["veo-3-1-fast"];
    expect(durationsFor(fast, false)).toEqual([4, 6, 8]);
    expect(durationsFor(fast, true)).toEqual([8]);
    expect(UGC_MODELS["veo-3-1-quality"].images).toEqual({ mode: "first_frame", max: 1 });
  });

  it("rejects combinations the model can't render", () => {
    const veo = UGC_MODELS["veo-3-1-fast"];
    const problems = checkRenderSettings(veo, {
      model: veo.key,
      durationSec: 6,
      aspectRatio: "1:1",
      resolution: "480p",
      imageCount: 2,
    });
    expect(problems.map((p) => p.field).sort()).toEqual(["aspectRatio", "durationSec", "resolution"]);
  });

  it("coerces settings to the nearest valid combination", () => {
    const veo = UGC_MODELS["veo-3-1-fast"];
    expect(
      coerceRenderSettings(veo, {
        model: "seedance-2",
        durationSec: 12,
        aspectRatio: "1:1",
        resolution: "480p",
        imageCount: 0,
      }),
    ).toEqual({ model: veo.key, durationSec: 8, aspectRatio: "9:16", resolution: "720p", imageCount: 0 });
  });

  it("prices per video and per second", () => {
    expect(renderCredits(UGC_MODELS["veo-3-1-fast"].pricing, "720p", 4)).toBe(60);
    expect(renderCredits(UGC_MODELS["seedance-2-fast"].pricing, "720p", 10)).toBe(248);
    expect(renderCredits(UGC_MODELS["veo-3-1-fast"].pricing, "480p", 8)).toBeNull();
  });

  it("every platform preset maps to at least one enabled model", () => {
    for (const p of PLATFORMS) {
      expect(UGC_MODEL_KEYS.some((k) => UGC_MODELS[k].aspectRatios.includes(p.aspectRatio))).toBe(true);
    }
  });
});

describe("prompt builder", () => {
  const input = {
    product,
    brief,
    script,
    model: UGC_MODELS["veo-3-1-fast"],
    durationSec: 8,
    aspectRatio: "9:16" as const,
    imageCount: 1,
    brandVoice: "Honest, warm, science-backed",
  };

  it("is deterministic", () => {
    expect(buildVideoPrompt(input)).toBe(buildVideoPrompt(input));
  });

  it("directs a native UGC shoot with the exact dialogue, product fidelity and restrictions", () => {
    const prompt = buildVideoPrompt(input);
    expect(prompt).toContain("vertical 9:16 8-second user-generated-content (UGC) video ad for Lumen GlowSerum Vitamin C");
    expect(prompt).toContain("TikTok creator video");
    expect(prompt).toContain('The creator says: "My skin looked so tired, honestly."');
    expect(prompt).toContain("exactly like the product in the reference image(s)");
    expect(prompt).toContain("in English, word for word");
    expect(prompt).toContain("no on-screen text");
    expect(prompt).toContain("no cinematic grading");
    expect(prompt).toContain("A clean bathroom with a mirror");
    expect(prompt).toContain("Contains 15% vitamin C; Fragrance-free and vegan");
    expect(prompt).not.toContain("30 ml glass dropper"); // not cited by the script
  });

  it("fits the beat sheet to the clip length", () => {
    const prompt = buildVideoPrompt(input);
    expect(prompt).toContain("[0–2.7s] HOOK");
    expect(prompt).toContain("s] CALL TO ACTION");
    expect(prompt).toMatch(/–8s\] CALL TO ACTION/);
    const fitted = fitScenes(script.scenes, 8);
    expect(fitted[0].start).toBe(0);
    expect(fitted[fitted.length - 1].end).toBe(8);
  });

  it("uses first-frame wording and no image wording when no images are sent", () => {
    const quality = buildVideoPrompt({ ...input, model: UGC_MODELS["veo-3-1-quality"] });
    expect(quality).toContain("opens on the provided product image");
    const none = buildVideoPrompt({ ...input, imageCount: 0 });
    expect(none).not.toContain("reference image");
    expect(none).toContain("What it is: A lightweight vitamin C face serum");
  });

  it("keeps speech inside the word budget for the clip", () => {
    expect(dialogueWordBudget(8)).toBe(18);
    expect(scriptWordCount(script)).toBeLessThanOrEqual(dialogueWordBudget(8));
    expect(scriptWordCount({ scenes: [{ ...script.scenes[0], dialogue: "你好世界你好世界" }] }, "zh")).toBe(4);
  });

  it("does not repeat the brand when the name already has it", () => {
    expect(productDisplayName({ brand: "Lumen", name: "Lumen Serum" })).toBe("Lumen Serum");
    expect(productDisplayName({ brand: "", name: "Serum" })).toBe("Serum");
  });
});

describe("claim grounding", () => {
  it("finds specific claims", () => {
    const claims = findClaims("Clinically proven, 50% brighter in 7 days. #1 serum, money-back guarantee, $29.");
    expect(claims.map((c) => c.kind)).toEqual(
      expect.arrayContaining([
        "a percentage",
        "a timed result",
        "a professional endorsement",
        "a ranking or award",
        "a guarantee",
        "a price",
      ]),
    );
  });

  it("allows claims backed by a fact and flags the rest", () => {
    const warnings = checkScriptClaims(
      {
        ...script,
        scenes: [
          { ...script.scenes[0], dialogue: "It has 15% vitamin C and it's vegan." },
          { ...script.scenes[1], dialogue: "Results in 7 days, clinically proven." },
        ],
      },
      product.facts,
    );
    expect(warnings.map((w) => w.claim)).toEqual(["in 7 days", "clinically proven"]);
    expect(warnings[0]).toMatchObject({ sceneId: "s2", field: "dialogue" });
  });

  it("keeps only known fact ids", () => {
    expect(validFactIds(script.factIds, product.facts)).toEqual(["f1", "f2"]);
  });
});

describe("render request contract", () => {
  it("rejects client-supplied prices and unknown models", () => {
    const parsed = StartRenderBody.safeParse({
      workspaceId: "a1111111-1111-4111-8111-111111111111",
      projectId: "a1111111-1111-4111-8111-111111111112",
      idempotencyKey: "click-123456",
      model: "muapi-model",
      durationSec: 8,
      aspectRatio: "9:16",
      resolution: "720p",
      estCostUsd: 0,
    });
    expect(parsed.success).toBe(false);
    const ok = StartRenderBody.parse({
      workspaceId: "a1111111-1111-4111-8111-111111111111",
      projectId: "a1111111-1111-4111-8111-111111111112",
      idempotencyKey: "click-123456",
      model: "veo-3-1-fast",
      durationSec: 8,
      aspectRatio: "9:16",
      resolution: "720p",
      estCostUsd: 0,
    });
    expect(ok).not.toHaveProperty("estCostUsd");
  });
});
