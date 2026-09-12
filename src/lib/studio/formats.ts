// Studio's creation types — the single definition every surface reads (composer,
// rail, command bar, chat chips, server job runner). Pure: no React, no server.
import type { PlatformId } from "@/lib/social-platforms";
import { IMAGE_RATIOS, VIDEO_RATIOS, type AspectRatio } from "./aspect";

export type StudioType = "social" | "image" | "carousel" | "video" | "article" | "script" | "ad";

export type StudioGroup = "posts" | "visuals" | "video" | "longform";

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
  { id: "posts", label: "Posts", types: ["social", "carousel"] },
  { id: "visuals", label: "Visuals", types: ["image", "ad"] },
  { id: "video", label: "Video", types: ["video", "script"] },
  { id: "longform", label: "Long-form", types: ["article"] },
];

export const STUDIO_FORMATS: Record<StudioType, StudioFormat> = {
  social: {
    id: "social",
    group: "posts",
    label: "Social post",
    noun: "post",
    description: "Native copy for each platform, with an optional visual.",
    kind: "post",
    agent: "echo",
    platforms: SOCIAL_PLATFORMS,
    defaultPlatforms: ["linkedin", "instagram"],
    multiPlatform: true,
    ratios: IMAGE_RATIOS,
    media: "optional-image",
    estimate: "About 20 seconds",
    stages: [
      { id: "context", label: "Reading your brand and recent posts" },
      { id: "angle", label: "Choosing a fresh angle" },
      { id: "writing", label: "Writing a native version per platform" },
      { id: "polish", label: "Checking limits and polishing" },
    ],
    placeholder: "What should this post make people think, feel, or do?",
  },
  carousel: {
    id: "carousel",
    group: "posts",
    label: "Carousel",
    noun: "carousel",
    description: "A swipeable multi-slide story with a hook, value, and a CTA.",
    kind: "carousel",
    agent: "echo",
    platforms: ["instagram", "linkedin", "facebook"],
    defaultPlatforms: ["instagram"],
    multiPlatform: true,
    ratios: ["4:5", "1:1"],
    media: "optional-image",
    estimate: "About 30 seconds",
    stages: [
      { id: "context", label: "Reading your brand and recent posts" },
      { id: "outline", label: "Structuring the slide story" },
      { id: "writing", label: "Writing slides and caption" },
      { id: "polish", label: "Designing slides" },
    ],
    placeholder: "What should someone understand after the last slide?",
  },
  image: {
    id: "image",
    group: "visuals",
    label: "Image post",
    noun: "image",
    description: "An on-brand visual first, with captions written to match it.",
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
      { id: "brief", label: "Building the creative brief" },
      { id: "captions", label: "Writing captions to match" },
      { id: "render", label: "Rendering the visual" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "Describe the idea or moment the visual should capture.",
  },
  ad: {
    id: "ad",
    group: "visuals",
    label: "Ad creative",
    noun: "ad",
    description: "Paid-social copy variants to test, with a visual sized for the placement.",
    kind: "ad",
    agent: "spark",
    platforms: ["facebook", "instagram", "linkedin"],
    defaultPlatforms: ["facebook", "instagram"],
    multiPlatform: true,
    ratios: ["1:1", "4:5", "9:16"],
    media: "image",
    estimate: "About a minute",
    stages: [
      { id: "context", label: "Reading your brand and offer" },
      { id: "angle", label: "Choosing test angles" },
      { id: "writing", label: "Writing ad variants" },
      { id: "render", label: "Rendering the ad visual" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "What are you promoting, and what should people do after seeing it?",
  },
  video: {
    id: "video",
    group: "video",
    label: "Video post",
    noun: "video",
    description: "A short generated video with platform captions.",
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
      { id: "brief", label: "Planning the shots" },
      { id: "captions", label: "Writing captions" },
      { id: "render", label: "Rendering the video" },
      { id: "save", label: "Saving to your Library" },
    ],
    placeholder: "What happens in the video, and what should viewers take away?",
  },
  script: {
    id: "script",
    group: "video",
    label: "Short-form script",
    noun: "script",
    description: "A Reel, TikTok, or Shorts script: hook, beats, on-screen text, CTA.",
    kind: "script",
    agent: "spark",
    platforms: ["instagram", "tiktok", "youtube"],
    defaultPlatforms: ["instagram"],
    multiPlatform: false,
    ratios: [],
    media: "none",
    estimate: "About 20 seconds",
    stages: [
      { id: "context", label: "Reading your brand and recent posts" },
      { id: "angle", label: "Finding the hook" },
      { id: "writing", label: "Writing the beats" },
      { id: "polish", label: "Tightening for time" },
    ],
    placeholder: "What's the one idea this video should land in under a minute?",
  },
  article: {
    id: "article",
    group: "longform",
    label: "Article",
    noun: "article",
    description: "A structured, readable blog article with a title, outline, and takeaways.",
    kind: "blog",
    agent: "spark",
    platforms: [],
    defaultPlatforms: [],
    multiPlatform: false,
    ratios: [],
    media: "none",
    estimate: "About 45 seconds",
    stages: [
      { id: "context", label: "Reading your brand and published work" },
      { id: "outline", label: "Outlining the argument" },
      { id: "writing", label: "Writing the article" },
      { id: "polish", label: "Editing for clarity" },
    ],
    placeholder: "What question does this article answer for your audience?",
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
