// Captions for a brand's own clips: what was said, in short readable chunks,
// timed to the speech and placed clear of the app's buttons. The words come
// from a transcript of the finished video's sound; everything else (chunks,
// timing, the one highlighted word, colours, position) is decided here.
// Pure and browser-safe.
import { contrastRatio, normalizeHex } from "@/lib/color";
import type { AspectRatio } from "./aspect";
import type { Span } from "./smart-cut";

export type Segment = { start: number; end: number; text: string };

export type Cue = {
  start: number;
  end: number;
  /** Words per line, as shown. */
  lines: string[][];
  /** [line, word] of the highlighted word, or null. */
  emphasis: [number, number] | null;
};

export const CUE_MIN_SECONDS = 0.7;
export const CUE_MAX_SECONDS = 2.6;
const MAX_LINES = 2;
const MAX_SEGMENT_CHARS = 400;
/** A video this long has room for this many cues at most (one every ~0.7 s). */
export const MAX_CUES = 90;

const round = (n: number) => Math.round(n * 100) / 100;

/** Characters per line for the shape (portrait lines are short). */
export function lineChars(ratio: AspectRatio): number {
  return ratio === "16:9" || ratio === "4:3" ? 32 : 18;
}

// Control characters, zero-width marks and text-direction overrides.
const HIDDEN = new RegExp("[\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]", "gu");

function clean(text: string): string {
  return text.replace(HIDDEN, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SEGMENT_CHARS);
}

/**
 * Keep only believable segments: inside the video, with real text, not in a
 * stretch FFmpeg measured as silent (a transcriber that hears words in
 * silence is guessing), and not the same line again and again.
 */
export function believableSegments(
  segments: Segment[],
  duration: number,
  silences: Span[] = [],
): Segment[] {
  const kept: Segment[] = [];
  const sorted = segments
    .map((s) => ({
      start: Math.max(0, Number(s.start)),
      end: Math.min(duration, Number(s.end)),
      text: clean(String(s.text ?? "")),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= 0.2)
    .filter((s) => /[\p{L}\p{N}]/u.test(s.text))
    .sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    const quiet = silences.reduce(
      (sum, q) => sum + Math.max(0, Math.min(q.end, s.end) - Math.max(q.start, s.start)),
      0,
    );
    if (quiet / (s.end - s.start) > 0.8) continue;
    const repeats = kept.slice(-2).filter((k) => k.text.toLowerCase() === s.text.toLowerCase());
    if (repeats.length >= 2) continue;
    const previous = kept.at(-1);
    if (previous && s.start < previous.end) s.start = previous.end;
    if (s.end - s.start >= 0.2) kept.push(s);
  }
  return kept;
}

/** Split words into at most two lines of `max` characters; null if they don't fit. */
export function wrapWords(words: string[], max: number): string[][] | null {
  const lines: string[][] = [[]];
  for (const word of words) {
    const line = lines[lines.length - 1];
    const length = line.join(" ").length;
    if (!line.length || length + 1 + word.length <= max) line.push(word);
    else if (lines.length < MAX_LINES) lines.push([word]);
    else return null;
  }
  // One word longer than a line still shows, on its own.
  return lines;
}

const STOP = new Set(
  "the a an and or but so of to in on at for with from by is are was were be been it its this that these those you your we our they their i me my he she his her them as if then than just very really also not no yes do does did have has had will would can could should".split(
    " ",
  ),
);

/** The word worth colouring: a number first, else the longest word that carries meaning. */
export function emphasisOf(lines: string[][]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = 0;
  lines.forEach((line, l) =>
    line.forEach((word, w) => {
      const bare = word.replace(/[^\p{L}\p{N}%$€£]/gu, "");
      if (!bare) return;
      const score = /\p{N}/u.test(bare)
        ? 100 + bare.length
        : STOP.has(bare.toLowerCase()) || bare.length < 4
          ? 0
          : bare.length;
      if (score > bestScore) {
        bestScore = score;
        best = [l, w];
      }
    }),
  );
  return best;
}

/**
 * Cues from transcript segments: a few words at a time, broken after
 * punctuation where it can, each on screen long enough to read and never
 * overlapping the next. Word times are spread across their segment by length.
 */
export function buildCues(segments: Segment[], ratio: AspectRatio, duration: number): Cue[] {
  const max = lineChars(ratio);
  const cues: Cue[] = [];
  for (const segment of segments) {
    const words = segment.text.split(" ").filter(Boolean);
    if (!words.length) continue;
    const weight = words.map((w) => w.length + 1);
    const total = weight.reduce((a, b) => a + b, 0);
    const span = segment.end - segment.start;
    const at: number[] = [];
    let run = 0;
    for (const w of weight) {
      at.push(segment.start + (span * run) / total);
      run += w;
    }
    at.push(segment.end);

    let from = 0;
    while (from < words.length) {
      let to = from + 1;
      while (to < words.length) {
        const fits = wrapWords(words.slice(from, to + 1), max);
        const long = at[to + 1] - at[from] > CUE_MAX_SECONDS;
        if (!fits || long) break;
        to += 1;
        // A cue ends at the end of a clause once it has a couple of words.
        if (/[.,!?;:…]$/.test(words[to - 1]) && to - from >= 2) break;
      }
      // Cut mid-clause, a small word ("at", "the") goes on with what follows.
      const last = words[to - 1].replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
      if (
        to < words.length &&
        to - from >= 3 &&
        STOP.has(last) &&
        !/[.,!?;:…]$/.test(words[to - 1])
      )
        to -= 1;
      const lines = wrapWords(words.slice(from, to), max) ?? [words.slice(from, to)];
      cues.push({ start: at[from], end: at[to], lines, emphasis: emphasisOf(lines) });
      from = to;
    }
  }
  // Long enough to read; never under the next cue; inside the video.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1]?.start ?? duration;
    cues[i].end = Math.min(next, Math.max(cues[i].end, cues[i].start + CUE_MIN_SECONDS), duration);
    cues[i].start = round(cues[i].start);
    cues[i].end = round(cues[i].end);
  }
  return cues.filter((c) => c.end - c.start >= 0.2).slice(0, MAX_CUES);
}

/**
 * Where captions sit: centred, below the middle, above the bottom bar of
 * Reels / TikTok / Shorts (buttons and the caption sheet cover the lowest
 * fifth of a portrait video) and inside the side margins.
 */
export function captionBox(
  ratio: AspectRatio,
  canvas: { width: number; height: number },
): { y: number; height: number; width: number; fontSize: number } {
  const centre: Record<AspectRatio, number> = {
    "9:16": 0.66,
    "4:5": 0.72,
    "3:4": 0.72,
    "1:1": 0.72,
    "4:3": 0.78,
    "16:9": 0.78,
  };
  const portrait = canvas.height > canvas.width;
  const fontSize = Math.round(canvas.width * (portrait || ratio === "1:1" ? 0.062 : 0.034));
  const height = Math.round(fontSize * 1.3 * MAX_LINES + fontSize * 1.1);
  const y = Math.round(canvas.height * centre[ratio] - height / 2);
  return { y: y - (y % 2), height: height + (height % 2), width: canvas.width, fontSize };
}

export type CaptionColours = { text: string; plate: string; highlight: string };

const PLATE = "#121214";

function chroma(hex: string): number {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...rgb) - Math.min(...rgb);
}

/**
 * White words on a dark see-through plate, with the highlighted word in the
 * brand's colour, lifted toward white until it reads on the plate.
 */
export function captionColours(brandColours: string[]): CaptionColours {
  const candidates = brandColours
    .map((c) => normalizeHex(c))
    // Greys, white and black say nothing about the brand; a hue does.
    .filter((c): c is string => !!c && chroma(c) >= 48);
  let highlight = candidates.find((c) => contrastRatio(c, PLATE) >= 4.5) ?? null;
  if (!highlight && candidates[0]) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(candidates[0].slice(i, i + 2), 16));
    for (let t = 0.2; t <= 0.8 && !highlight; t += 0.2) {
      const lift = (x: number) =>
        Math.round(x + (255 - x) * t)
          .toString(16)
          .padStart(2, "0");
      const shade = `#${lift(r)}${lift(g)}${lift(b)}`;
      if (contrastRatio(shade, PLATE) >= 4.5) highlight = shade;
    }
  }
  return { text: "#ffffff", plate: "rgba(18,18,20,0.62)", highlight: highlight ?? "#ffd84d" };
}

/** Speech share of a video: how much of it isn't silence. */
export function speechShare(duration: number, silences: Span[]): number {
  if (duration <= 0) return 0;
  const quiet = silences.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  return Math.max(0, 1 - quiet / duration);
}

/** Below this share of sound there is nothing to caption, and no transcript is asked for. */
export const MIN_SPEECH_SHARE = 0.1;

/** The design note for the opening layer when captions will run under it. */
export const CAPTION_BAND_NOTE =
  "Captions of what is said will run across the band between 55% and 80% of the height, so keep that band free of words and shapes.";
