// The first frame of a video made from a post, checked before any video is
// paid for. The pure rules are in src/lib/studio/video/opening-frame.ts: a
// post of another shape (a square post for a 9:16 Reel or Story) is
// recreated at the video's shape by the image model, with the corner badge
// cleared unless the person asked for the logo, then checked (shape, no bars,
// a vision read for wrong words, a changed product or overlaps). A frame that
// fails gets one more try with the reasons; after that the post is used as a
// reference instead of the first frame, so the video still fills the screen.
// The recreation is at Mellox's cost, like every quality redo.
import "server-only";

import sharp from "sharp";

import { generateImage, type ImageSize } from "@/lib/openrouter-image.server";
import { hardImageDefects } from "@/lib/studio/image-defects";
import {
  looksLetterboxed,
  openingFrameFit,
  reframePrompt,
  type FrameProfile,
  type OpeningFrameFit,
} from "@/lib/studio/video/opening-frame";
import { reviewGeneratedImage } from "@/server/studio/image-review.server";
import { videoCanvasFor } from "./finish.server";

/** The image size the model makes for each video shape (then fitted exactly). */
const REFRAME_SIZE: Record<string, ImageSize> = {
  "9:16": "1024x1792",
  "2:3": "1024x1536",
  "3:4": "1024x1280",
  "4:5": "1024x1280",
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "4:3": "1792x1024",
};

const PROFILE_WIDTH = 180;

/** What `looksLetterboxed` reads from one picture (see FrameProfile). */
export async function frameProfile(picture: Buffer): Promise<FrameProfile> {
  const meta = await sharp(picture).metadata();
  const height = Math.max(
    24,
    Math.round((PROFILE_WIDTH * (meta.height ?? PROFILE_WIDTH)) / (meta.width ?? PROFILE_WIDTH)),
  );
  const w = PROFILE_WIDTH;
  const grey = await sharp(picture).greyscale().resize(w, height, { fit: "fill" }).raw().toBuffer();
  const rows: number[] = [0];
  for (let y = 1; y < height; y++) {
    let changed = 0;
    for (let x = 0; x < w; x++)
      if (Math.abs(grey[y * w + x] - grey[(y - 1) * w + x]) > 6) changed += 1;
    rows.push(changed / w);
  }
  const cols: number[] = [0];
  for (let x = 1; x < w; x++) {
    let changed = 0;
    for (let y = 0; y < height; y++)
      if (Math.abs(grey[y * w + x] - grey[y * w + x - 1]) > 6) changed += 1;
    cols.push(changed / height);
  }
  const lap = await sharp(picture)
    .greyscale()
    .resize(w, height, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  const spread = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y++)
      for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
        const v = lap[y * w + x];
        sum += v;
        sq += v * v;
        n += 1;
      }
    return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
  };
  const bh = Math.max(2, Math.round(height * 0.04));
  const bw = Math.max(2, Math.round(w * 0.04));
  return {
    rows,
    cols,
    detail: {
      top: spread(0, 0, w, bh + 1),
      bottom: spread(0, height - bh - 1, w, height),
      left: spread(0, 0, bw + 1, height),
      right: spread(w - bw - 1, 0, w, height),
      middle: spread(0, Math.round(height * 0.3), w, Math.round(height * 0.7)),
    },
  };
}

export type OpeningFrame = {
  /** The picture the video opens on, at the video's exact size; null = use the post as a reference only. */
  frame: Buffer | null;
  fit: OpeningFrameFit | "reference";
  /** What the checks found, in plain words, when the recreation was not used. */
  note?: string;
};

/** The picture exactly the video's size by a cover fit (only for a thin edge). */
async function coverTo(picture: Buffer, ratio: string): Promise<Buffer> {
  const { width, height } = videoCanvasFor(ratio);
  return sharp(picture)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Problems with a recreated frame, before any video is made from it. */
async function frameIssues(
  frame: Buffer,
  ctx: { brandName: string; keepLogo: boolean; ratio: string },
): Promise<string[]> {
  const issues: string[] = [];
  const meta = await sharp(frame).metadata();
  const stats = await sharp(frame).stats();
  if (!meta.width || !meta.height) return ["The recreated picture could not be read."];
  if (stats.channels.every((channel) => channel.stdev < 6))
    issues.push("The recreated picture is blank.");
  if (looksLetterboxed(await frameProfile(frame)))
    issues.push("The recreated picture sits on bars instead of filling the frame.");
  if (issues.length) return issues;
  const review = await reviewGeneratedImage(
    `data:image/jpeg;base64,${(await sharp(frame).jpeg({ quality: 85 }).toBuffer()).toString("base64")}`,
    [
      `The first frame of a ${ctx.ratio} video by ${ctx.brandName}, recreated from the brand's own post at this shape.`,
      "Flag: bars, borders, a blurred copy or a picture inside a picture; the product's shape, colours or label words changed; misspelled, cut or extra words; words, a logo or a badge overlapping each other or the product; headline words cut at an edge.",
      ctx.keepLogo
        ? "A small brand logo in one clear corner is expected."
        : "No logo badge or watermark is expected in a corner (the product's own printed label is fine).",
    ].join("\n"),
  );
  if (!review || review.status === "pass") return [];
  const hard = hardImageDefects(review.issues);
  const framing = review.issues.filter((issue) =>
    /\b(bar|bars|border|letterbox|picture inside|blurred copy|overlap|collid|cut off|cropped)\b/i.test(
      issue,
    ),
  );
  const badge = ctx.keepLogo
    ? []
    : review.issues.filter((issue) =>
        /\b(watermark|logo badge|badge in the corner)\b/i.test(issue),
      );
  return [...new Set([...hard, ...framing, ...badge])];
}

/**
 * The opening frame for a video made from `picture`. Never throws for a
 * failed recreation: the caller always gets a usable answer.
 */
export async function openingFrameForVideo(args: {
  picture: Buffer;
  /** A signed https URL (or data URL) of the same picture, for the image model. */
  pictureUrl: string;
  ratio: string;
  brandName: string;
  keepLogo: boolean;
  /** The corner a code-placed logo sits in on the post, when it had one. */
  badgeCorner?: string | null;
}): Promise<OpeningFrame> {
  const meta = await sharp(args.picture).metadata();
  const shape = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const fit = openingFrameFit(shape, args.ratio, {
    clearBadge: !!args.badgeCorner && !args.keepLogo,
  });
  if (fit === "same" || fit === "zoom")
    return { frame: await coverTo(args.picture, args.ratio), fit };

  const base = reframePrompt({
    ratio: args.ratio,
    brandName: args.brandName,
    keepLogo: args.keepLogo,
    badgeCorner: args.badgeCorner,
  });
  let prompt = base;
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const made = await generateImage({
        prompt,
        size: REFRAME_SIZE[args.ratio] ?? "1024x1792",
        routing: {
          taskType: "editing",
          editing: true,
          hasReference: true,
          referenceAssets: [args.pictureUrl],
          iteration: attempt ? "refinement" : "first",
        },
        meterRoute: "studio.image.reframe",
      });
      const frame = await coverTo(Buffer.from(made.b64, "base64"), args.ratio);
      issues = await frameIssues(frame, args);
      if (!issues.length) return { frame, fit: "reframe" };
      prompt = [
        "The last try was rejected by the check. Fix exactly these and keep everything else:",
        ...issues.map((issue) => `- ${issue}`),
        "",
        base,
      ].join("\n");
    } catch (error) {
      issues = [error instanceof Error ? error.message : "The recreation failed."];
      break;
    }
  }
  console.warn("[studio] opening frame not recreated", issues.join(" | "));
  // A same-shape post with only its badge to clear: open on it as it is.
  if (openingFrameFit(shape, args.ratio) !== "reframe")
    return { frame: await coverTo(args.picture, args.ratio), fit: "same", note: issues[0] };
  // The post leads as a reference, so the video still fills the screen. (A
  // living picture, which must open on its picture, is shown whole by the caller.)
  return { frame: null, fit: "reference", note: issues[0] };
}
