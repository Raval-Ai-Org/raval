// What a Studio job costs, shared by the jobs route (which charges it) and the
// composer (which shows it on the Generate button). Browser-safe.
import { creditsFor, type CreditAction, VIDEO_UNITS_PER_VC } from "@/lib/billing/catalog";
import { STUDIO_FORMATS, type StudioType } from "./formats";
import type { CreateJobInput, StudioJob } from "./jobs";
import { studioVideoUnits } from "@/lib/ugc/duration";
import { creationPriceLabel } from "@/lib/billing/creation";

export type StudioCharge = CreditAction | "studio_video";

type MediaRequest = Pick<CreateJobInput, "type" | "controls"> &
  Partial<Pick<CreateJobInput, "parentJobId" | "refine">>;

/** A specific text edit reuses media. Only an explicit all/media edit remakes it. */
export function studioTextOnlyRevision(input: MediaRequest): boolean {
  // Full articles and scripts keep their own writing price and model budget.
  if (input.type === "article" || input.type === "script") return false;
  return Boolean(
    input.parentJobId &&
    input.refine &&
    input.refine.target !== "media" &&
    input.refine.target !== "all",
  );
}

/** Shared by billing, execution and the price shown before a user starts work. */
export function studioJobRenders(input: MediaRequest): boolean {
  if (studioTextOnlyRevision(input)) return false;
  if (input.type === "carousel" || input.type === "story") return true;
  const media = STUDIO_FORMATS[input.type].media;
  return (
    media === "video" ||
    media === "image" ||
    (media === "optional-image" && Boolean(input.controls.includeImage))
  );
}

export function studioChargeFor(args: {
  type: StudioType;
  includeImage?: boolean;
  length?: string;
  regenerate?: boolean;
  /** Story: a video Story renders a video and is priced like one. */
  storyMode?: string;
  videoPreview?: boolean;
  textOnly?: boolean;
  referenceMode?: string;
  referenceAssetIds?: string[];
  articleQuality?: string;
}): StudioCharge {
  if (args.textOnly) return "post_regenerate";
  // Keeping an uploaded photo uses the existing copy price, with no AI-image fee.
  if (
    args.referenceAssetIds?.length &&
    (args.referenceMode ?? "preserve") === "preserve" &&
    ["social", "image", "ad"].includes(args.type)
  )
    return args.regenerate ? "post_regenerate" : "post_set";
  switch (args.type) {
    case "video":
      return args.videoPreview ? "image_post" : "studio_video";
    case "story":
      return args.storyMode === "video"
        ? args.videoPreview
          ? "image_post"
          : "studio_video"
        : "story";
    case "image":
      return "image_post";
    case "carousel":
      return "carousel";
    case "ad":
      return "ad_set";
    case "script":
      return "script";
    case "article":
      return args.articleQuality === "premium"
        ? args.length === "long"
          ? "article_long"
          : "article_premium"
        : "article_standard";
    default:
      if (args.includeImage) return "image_post";
      return args.regenerate ? "post_regenerate" : "post_set";
  }
}

export function studioPriceLabel(
  input: MediaRequest & { regenerate?: boolean; captionEditsRemaining?: number },
): string {
  if (input.controls.paymentSource === "creation") {
    const label = creationPriceLabel(input, input.captionEditsRemaining);
    if (label) return label;
  }
  const action = studioChargeFor({
    type: input.type,
    ...input.controls,
    regenerate: input.regenerate || Boolean(input.parentJobId),
    textOnly: studioTextOnlyRevision(input),
  });
  return action === "studio_video"
    ? `${(input.controls.videoQuote?.units ?? studioVideoUnits(input.controls.durationSec)) / VIDEO_UNITS_PER_VC} video credits`
    : `${creditsFor(action)} credits`;
}

/** A social post whose optional image failed must not cost the image bundle price. */
export function studioCapturedAmount(
  job: StudioJob,
  quotedAmount: number,
  meter = "credits",
): number {
  if (job.status !== "succeeded") return 0;
  if (
    job.type === "social" &&
    job.output?.partial?.some((part) => part.target === "media") &&
    !job.output.media?.some((media) => media.status === "ready")
  ) {
    return Math.min(
      quotedAmount,
      meter === "creation" ? 1 : creditsFor(job.parent_job_id ? "post_regenerate" : "post_set"),
    );
  }
  return quotedAmount;
}
