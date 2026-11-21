import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_FLARE, IMAGE_RECRAFT, IMAGE_SUNBURST } from "./model-router.server";
import { imageProvider, kieAspectRatio, kieModelName, kieServedModel } from "./kie-image.server";

afterEach(() => vi.unstubAllEnvs());

describe("KIE image provider (temporary)", () => {
  it("is off unless IMAGE_PROVIDER=kie", () => {
    expect(imageProvider()).toBe("openrouter");
    vi.stubEnv("IMAGE_PROVIDER", " KIE ");
    expect(imageProvider()).toBe("kie");
    vi.stubEnv("IMAGE_PROVIDER", "openrouter");
    expect(imageProvider()).toBe("openrouter");
  });

  it("draws a Recraft pick with Flare and keeps the GPT Image tiers", () => {
    expect(kieServedModel(IMAGE_RECRAFT)).toBe(IMAGE_FLARE);
    expect(kieServedModel(IMAGE_SUNBURST)).toBe(IMAGE_SUNBURST);
    expect(kieModelName(IMAGE_FLARE, false)).toBe("gpt-image-2-5-flare-text-to-image");
    expect(kieModelName(IMAGE_FLARE, true)).toBe("gpt-image-2-5-flare-image-to-image");
    expect(kieModelName(IMAGE_SUNBURST, true)).toBe("gpt-image-2-5-sunburst-image-to-image");
  });

  it("sends 3:4 for Studio's 4:5 portrait (KIE refuses 4:5)", () => {
    expect(kieAspectRatio("4:5")).toBe("3:4");
    expect(kieAspectRatio("9:16")).toBe("9:16");
  });
});
