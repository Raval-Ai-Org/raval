// What a Studio job costs, shared by the jobs route (which charges it) and the
// composer (which shows it on the Generate button). Browser-safe.
import {
  cr,
  creditsFor,
  formatCredits,
  videoCreditsFor,
  type CreditAction,
  type UgcModelKey,
} from "@/lib/billing/catalog";
import { STUDIO_FORMATS, type StudioType } from "./formats";
import type { CreateJobInput, StudioControls, StudioJob } from "./jobs";
import { creationPriceLabel } from "@/lib/billing/creation";
import { DEFAULT_STUDIO_VIDEO_MODEL } from "./video/kinds";
import {
  VARIATION_TARGET,
  isVariationsRequest,
  variationCount,
  variationsCaptured,
} from "./variations";
import { isPhotoDesignType, withResolvedPhotoMode } from "./photo-design/mode";
import { RECAP_AI_SECONDS } from "./clip-edit";
import { shortClipPlan, shortClipPrice } from "./short-clip";

/** Credits for one extra designed carousel slide (the cover is 1 credit). */
export const CAROUSEL_SLIDE_CREDITS = 0.75;

/**
 * A carousel's price (ADR-0051): every slide is designed by the image model at
 * high quality, so it is 1 credit for the cover plus ¾ credit per extra slide,
 * rounded up to a half credit (6 slides = 5 credits). Slides still drawn by
 * code (connected slides, the brand's own photos) cost 1 credit.
 */
export function carouselCredits(controls: {
  slideCount?: number;
  seamless?: boolean;
  referenceAssetIds?: string[];
  referenceMode?: string;
}): number {
  const drawnByCode =
    !!controls.seamless ||
    (!!controls.referenceAssetIds?.length && (controls.referenceMode ?? "preserve") === "preserve");
  if (drawnByCode) return cr(1);
  const slides = Math.min(10, Math.max(3, Math.round(controls.slideCount ?? 6)));
  return cr(Math.ceil((1 + (slides - 1) * CAROUSEL_SLIDE_CREDITS) * 2) / 2);
}

/** Credit units a Studio action costs, with a carousel priced per slide. */
export function studioCreditUnits(
  action: StudioCharge,
  controls: Parameters<typeof carouselCredits>[0],
  quantity = 1,
): number {
  if (action === "carousel") return carouselCredits(controls) * quantity;
  return creditsFor(action as CreditAction) * quantity;
}

/** "studio_short_clip": an AI clip of 8 s or less, in credits (src/lib/studio/short-clip.ts). */
export type StudioCharge = CreditAction | "studio_video" | "studio_short_clip";

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
    input.refine.target !== "all" &&
    input.refine.target !== VARIATION_TARGET,
  );
}

/** Shared by billing, execution and the price shown before a user starts work. */
export function studioJobRenders(input: MediaRequest): boolean {
  if (studioTextOnlyRevision(input)) return false;
  if (isVariationsRequest(input)) return true;
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
  photoFidelity?: string;
  articleQuality?: string;
  /** More versions of a finished picture: priced per picture. */
  variations?: boolean;
  videoMode?: string;
  recapMotion?: string;
  videoModelKey?: string;
  durationSec?: number;
  videoResolution?: string;
}): StudioCharge {
  if (args.variations) return "image_standard";
  if (args.textOnly) return "post_regenerate";
  if (
    (args.type === "video" || args.type === "story") &&
    shortClipPlan({
      type: args.type,
      controls: args as Parameters<typeof shortClipPlan>[0]["controls"],
    })
  )
    return "studio_short_clip";
  // The brand's own footage or photos: no video units, except animating photos.
  if (args.type === "video" && args.videoMode === "brand") return "clip_brand";
  // The website reel is code and FFmpeg only, priced like a camera-move recap.
  if (args.type === "video" && args.videoMode === "site") return "photo_recap";
  // A motion graphic: one design call, drawn by code (ADR-0043).
  if (args.type === "video" && args.videoMode === "motion") return "motion_graphics";
  if (args.type === "video" && args.videoMode === "recap")
    return args.recapMotion === "ai" ? "studio_video" : "photo_recap";
  // A product cut out of its photo and staged as the hero (ADR-0040).
  if (
    args.referenceAssetIds?.length &&
    args.referenceMode === "hero" &&
    isPhotoDesignType(args.type)
  )
    return "product_hero";
  // Designing with the person's photos: exact photos are placed by Mellox;
  // "blend it more" is an ordinary generated picture.
  if (
    args.referenceAssetIds?.length &&
    args.referenceMode === "design" &&
    isPhotoDesignType(args.type)
  )
    return args.photoFidelity === "blend"
      ? args.type === "ad"
        ? "ad_set"
        : "image_post"
      : "photo_design";
  // Keeping an uploaded photo uses the existing copy price, with no AI-image fee.
  if (
    args.referenceAssetIds?.length &&
    (args.referenceMode ?? "preserve") === "preserve" &&
    ["social", "image", "ad"].includes(args.type)
  )
    return args.regenerate ? "post_regenerate" : "post_set";
  switch (args.type) {
    case "video":
      return args.videoPreview ? "video_storyboard" : "studio_video";
    case "story":
      return args.storyMode === "video"
        ? args.videoPreview
          ? "video_storyboard"
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
  shown: MediaRequest & {
    regenerate?: boolean;
    captionEditsRemaining?: number;
    intent?: CreateJobInput["intent"];
  },
): string {
  // The price of what will run: "post as is" with words asked for is a design.
  const input = shown.intent ? withResolvedPhotoMode({ ...shown, intent: shown.intent }) : shown;
  if (input.controls.paymentSource === "creation") {
    const label = creationPriceLabel(input, input.captionEditsRemaining);
    if (label) return label;
  }
  const variations = isVariationsRequest(input);
  const action = studioChargeFor({
    type: input.type,
    ...input.controls,
    regenerate: input.regenerate || Boolean(input.parentJobId),
    textOnly: studioTextOnlyRevision(input),
    variations,
  });
  if (action === "studio_short_clip") {
    const plan = shortClipPlan(input);
    const quoted =
      input.controls.videoQuote?.meter === "credits" ? input.controls.videoQuote.units : null;
    if (plan) return formatCredits(quoted ?? shortClipPrice(plan).credits);
  }
  if (action === "studio_video") {
    // The quote's meter says what pays: a video held from before v4, or credits.
    const recap = input.type === "video" && input.controls.videoMode === "recap";
    const quote = recap ? undefined : input.controls.videoQuote;
    if (quote?.meter === "video") return "Free video";
    if (quote?.meter === "premium_video")
      return quote.premiumLeft != null && quote.premiumMonthly
        ? `Premium video · ${quote.premiumLeft} of ${quote.premiumMonthly} left`
        : "Premium video";
    if (quote?.meter === "credits") return formatCredits(quote.units);
    return formatCredits(studioVideoCredits(input.type, input.controls));
  }
  const units = studioCreditUnits(
    action,
    input.controls,
    variations ? variationCount(input.controls) : 1,
  );
  return units === 0 ? "Included" : formatCredits(units);
}

/**
 * The catalog price of a Studio AI video in ledger units, before the server's
 * provider-cost floor: the per-second rate for its model and length. Animated
 * recap photos are RECAP_AI_SECONDS each, whatever length was picked.
 */
export function studioVideoCredits(
  type: StudioType,
  controls: Pick<
    StudioControls,
    "videoModelKey" | "durationSec" | "videoResolution" | "videoMode" | "referenceAssetIds"
  >,
): number {
  const model = (controls.videoModelKey ?? DEFAULT_STUDIO_VIDEO_MODEL) as UgcModelKey;
  const resolution = controls.videoResolution === "1080P" ? "1080p" : "720p";
  const seconds =
    type === "video" && controls.videoMode === "recap"
      ? Math.max(1, controls.referenceAssetIds?.length ?? 0) * RECAP_AI_SECONDS
      : (controls.durationSec ?? 10);
  return videoCreditsFor(model, seconds, resolution);
}

/** A social post whose optional image failed must not cost the image bundle price. */
export function studioCapturedAmount(
  job: StudioJob,
  quotedAmount: number,
  meter = "credits",
): number {
  if (job.status !== "succeeded") return 0;
  if (
    job.input &&
    isVariationsRequest({
      ...job.input,
      type: job.type,
      parentJobId: job.parent_job_id ?? undefined,
    })
  )
    return variationsCaptured(job, quotedAmount);
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
