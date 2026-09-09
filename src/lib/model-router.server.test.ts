import { describe, expect, it } from "vitest";
import { routeImageModel } from "./model-router.server";

describe("Kie image model router", () => {
  it("uses Flare for normal social generation", () => {
    const plan = routeImageModel({ prompt: "A simple product tip for a social post" });
    expect(plan.model).toBe("gpt-image-2-5-flare-text-to-image");
    expect(plan.reason).toContain("default");
  });

  it("uses Sunburst for complex premium campaigns", () => {
    const plan = routeImageModel({
      prompt: "Premium product launch campaign with a complex composition and multiple subjects",
      requiredQuality: "maximum",
    });
    expect(plan.model).toBe("gpt-image-2-5-sunburst-text-to-image");
  });

  it("routes fast reference variations to the edit model", () => {
    const plan = routeImageModel({
      prompt: "Create a variation while preserving the subject and reference image",
      hasReference: true,
      iteration: "variation",
      latency: "fast",
    });
    expect(plan.model).toBe("gpt-image-2-5-flare-image-to-image");
  });

  it("penalizes failing models and prefers a stronger available benchmark", () => {
    const plan = routeImageModel({
      prompt: "A normal social post",
      availableModels: [
        "gpt-image-2-5-flare-text-to-image",
        "gpt-image-2-5-sunburst-text-to-image",
      ],
      failureHistory: { "gpt-image-2-5-flare-text-to-image": 2 },
      benchmarkScores: {
        "gpt-image-2-5-flare-text-to-image": 70,
        "gpt-image-2-5-sunburst-text-to-image": 95,
      },
    });
    expect(plan.model).toBe("gpt-image-2-5-sunburst-text-to-image");
    expect(plan.route).toBe("sunburst");
  });
});
