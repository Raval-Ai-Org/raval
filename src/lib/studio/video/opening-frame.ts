// The picture a video made from a post opens on. Pure and browser-safe: the
// server measures the post's picture and this module decides, before any
// video is paid for, whether the picture can open the video as it is, needs
// a small zoom, or must be recreated at the video's shape. A square post in
// a 9:16 Reel must never sit on a blurred copy of itself: the video model
// keeps those bars for the whole video.
//
// It also decides whether a video carries the brand's logo: only when the
// person asks for it. A post's corner badge is cleared from the opening
// frame otherwise, so the video model can't freeze it on every frame.

import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";

/** How the post's picture becomes the video's first frame. */
export type OpeningFrameFit =
  /** Already the video's shape. */
  | "same"
  /** A hair off: filled by a slight zoom that cuts only a thin edge. */
  | "zoom"
  /** A different shape (or a badge to clear): recreated at the video's shape. */
  | "reframe";

/** Shapes this close are the same shape (a 1080×1351 export is 4:5). */
export const SAME_SHAPE_TOLERANCE = 0.02;
/**
 * The most a zoom may cut from the picture, as a share of one side (half on
 * each edge). Kept below the logo's corner inset and the safe margins every
 * post keeps, so no word or mark is ever cut.
 */
export const MAX_ZOOM_CROP = 0.07;

function ratioOf(ratio: AspectRatio | string): number {
  const meta = RATIOS[ratio as AspectRatio];
  if (meta) return meta.w / meta.h;
  const [w, h] = String(ratio).split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
}

/** The share of one side a cover fit would cut from `picture` to reach `ratio`. */
export function coverCrop(picture: { width: number; height: number }, ratio: string): number {
  if (!picture.width || !picture.height) return 0;
  const aspect = picture.width / picture.height;
  const target = ratioOf(ratio);
  return 1 - Math.min(aspect, target) / Math.max(aspect, target);
}

export function openingFrameFit(
  picture: { width: number; height: number },
  ratio: string,
  opts: { clearBadge?: boolean } = {},
): OpeningFrameFit {
  const crop = coverCrop(picture, ratio);
  // A corner badge only comes off in a recreation, whatever the shape.
  if (opts.clearBadge) return "reframe";
  if (crop <= SAME_SHAPE_TOLERANCE) return "same";
  if (crop <= MAX_ZOOM_CROP) return "zoom";
  return "reframe";
}

const NO_LOGO =
  /\b(no|without|remove|hide|drop|skip|lose|ditch|leave out|don'?t (?:add|use|show|put|include))\s+(?:the\s+|my\s+|our\s+|a\s+|any\s+)?(?:brand\s+)?(?:logo|watermark|badge)s?\b|\blogo[- ]?free\b/i;
const WANTS_LOGO = /\b(?:logo|watermark)s?\b|\bbrand(?:ed)?\s+(?:badge|bug|mark)\b|\bbranding\b/i;

/**
 * Whether a video carries the brand's logo. Off unless the person's own
 * words ask for it; "no logo" always wins.
 */
export function wantsLogoInVideo(...texts: (string | null | undefined)[]): boolean {
  const said = texts.filter(Boolean).join("\n");
  if (!said.trim()) return false;
  if (NO_LOGO.test(said)) return false;
  return WANTS_LOGO.test(said);
}

const SHAPE_WORDS: Record<string, string> = {
  "9:16": "tall vertical 9:16 (a full-screen Reel or Story)",
  "4:5": "4:5 portrait",
  "3:4": "3:4 portrait",
  "2:3": "2:3 tall",
  "1:1": "square 1:1",
  "16:9": "wide 16:9 landscape",
  "4:3": "4:3 landscape",
};

/** The image edit that recreates a post at the video's shape. */
export function reframePrompt(args: {
  ratio: string;
  brandName: string;
  keepLogo: boolean;
  /** Where the post's code-placed badge sits, when it had one. */
  badgeCorner?: string | null;
}): string {
  const shape = SHAPE_WORDS[args.ratio] ?? args.ratio;
  return [
    `Recreate the supplied social post by ${args.brandName} as one ${shape} picture that fills the whole frame edge to edge. It opens a video, so it must be the same post, made for this shape.`,
    "Keep exactly: the product (same shape, colours and the words printed on it), the people, the scene, the light, the colours and the style. Do not redesign it.",
    "Fill the new space by extending the scene naturally (more background, surface, sky or room), and recompose so the subject sits well in the new shape. If the subject is small after extending, move in closer.",
    "Never add borders, bars, a blurred copy, a frame, a card, or a picture inside a picture.",
    "Keep the post's own headline words, spelled exactly, fully inside the frame and clear of the top 12% and bottom 18%. Add no new words.",
    args.keepLogo
      ? "Keep the brand's logo, small, in a calm corner where it touches no words and not the product."
      : `Leave out any small logo badge or watermark stamped in a corner${args.badgeCorner ? ` (usually the ${args.badgeCorner.replace("-", " ")} one)` : ""}: that corner is clean scene. The product's own printed label stays. Add no logo.`,
    "Nothing may overlap: words, the product and any mark each have their own clear space.",
  ].join("\n");
}

/** At least this share of the frames must show bars before a video fails. */
export const LETTERBOX_FRAME_SHARE = 0.6;
/** A seam is a row (or column) where at least this share of pixels changes sharply. */
export const SEAM_COVERAGE = 0.45;

/** What the server measures on one frame (see `frameProfile`). */
export type FrameProfile = {
  /** Per row, top to bottom: the share of columns that change sharply from the row above. */
  rows: number[];
  /** Per column, left to right: the share of rows that change sharply from the column before. */
  cols: number[];
  /** Edge energy of the outer 4% on each side, and of the middle. */
  detail: { top: number; bottom: number; left: number; right: number; middle: number };
};

/** Two straight seams mirrored about the centre: the edges of a picture laid on bars. */
function mirroredSeams(profile: readonly number[]): boolean {
  const n = profile.length;
  if (n < 24) return false;
  const lo = Math.round(n * 0.04);
  const hi = Math.round(n * 0.4);
  let best = -1;
  let at = -1;
  for (let i = lo; i <= hi; i++)
    if ((profile[i] ?? 0) > best) {
      best = profile[i] ?? 0;
      at = i;
    }
  if (best < SEAM_COVERAGE) return false;
  const mirror = n - at;
  const tolerance = Math.max(2, Math.round(n * 0.03));
  for (let j = mirror - tolerance; j <= mirror + tolerance; j++)
    if ((profile[j] ?? 0) >= SEAM_COVERAGE) return true;
  return false;
}

/**
 * Whether a frame is a picture sitting on bars (a blurred copy of itself, or
 * flat colour): two straight seams mirrored about the centre, and nearly no
 * detail outside them. A real scene with a table edge or a dark studio
 * backdrop has one of these, rarely both on both sides.
 */
export function looksLetterboxed(profile: FrameProfile): boolean {
  const { detail } = profile;
  const soft = (band: number) => band < Math.max(1.2, detail.middle * 0.22);
  if (detail.middle < 2.5) return false; // a calm picture overall: nothing to compare
  const vertical = soft(detail.top) && soft(detail.bottom) && mirroredSeams(profile.rows);
  const sideways = soft(detail.left) && soft(detail.right) && mirroredSeams(profile.cols);
  return vertical || sideways;
}

/** Whether enough of a video's frames sit on bars to call the video letterboxed. */
export function letterboxedVideo(profiles: readonly FrameProfile[]): boolean {
  if (!profiles.length) return false;
  const boxed = profiles.filter(looksLetterboxed).length;
  return boxed / profiles.length >= LETTERBOX_FRAME_SHARE;
}
