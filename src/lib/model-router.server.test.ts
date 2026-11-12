import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_FLARE,
  IMAGE_SUNBURST,
  routeImageModel,
  wantsPremiumImage,
} from "./model-router.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenRouter image model router", () => {
  it("uses Flare for normal social generation, with Sunburst as its fallback", () => {
    const plan = routeImageModel({ prompt: "A simple product tip for a social post" });
    expect(plan).toMatchObject({ model: IMAGE_FLARE, route: "flare", fallbacks: [IMAGE_SUNBURST] });
    expect(plan.reason).toContain("default");
  });

  it("uses Sunburst only when a caller asks for maximum quality, falling back to Flare", () => {
    const plan = routeImageModel({
      prompt: "Premium product launch campaign with a complex composition and multiple subjects",
      requiredQuality: "maximum",
    });
    expect(plan).toMatchObject({
      model: IMAGE_SUNBURST,
      route: "sunburst",
      fallbacks: [IMAGE_FLARE],
    });
    // Wording alone never upgrades a request.
    expect(
      routeImageModel({
        prompt: "Cinematic editorial infographic with a bold headline and detailed typography",
      }).model,
    ).toBe(IMAGE_FLARE);
  });

  it("keeps Studio-length prompts on Flare (length never means premium)", () => {
    const studioPrompt = "Layout rules and the brand's look, line after line. ".repeat(220);
    expect(studioPrompt.length).toBeGreaterThan(10_000);
    expect(routeImageModel({ prompt: studioPrompt }).model).toBe(IMAGE_FLARE);
    expect(
      routeImageModel({ prompt: studioPrompt, hasReference: true, brandPrecision: "strict" }),
    ).toMatchObject({ model: IMAGE_FLARE, route: "flare-edit" });
  });

  it("routes reference edits to Flare and only the product cutout to Sunburst", () => {
    expect(
      routeImageModel({
        prompt: "Create a variation while preserving the subject",
        hasReference: true,
        iteration: "variation",
        latency: "fast",
      }),
    ).toMatchObject({ model: IMAGE_FLARE, route: "flare-edit" });
    expect(
      routeImageModel({ prompt: "Swap the label text", editing: true, brandPrecision: "strict" }),
    ).toMatchObject({ model: IMAGE_FLARE, route: "flare-edit" });
    // The product cutout's request (product-hero/cutout.server.ts).
    expect(
      routeImageModel({
        prompt: "Cut the product out on a transparent background",
        editing: true,
        brandPrecision: "strict",
        requiredQuality: "high",
      }),
    ).toMatchObject({ model: IMAGE_SUNBURST, route: "sunburst-edit" });
    expect(wantsPremiumImage({ requiredQuality: "high" })).toBe(false);
    expect(wantsPremiumImage({ brandPrecision: "strict" })).toBe(false);
  });

  it("penalizes failing models and prefers a stronger available benchmark", () => {
    const plan = routeImageModel({
      prompt: "A normal social post",
      availableModels: [IMAGE_FLARE, IMAGE_SUNBURST],
      failureHistory: { [IMAGE_FLARE]: 2 },
      benchmarkScores: { [IMAGE_FLARE]: 70, [IMAGE_SUNBURST]: 95 },
    });
    expect(plan.model).toBe(IMAGE_SUNBURST);
    expect(plan.route).toBe("sunburst");
  });

  it("reads IMAGE_MODEL_* overrides", () => {
    vi.stubEnv("IMAGE_MODEL_DEFAULT", "vendor/fast-image");
    expect(routeImageModel({ prompt: "A post" }).model).toBe("vendor/fast-image");
  });
});
