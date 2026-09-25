import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_FLARE, IMAGE_SUNBURST, routeImageModel } from "./model-router.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenRouter image model router", () => {
  it("uses Flare for normal social generation, with Sunburst as its fallback", () => {
    const plan = routeImageModel({ prompt: "A simple product tip for a social post" });
    expect(plan).toMatchObject({ model: IMAGE_FLARE, route: "flare", fallbacks: [IMAGE_SUNBURST] });
    expect(plan.reason).toContain("default");
  });

  it("uses Sunburst for premium, cinematic or text-heavy work, falling back to Flare", () => {
    const plan = routeImageModel({
      prompt: "Premium product launch campaign with a complex composition and multiple subjects",
      requiredQuality: "maximum",
    });
    expect(plan).toMatchObject({
      model: IMAGE_SUNBURST,
      route: "sunburst",
      fallbacks: [IMAGE_FLARE],
    });
    expect(
      routeImageModel({
        prompt: "Cinematic editorial infographic with a bold headline and detailed typography",
      }).model,
    ).toBe(IMAGE_SUNBURST);
  });

  it("routes quick reference edits to Flare and precise edits to Sunburst", () => {
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
    ).toMatchObject({ model: IMAGE_SUNBURST, route: "sunburst-edit" });
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
