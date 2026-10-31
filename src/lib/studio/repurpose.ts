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
import type { StudioControls, StudioJob } from "./jobs";
import type { VideoKindId } from "./video/kinds";

export type RepurposeTarget = {
  type: StudioType;
  label: string;
  hint: string;
  /** Video from a finished picture: the picture opens the video, kept exact. */
  animate?: boolean;
  /** Which kind of video the picture becomes (src/lib/studio/video/kinds.ts). */
  videoKind?: VideoKindId;
};

/**
 * A finished picture becomes one of three videos: the post itself gently
 * moving (AI), the post with camera moves and nothing redrawn (code, no AI),
 * or a short story that opens on the post and ends back on it.
 */
const PICTURE_VIDEOS: { kind: VideoKindId; label: string; hint: string; seconds?: number }[] = [
  {
    kind: "living-picture",
    label: "Bring it to life",
    hint: "Your post, gently moving",
    seconds: 8,
  },
  { kind: "motion-post", label: "Motion post", hint: "Smooth moves over your post, no AI" },
  {
    kind: "brand-story",
    label: "Story video",
    hint: "A short story that starts from this post",
    seconds: 16,
  },
];

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
    .flatMap((type): RepurposeTarget[] =>
      type === "video"
        ? PICTURE_VIDEOS.map((video) => ({
            type,
            label: video.label,
            hint: video.hint,
            animate: true,
            videoKind: video.kind,
          }))
        : [{ type, label: STUDIO_FORMATS[type].label, hint: HINTS[type] }],
    );
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

/** A short story video that opens on the finished picture and ends back on it. */
function storyFromPictureBrief(from: StudioType, title: string | null | undefined): string {
  const name = title?.trim() ? ` "${title.trim().slice(0, 100)}"` : "";
  return `Make a short story video from my ${STUDIO_FORMATS[from].noun}${name}. Open on the picture, tell one small moment with the same product, colours and place, and end back on the picture. Keep the same facts and call to action.`;
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
  extraControls?: Pick<StudioControls, "videoKind" | "videoMode" | "recapMotion">;
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
  if (target.animate && args.picture?.assetId) {
    const kind = target.videoKind ?? "living-picture";
    const video = PICTURE_VIDEOS.find((v) => v.kind === kind);
    return {
      ...base,
      brief:
        kind === "brand-story"
          ? storyFromPictureBrief(args.from, args.title)
          : animateBrief({ type: args.from, title: args.title }),
      referenceAssetIds: [args.picture.assetId],
      referenceMode: "preserve",
      ...(video?.seconds ? { durationSec: video.seconds } : {}),
      ratio: videoRatioForImage(args.picture.ratio),
      extraControls:
        kind === "motion-post"
          ? { videoKind: kind, videoMode: "recap", recapMotion: "camera" }
          : { videoKind: kind },
    };
  }
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
