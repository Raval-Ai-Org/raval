// A closing frame the person chose (Home → Animate: "End frame", Holo's
// "first and last frames"). Pure and browser-safe.
//
// Only the picture-led kinds take one: they open on the person's picture and
// would otherwise settle back on it, so a chosen ending simply replaces that
// return. Story and product kinds end on their own hero frame and planned
// moment, which a still could only fight, so they never take one.
import type { VideoKindId } from "./kinds";

export const END_FRAME_KINDS: readonly VideoKindId[] = ["living-picture", "product-motion"];

export function acceptsEndFrame(kind: VideoKindId | undefined | null): boolean {
  return !!kind && END_FRAME_KINDS.includes(kind);
}

/** The direction every clip gets when the video must settle on a chosen still. */
export const END_FRAME_NOTE =
  "The video ends exactly on the supplied closing frame: move steadily towards it so the last shot settles on that picture, the same product, colours and words, nothing new added.";
