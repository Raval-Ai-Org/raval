// What can be made from a finished Studio piece, and how the new composer
// starts: the same facts in a new form (a post becomes a carousel, an article
// becomes a script, a picture becomes a video). Opening one is free; the
// person sees the price on Generate. The server reads the source piece by id
// (`intent.sourceContentId`, checked against the job's workspace) and every
// prompt keeps its facts (`sourceSection` in prompts.ts).
// Pure and browser-safe.
import type { PlatformId } from "@/lib/social-platforms";
import { STUDIO_FORMATS, type StudioType } from "./formats";
import { animateBrief, canAnimatePiece, videoRatioForImage } from "./video-ad";
import type { StudioJob } from "./jobs";

export type RepurposeTarget = {
  type: StudioType;
  label: string;
  hint: string;
  /** Video from a finished picture: the picture opens the video, kept exact. */
  animate?: boolean;
};

const HINTS: Record<StudioType, string> = {
  social: "A caption for each channel",
  image: "One picture with a caption",
  carousel: "The points as swipeable slides",
  story: "A few full-screen frames",
  ad: "A designed ad with its copy",
  article: "A full article for your website",
  script: "A short video script, scene by scene",
  video: "A short AI video",
};

/** What each format is best turned into, most useful first. */
const TARGETS: Record<StudioType, StudioType[]> = {
  social: ["carousel", "image", "story", "script", "ad", "article"],
  image: ["video", "carousel", "story", "ad", "social"],
  carousel: ["script", "story", "social", "article", "ad"],
  story: ["carousel", "social", "ad"],
  ad: ["video", "story", "carousel", "social"],
  article: ["carousel", "social", "script", "story"],
  // Script → video is its own button (ScriptVideoActions), with the scenes attached.
  script: ["carousel", "social", "story"],
  video: ["social", "carousel", "story", "article"],
};

/**
 * The formats a piece can become. A video from a picture only when the piece
 * has a finished picture; otherwise AI video is left out (a text piece makes
 * a script first, which then becomes a video with its scenes).
 */
export function repurposeTargets(from: StudioType, hasPicture: boolean): RepurposeTarget[] {
  return TARGETS[from]
    .filter((type) => type !== "video" || (hasPicture && canAnimatePiece(from)))
    .map((type) => ({
      type,
      label: type === "video" ? "Video" : STUDIO_FORMATS[type].label,
      hint: type === "video" ? "Bring this picture to life" : HINTS[type],
      ...(type === "video" ? { animate: true } : {}),
    }));
}

/** The brief the new composer starts with; the person can change it before Generate. */
export function repurposeBrief(
  from: StudioType,
  to: StudioType,
  title: string | null | undefined,
): string {
  const name = title?.trim() ? ` "${title.trim().slice(0, 100)}"` : "";
  const what = STUDIO_FORMATS[from].noun;
  const into = STUDIO_FORMATS[to].noun;
  return `Turn my ${what}${name} into ${/^[aeiou]/i.test(into) ? "an" : "a"} ${into}. Keep the same facts, offer and call to action, and make it work as ${/^[aeiou]/i.test(into) ? "an" : "a"} ${into}.`;
}

/** How the composer names the piece it starts from. */
export function sourceLabelFor(from: StudioType, title: string | null | undefined): string {
  const name = title?.trim() ? ` "${title.trim().slice(0, 80)}"` : "";
  return `your ${STUDIO_FORMATS[from].noun}${name}`;
}

/** The channels that carry over: the ones the new format can post to, else its defaults. */
export function carriedPlatforms(platforms: PlatformId[], to: StudioType): PlatformId[] {
  const format = STUDIO_FORMATS[to];
  const kept = platforms.filter((p) => format.platforms.includes(p));
  if (!kept.length) return format.defaultPlatforms;
  return format.multiPlatform ? kept : kept.slice(0, 1);
}

export type RepurposeOpen = {
  type: StudioType;
  brief: string;
  sourceContentId: string;
  sourceLabel: string;
  platforms: PlatformId[];
  referenceAssetIds?: string[];
  referenceMode?: "preserve";
  durationSec?: number;
  ratio?: "9:16" | "1:1" | "16:9";
};

/** Everything `openComposer` needs for one target. */
export function repurposeOpen(args: {
  from: StudioType;
  target: RepurposeTarget;
  contentItemId: string;
  title?: string | null;
  platforms: PlatformId[];
  picture?: { assetId?: string | null; ratio?: string } | null;
}): RepurposeOpen {
  const { target } = args;
  const base = {
    type: target.type,
    sourceContentId: args.contentItemId,
    sourceLabel: sourceLabelFor(args.from, args.title),
    platforms: carriedPlatforms(args.platforms, target.type),
  };
  if (target.animate && args.picture?.assetId)
    return {
      ...base,
      brief: animateBrief({ type: args.from, title: args.title }),
      referenceAssetIds: [args.picture.assetId],
      referenceMode: "preserve",
      durationSec: 8,
      ratio: videoRatioForImage(args.picture.ratio),
    };
  return { ...base, brief: repurposeBrief(args.from, target.type, args.title) };
}

/** What a finished job can start from: its first saved post, title, picture and channels. */
export type RepurposeSource = {
  from: StudioType;
  contentItemId: string;
  title: string | null;
  platforms: PlatformId[];
  picture: { assetId: string; ratio?: string } | null;
};

export function repurposeSourceFromJob(
  job: Pick<StudioJob, "type" | "status" | "title" | "content_item_ids" | "output" | "input">,
): RepurposeSource | null {
  const contentItemId = job.content_item_ids?.[0];
  if (job.status !== "succeeded" || !contentItemId) return null;
  const media = job.output?.media?.find((m) => m.slot === "main") ?? job.output?.media?.[0];
  const picture =
    media?.kind === "image" && media.status === "ready" && media.assetId
      ? { assetId: media.assetId, ratio: media.ratio }
      : null;
  const fromVariants = job.output?.variants?.map((v) => v.platform) ?? [];
  return {
    from: job.type,
    contentItemId,
    title: job.output?.title ?? job.title ?? null,
    platforms: fromVariants.length ? fromVariants : (job.input?.controls?.platforms ?? []),
    picture,
  };
}
