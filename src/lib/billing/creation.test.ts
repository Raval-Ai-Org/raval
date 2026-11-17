import { describe, expect, it } from "vitest";
import { CREATION_PLANS, creationPointsFor, creationPriceLabel } from "./creation";
import { creationProviderLimits } from "./plan-economics";
import { studioCapturedAmount, studioPriceLabel } from "@/lib/studio/billing";
import type { StudioJob } from "@/lib/studio/jobs";
import { videoUnitsFor } from "./catalog";

// Creation points are legacy since pricing v4 (ADR-0050): only windows granted
// before v4 spend them. These tests keep those terms honest until they end.
describe("legacy creation allowance", () => {
  it("caps provider spend at 60% of the monthly price, yearly too", () => {
    expect(creationProviderLimits("starter", "month").monthlyUsd).toBe(29.4);
    expect(creationProviderLimits("starter", "year").monthlyUsd).toBe(29.4);
  });
  it("still prices a legacy window's image set in points; credits price it at 1", () => {
    expect(
      CREATION_PLANS.starter.points /
        creationPointsFor({ type: "image", controls: { platforms: [] } })!,
    ).toBe(100);
    expect(studioPriceLabel({ type: "image", controls: { platforms: [] } })).toBe("1 credit");
    expect(
      studioPriceLabel({ type: "image", controls: { platforms: [], paymentSource: "creation" } }),
    ).toBe("2 creation points");
  });
  it("prices every generated slide and every Story frame", () => {
    // Carousel slides are always designed by the model now (ADR-0051).
    expect(
      creationPointsFor({ type: "carousel", controls: { platforms: [], slideCount: 10 } }),
    ).toBe(21);
    expect(
      creationPointsFor({
        type: "carousel",
        controls: { platforms: [], slideCount: 10, artworkMode: "full" },
      }),
    ).toBe(21);
    expect(creationPointsFor({ type: "story", controls: { platforms: [], frameCount: 7 } })).toBe(
      15,
    );
  });
  it("keeps photos cheaper and shows included edits only on captions", () => {
    expect(
      creationPointsFor({
        type: "image",
        controls: { platforms: [], referenceAssetIds: ["photo"] },
      }),
    ).toBe(1);
    const request = {
      type: "image" as const,
      controls: { platforms: [] },
      parentJobId: "parent",
      refine: { target: "captions", instruction: "Shorten" },
    };
    expect(creationPriceLabel(request, 1)).toBe("Included caption edit");
    expect(
      creationPriceLabel({ ...request, refine: { target: "media", instruction: "Remake" } }, 3),
    ).toBe("2 creation points");
  });
  it("returns the unused image point on optional-image failure", () => {
    expect(
      studioCapturedAmount(
        {
          status: "succeeded",
          type: "social",
          output: { partial: [{ target: "media", error: "failed" }] },
        } as StudioJob,
        2,
        "creation",
      ),
    ).toBe(1);
  });
  it("does not make a longer non-native video cheaper than its native clip", () => {
    const price = (seconds: number) =>
      videoUnitsFor({
        ugcKey: "standard",
        seconds,
        resolution: "720p",
        providerCostUsd: 0.3 * Math.ceil(seconds / 8),
      });
    expect(price(10)).toBeGreaterThanOrEqual(price(8));
    expect(price(20)).toBeGreaterThanOrEqual(price(10));
  });
});
