import { describe, expect, it } from "vitest";
import { mergeAddedPlatforms } from "@/lib/studio/add-platforms";
import type { StudioJobOutput } from "@/lib/studio/jobs";

const original: StudioJobOutput = {
  title: "Original post",
  concept: "The original image concept",
  media: [{ slot: "main", kind: "image", ratio: "1:1", status: "ready", assetId: "asset-1" }],
  variants: [
    {
      platform: "instagram",
      title: "Original",
      body: "Original caption",
      hashtags: ["brand"],
      chars: 16,
    },
  ],
};

describe("adding platform versions", () => {
  it("keeps the original post and media while adding requested captions", () => {
    const result = mergeAddedPlatforms(
      original,
      {
        title: "Changed by model",
        concept: "Changed visual",
        variants: [
          { platform: "instagram", title: "Changed", body: "Changed", hashtags: [], chars: 7 },
          {
            platform: "linkedin",
            title: "LinkedIn",
            body: "Professional caption",
            hashtags: [],
            chars: 20,
          },
        ],
      },
      ["instagram", "linkedin"],
    );
    expect(result.title).toBe("Original post");
    expect(result.concept).toBe("The original image concept");
    expect(result.media).toBe(original.media);
    expect(result.variants?.map((variant) => variant.body)).toEqual([
      "Original caption",
      "Professional caption",
    ]);
  });

  it("fails if the model omits a requested platform", () => {
    expect(() =>
      mergeAddedPlatforms(original, { variants: [] }, ["instagram", "linkedin"]),
    ).toThrow("Couldn't create versions for linkedin");
  });
});
