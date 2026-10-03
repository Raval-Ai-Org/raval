// What a Studio job costs, shared by the jobs route (which charges it) and the
// composer (which shows it on the Generate button). Browser-safe.
import type { CreditAction } from "@/lib/billing/catalog";
import type { StudioType } from "./formats";

export type StudioCharge = CreditAction | "studio_video";

export function studioChargeFor(args: {
  type: StudioType;
  includeImage?: boolean;
  length?: string;
  regenerate?: boolean;
  /** Story: a video Story renders a video and is priced like one. */
  storyMode?: string;
}): StudioCharge {
  switch (args.type) {
    case "video":
      return "studio_video";
    case "story":
      return args.storyMode === "video" ? "studio_video" : "story";
    case "image":
      return "image_post";
    case "carousel":
      return "carousel";
    case "ad":
      return "ad_set";
    case "script":
      return "script";
    case "article":
      return args.length === "long" ? "article_long" : "article_standard";
    default:
      if (args.includeImage) return "image_post";
      return args.regenerate ? "post_regenerate" : "post_set";
  }
}
