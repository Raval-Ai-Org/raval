// The words on a finished Studio video, as timed cues drawn by code (the
// storyboard's `onScreen`). Pure and browser-safe. Video models misspell
// words, so the footage carries none: a B-roll reel's hook line is held over
// the whole video, any other kind shows each clip's phrase during that clip.
// A video made from a post adds nothing: the post already has its words.

import { videoKind, type VideoKindId } from "./kinds";
import type { VideoStoryboard } from "./storyboard";
import type { ClipPlan } from "./lengths";

export type TextCue = {
  text: string;
  start: number;
  end: number;
  /** The hook line sits higher and larger; a clip's phrase sits in the upper third. */
  role: "hook" | "phrase";
};

const FADE = 0.25;
const round = (n: number) => Math.round(n * 100) / 100;

export function textCues(
  sb: VideoStoryboard,
  plan: ClipPlan,
  kind: VideoKindId,
  opts: { duration: number; fromPicture?: boolean },
): TextCue[] {
  const spec = videoKind(kind);
  if (opts.fromPicture || spec.ending === "end-card" || spec.join === "code") return [];
  const end = Math.max(0, opts.duration - FADE);
  if (spec.words === "hook") {
    const text = sb.clips[0]?.onScreen?.trim();
    return text && end > 1 ? [{ text, start: 0, end: round(end), role: "hook" }] : [];
  }
  return sb.clips
    .map((clip, i): TextCue | null => {
      const text = clip.onScreen?.trim();
      const at = plan[i];
      if (!text || !at) return null;
      const start = round(at.start + (i === 0 ? 0.2 : 0.4));
      const stop = round(Math.min(end, at.start + at.seconds - 0.4));
      return stop - start >= 1 ? { text, start, end: stop, role: "phrase" } : null;
    })
    .filter((cue): cue is TextCue => !!cue);
}

/** Cue timing for FFmpeg's alpha fades: in at the start, out at the end. */
export function cueFades(cue: TextCue): { inAt: number; outAt: number; seconds: number } {
  const seconds = Math.min(FADE, (cue.end - cue.start) / 3);
  return { inAt: cue.start, outAt: round(cue.end - seconds), seconds: round(seconds) };
}
