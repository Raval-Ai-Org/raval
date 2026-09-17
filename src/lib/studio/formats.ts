// Studio's creation types — the single definition every surface reads (composer,
// rail, command bar, chat chips, server job runner). Pure: no React, no server.
import type { PlatformId } from "@/lib/social-platforms";
import { IMAGE_RATIOS, VIDEO_RATIOS, type AspectRatio } from "./aspect";

export type StudioType = "social" | "image" | "carousel" | "video" | "article" | "script" | "ad";

/** How Create groups formats by what they produce: video, picture, text, or ads. */
export type StudioGroup = "video" | "picture" | "text" | "ads";

export type StageId =
  "context" | "angle" | "outline" | "writing" | "brief" | "render" | "save" | "captions" | "polish";

export type StageDef = { id: StageId; label: string };

export type StudioFormat = {
  id: StudioType;
  group: StudioGroup;
  label: string;
  /** Singular noun for sentences: "Your carousel is ready". */
  noun: string;
  description: string;
  /** A few words for compact pickers. */
  tagline: string;
  /** content_items.kind the output is stored as. */
  kind: "post" | "image" | "carousel" | "video" | "blog" | "script" | "ad";
  agent: "echo" | "spark" | "scout";
  /** Platforms this type can target; empty = not platform-bound (article). */
  platforms: PlatformId[];
  defaultPlatforms: PlatformId[];
  /** Whether several platforms can be selected at once. */
  multiPlatform: boolean;
  ratios: AspectRatio[];
  media: "none" | "optional-image" | "image" | "video";
  /** Honest typical duration, shown before generating. */
  estimate: string;
  stages: StageDef[];
  placeholder: string;
};

const SOCIAL_PLATFORMS: PlatformId[] = [
  "linkedin",
  "instagram",
  "twitter",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
];

export const STUDIO_GROUPS: { id: StudioGroup; label: string; types: StudioType[] }[] = [
  { id: "video", label: "Video", types: ["video", "script"] },
  { id: "picture", label: "Picture", types: ["image", "carousel"] },
  { id: "text", label: "Text", types: ["social", "article"] },
  { id: "ads", label: "Ads", types: ["ad"] },
];

export const STUDIO_FORMATS: Record<StudioType, StudioFormat> = {
  social: {
    id: "social",
    group: "text",
    label: "Social post",
    noun: "post",
    description: "Text written for each social platform, with an optional image.",
    tagline: "Captions for your social channels",
    kind: "post",
    agent: "echo",
    platforms: SOCIAL_PLATFORMS,
    defaultPlatforms: ["linkedin", "instagram"],
    multiPlatform: true,
    ratios: IMAGE_RATIOS,
    media: "optional-image",
    estimate: "About 20 seconds",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "angle", label: "Picking the best idea" },
      { id: "writing", label: "Writing a version for each platform" },
      { id: "polish", label: "Final checks" },
    ],
    placeholder: "e.g. Tell people about our new summer menu and invite them to visit this weekend",
  },
  carousel: {
    id: "carousel",
    group: "picture",
    label: "Carousel",
    noun: "carousel",
    description: "Several slides people swipe through, with a caption.",
    tagline: "Swipeable slides",
    kind: "carousel",
    agent: "echo",
    platforms: ["instagram", "linkedin", "facebook"],
    defaultPlatforms: ["instagram"],
    multiPlatform: true,
    ratios: ["4:5", "1:1"],
    media: "optional-image",
    estimate: "About 30 seconds",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "outline", label: "Planning the slides" },
      { id: "writing", label: "Writing slides and caption" },
      { id: "polish", label: "Designing the slides" },
    ],
    placeholder: "e.g. 5 simple ways to save money on your energy bill",
  },
  image: {
    id: "image",
    group: "picture",
    label: "Image post",
    noun: "image",
    description: "An image in your brand style, with a matching caption.",
    tagline: "An image with a caption",
    kind: "image",
    agent: "spark",
    platforms: SOCIAL_PLATFORMS,
    defaultPlatforms: ["instagram"],
    multiPlatform: true,
    ratios: IMAGE_RATIOS,
    media: "image",
    estimate: "Usually under a minute",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "brief", label: "Planning the image" },
      { id: "captions", label: "Writing captions to match" },
      { id: "render", label: "Creating the image" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "e.g. Our iced coffee on a sunny café table, with a caption about the heatwave",
  },
  ad: {
    id: "ad",
    group: "ads",
    label: "Ad",
    noun: "ad",
    description: "Ad text and an image, in a few versions to test.",
    tagline: "Ad copy and a visual to test",
    kind: "ad",
    agent: "spark",
    platforms: ["facebook", "instagram", "linkedin"],
    defaultPlatforms: ["facebook", "instagram"],
    multiPlatform: true,
    ratios: ["1:1", "4:5", "9:16"],
    media: "image",
    estimate: "About a minute",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "angle", label: "Picking ideas to test" },
      { id: "writing", label: "Writing ad versions" },
      { id: "render", label: "Creating the ad image" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "e.g. 20% off our online course for small business owners, ends Friday",
  },
  video: {
    id: "video",
    group: "video",
    label: "AI video",
    noun: "video",
    description: "A short AI-made video with captions.",
    tagline: "A short AI video",
    kind: "video",
    agent: "spark",
    platforms: ["instagram", "tiktok", "youtube", "linkedin", "facebook", "twitter"],
    defaultPlatforms: ["instagram", "tiktok"],
    multiPlatform: true,
    ratios: VIDEO_RATIOS,
    media: "video",
    estimate: "Usually 1–3 minutes",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "brief", label: "Planning the scenes" },
      { id: "captions", label: "Writing captions" },
      { id: "render", label: "Creating the video" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "e.g. A slow close-up of our handmade candle being lit in a cosy room",
  },
  script: {
    id: "script",
    group: "video",
    label: "Video script",
    noun: "video script",
    description: "What to say and show in a Reel, TikTok or Short.",
    tagline: "What to say and show in a short video",
    kind: "script",
    agent: "spark",
    platforms: ["instagram", "tiktok", "youtube"],
    defaultPlatforms: ["instagram"],
    multiPlatform: false,
    ratios: [],
    media: "none",
    estimate: "About 20 seconds",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "angle", label: "Writing the opening" },
      { id: "writing", label: "Writing the scenes" },
      { id: "polish", label: "Fitting it to time" },
    ],
    placeholder: "e.g. A 30-second video showing 3 quick tips for better sleep",
  },
  article: {
    id: "article",
    group: "text",
    label: "Blog article",
    noun: "article",
    description: "A full blog article with a title and clear sections.",
    tagline: "A blog article",
    kind: "blog",
    agent: "spark",
    platforms: [],
    defaultPlatforms: [],
    multiPlatform: false,
    ratios: [],
    media: "none",
    estimate: "About 45 seconds",
    stages: [
      { id: "context", label: "Reading your brand" },
      { id: "outline", label: "Planning the sections" },
      { id: "writing", label: "Writing the article" },
      { id: "polish", label: "Editing" },
    ],
    placeholder: "e.g. How to choose the right running shoes as a beginner",
  },
};

export const STUDIO_TYPE_ORDER: StudioType[] = STUDIO_GROUPS.flatMap((g) => g.types);

export function isStudioType(value: unknown): value is StudioType {
  return typeof value === "string" && value in STUDIO_FORMATS;
}

/**
 * Accept current ids plus the pre-rebuild canvas names still emitted by chat
 * tool calls, saved URLs, and localStorage. Retired formats map to the closest
 * type that still exists.
 */
const ALIASES: Record<string, StudioType> = {
  "social-post": "social",
  post: "social",
  social: "social",
  "design-asset": "image",
  design: "image",
  creative: "image",
  visual: "image",
  image: "image",
  carousel: "carousel",
  video: "video",
  reel: "script",
  script: "script",
  ad: "ad",
  ads: "ad",
  "ad-creative": "ad",
  article: "article",
  blog: "article",
  "seo-brief": "article",
  seo: "article",
  "landing-page": "article",
  landing: "article",
  email: "article",
  newsletter: "article",
};

export function normalizeStudioType(value: unknown): StudioType | null {
  if (typeof value !== "string") return null;
  return ALIASES[value.toLowerCase().trim()] ?? null;
}

/** Kinds Studio no longer creates. Existing rows stay viewable and approvable. */
export const LEGACY_KINDS: Record<string, string> = {
  brief: "SEO brief",
  email: "Email",
  landing: "Landing page",
};

export type ContentTypeResolution = StudioType | "legacy";

export function studioTypeFromContent(
  kind: string | null | undefined,
  meta?: Record<string, unknown> | null,
): ContentTypeResolution {
  const tagged = meta && typeof meta.studio_type === "string" ? meta.studio_type : null;
  if (isStudioType(tagged)) return tagged;
  if (kind && kind in LEGACY_KINDS) return "legacy";
  switch (kind) {
    case "blog":
      return "article";
    case "carousel":
    case "video":
    case "script":
    case "ad":
    case "image":
      return kind;
    default:
      return meta && (meta.asset_id || meta.canvas === "design-asset") ? "image" : "social";
  }
}

/** content_items.channel for a platform (the content schema says "x", not "twitter"). */
export function channelForPlatform(platform: PlatformId): string {
  return platform === "twitter" ? "x" : platform;
}
