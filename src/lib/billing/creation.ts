// Versioned creation allowance. Existing credit grants and purchased credit values
// keep their original terms; this policy applies to newly issued plan windows.
import { isVariationsRequest, variationCount } from "@/lib/studio/variations";
import type { PlanId } from "./catalog";
import type { CreateJobInput } from "@/lib/studio/jobs";

export const CREATION_POLICY = "creation_v3";
export const INCLUDED_CAPTION_EDITS = 3;
export const CREATION_PLANS: Record<PlanId, { points: number; flexCredits: number }> = {
  free: { points: 0, flexCredits: 0 },
  starter: { points: 200, flexCredits: 500 },
  growth: { points: 600, flexCredits: 1500 },
  agency: { points: 1800, flexCredits: 4500 },
  scale: { points: 5000, flexCredits: 12500 },
};

export function isCaptionRevision(input: Pick<CreateJobInput, "type" | "parentJobId" | "refine">) {
  return Boolean(
    input.parentJobId &&
    ["social", "image", "video", "ad"].includes(input.type) &&
    input.refine &&
    [
      "captions",
      "instagram",
      "facebook",
      "linkedin",
      "twitter",
      "threads",
      "tiktok",
      "youtube",
    ].includes(input.refine.target),
  );
}

/** Bounded outputs, not token counts. New media always needs another quote. */
export function creationPointsFor(
  input: Pick<CreateJobInput, "type" | "controls" | "parentJobId" | "refine">,
): number | null {
  if (isCaptionRevision(input)) return 1;
  // More versions of a picture: two points each, like any other picture.
  if (isVariationsRequest(input)) return 2 * variationCount(input.controls);
  const c = input.controls;
  const kept = c.referenceAssetIds?.length && (c.referenceMode ?? "preserve") === "preserve";
  switch (input.type) {
    case "video":
      return c.videoPreview ? 2 : null;
    case "social":
      return kept || !c.includeImage ? 1 : 2;
    case "image":
    case "ad":
      return kept ? 1 : 2;
    case "script":
      return 1;
    case "article":
      return c.articleQuality === "premium"
        ? c.length === "long"
          ? 14
          : 10
        : c.length === "long"
          ? 6
          : 4;
    case "carousel":
      return c.artworkMode === "full" ? 1 + 2 * (c.slideCount ?? 5) : 3;
    case "story":
      return c.storyMode === "video" ? (c.videoPreview ? 2 : null) : 1 + 2 * (c.frameCount ?? 3);
  }
}

export function creationPriceLabel(
  input: Parameters<typeof creationPointsFor>[0],
  editsLeft?: number,
): string | null {
  if (isCaptionRevision(input) && editsLeft !== undefined && editsLeft > 0)
    return "Included caption edit";
  const points = creationPointsFor(input);
  return points === null ? null : `${points} creation ${points === 1 ? "point" : "points"}`;
}
