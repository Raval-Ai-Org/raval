// Which part of a brand's own clip is used, decided by code from what FFmpeg
// measured: scene changes (scdet), dead footage (blackdetect, freezedetect)
// and pauses in the sound (silencedetect). The same ideas as auto-editor and
// PySceneDetect, without a second toolchain. Nothing here redraws or reorders
// the footage; it only picks where each clip starts and stops.
// Pure and browser-safe.

export type Span = { start: number; end: number };

export type ClipAnalysis = {
  duration: number;
  hasAudio: boolean;
  /** Scene changes, in seconds. */
  cuts: number[];
  silences: Span[];
  frozen: Span[];
  dark: Span[];
};

/** Filters for one measuring pass (the video scaled down first, so it's quick). */
export const ANALYSIS_VIDEO_FILTER =
  "scale=160:-2,scdet=threshold=10,freezedetect=n=-60dB:d=1,blackdetect=d=0.3:pix_th=0.1";
export const ANALYSIS_AUDIO_FILTER = "silencedetect=noise=-35dB:d=0.5";

const num = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Pair start/end readings into spans; an unfinished span runs to the end. */
function pairs(starts: number[], ends: number[], duration: number): Span[] {
  const spans: Span[] = [];
  const sortedEnds = [...ends].sort((a, b) => a - b);
  for (const start of [...starts].sort((a, b) => a - b)) {
    const end = sortedEnds.find((e) => e > start) ?? duration;
    if (spans.length && start < spans[spans.length - 1].end) continue;
    spans.push({ start: Math.max(0, start), end: Math.min(duration, end) });
  }
  return spans.filter((s) => s.end - s.start > 0.01);
}

/** Read FFmpeg's log from the measuring pass. Unknown lines are ignored. */
export function parseAnalysis(log: string, duration: number, hasAudio: boolean): ClipAnalysis {
  const all = (re: RegExp) => [...log.matchAll(re)].map((m) => num(m[1])).filter((n) => n !== null);
  const cuts = [...new Set(all(/lavfi\.scd\.time:\s*([\d.]+)/g))]
    .filter((t) => t > 0.05 && t < duration - 0.05)
    .sort((a, b) => a - b);
  const dark: Span[] = [];
  for (const m of log.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) {
    const start = num(m[1]);
    const end = num(m[2]);
    if (start !== null && end !== null && end > start)
      dark.push({ start, end: Math.min(end, duration) });
  }
  return {
    duration,
    hasAudio,
    cuts,
    dark,
    frozen: pairs(
      all(/freezedetect\.freeze_start:\s*([\d.]+)/g),
      all(/freezedetect\.freeze_end:\s*([\d.]+)/g),
      duration,
    ),
    silences: hasAudio
      ? pairs(all(/silence_start:\s*(-?[\d.]+)/g), all(/silence_end:\s*([\d.]+)/g), duration)
      : [],
  };
}

/** A clip known only by its length: nothing measured, nothing assumed. */
export function plainAnalysis(duration: number): ClipAnalysis {
  return { duration, hasAudio: false, cuts: [], silences: [], frozen: [], dark: [] };
}

function overlap(spans: Span[], from: number, to: number): number {
  let total = 0;
  for (const s of spans) total += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  return total;
}

/** Someone talks in the clip: some sound, and pauses that aren't the whole clip. */
export function isTalky(a: ClipAnalysis): boolean {
  if (!a.hasAudio || a.duration <= 0) return false;
  return overlap(a.silences, 0, a.duration) / a.duration < 0.8;
}

const dead = (a: ClipAnalysis) => [...a.dark, ...a.frozen];

/**
 * The part worth using: black or frozen footage at either end is dropped,
 * and so is a silent lead-in or tail when someone talks in the clip. At
 * least a second (or the whole clip) is always left.
 */
export function usableRange(a: ClipAnalysis): Span {
  const trims = [...dead(a), ...(isTalky(a) ? a.silences : [])];
  let start = 0;
  let end = a.duration;
  for (let moved = true; moved;) {
    moved = false;
    for (const s of trims) {
      if (s.start <= start + 0.05 && s.end > start) {
        start = s.end;
        moved = true;
      }
      if (s.end >= end - 0.05 && s.start < end) {
        end = s.start;
        moved = true;
      }
    }
  }
  // Keep a breath of room before speech starts and after it stops.
  start = Math.max(0, start - 0.15);
  end = Math.min(a.duration, end + 0.25);
  if (end - start < Math.min(1, a.duration)) return { start: 0, end: a.duration };
  return { start, end };
}

/** How good a window is: live footage, whole sentences, a clean first frame. */
export function windowScore(a: ClipAnalysis, start: number, seconds: number): number {
  const end = start + seconds;
  const talky = isTalky(a);
  let score = 0;
  score -= (3 * overlap(dead(a), start, end)) / seconds;
  if (talky) score -= (1.5 * overlap(a.silences, start, end)) / seconds;
  const near = (t: number, list: number[], within: number) =>
    list.some((x) => Math.abs(x - t) <= within);
  if (near(start, a.cuts, 0.2)) score += 0.3;
  if (talky) {
    // Starts as someone starts talking, ends in a pause (or just after the
    // last pause before it, where bestWindow stops), never mid-word.
    const quietAt = (t: number) => a.silences.some((s) => s.start <= t && s.end >= t);
    if (
      near(
        start,
        a.silences.map((s) => s.end),
        0.35,
      )
    )
      score += 0.5;
    else if (start > 0.05 && !quietAt(start)) score -= 0.3;
    if (
      quietAt(end) ||
      end >= a.duration - 0.05 ||
      a.silences.some((s) => s.start < end && s.start >= end - 1.5 && s.start > start + 1)
    )
      score += 0.5;
  }
  const inside = a.cuts.filter((t) => t > start + 0.2 && t < end - 0.2).length;
  score += Math.min(0.6, inside * 0.15);
  // Earlier wins a tie: the opening of a clip is usually what was meant.
  score -= (0.05 * start) / Math.max(1, a.duration);
  return score;
}

/** The best `seconds` of a clip, starting on a scene change or a sentence where it can. */
export function bestWindow(a: ClipAnalysis, seconds: number): { start: number; seconds: number } {
  const range = usableRange(a);
  const room = range.end - range.start;
  if (room <= seconds + 0.01) return { start: round(range.start), seconds: round(room) };
  const latest = range.end - seconds;
  const candidates = new Set<number>([range.start, latest]);
  for (const t of [...a.cuts, ...a.silences.map((s) => s.end)])
    if (t >= range.start && t <= latest) candidates.add(t);
  for (let t = range.start; t <= latest; t += 0.5) candidates.add(t);
  let best = range.start;
  let bestScore = -Infinity;
  for (const start of [...candidates].sort((x, y) => x - y)) {
    const score = windowScore(a, start, seconds);
    if (score > bestScore + 1e-9) {
      best = start;
      bestScore = score;
    }
  }
  let length = seconds;
  // In a talking clip, stop at the pause just before the end rather than mid-word.
  if (isTalky(a)) {
    const end = best + seconds;
    const pause = a.silences
      .filter((s) => s.start < end && s.start >= end - 1.5 && s.start > best + 1)
      .at(-1);
    if (pause && !(pause.end >= end)) length = pause.start + 0.2 - best;
  }
  return { start: round(best), seconds: round(length) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Share `room` seconds fairly between clips: a short clip keeps all of
 * itself and its spare time goes to the others, each at most `cap`.
 */
export function shareTime(lengths: number[], room: number, cap: number): number[] {
  const want = lengths.map((l) => Math.max(0, Math.min(l, cap)));
  const share = want.map(() => 0);
  let open = want.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  let left = room;
  while (open.length && left > 0.01) {
    const each = left / open.length;
    const next: number[] = [];
    for (const i of open) {
      const give = Math.min(each, want[i] - share[i]);
      share[i] += give;
      left -= give;
      if (want[i] - share[i] > 0.01) next.push(i);
    }
    open = next;
  }
  return share.map(round);
}

/** Joins between pieces: one style per video, short enough never to eat a piece. */
export const TRANSITION_SECONDS = 0.35;
export const CLIP_TRANSITIONS = ["fade", "smoothleft", "smoothup"] as const;
export type Transition = (typeof CLIP_TRANSITIONS)[number];

export function pickTransition(seed: string, mode: "brand" | "recap"): Transition {
  if (mode === "recap") return "fade";
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLIP_TRANSITIONS[h % CLIP_TRANSITIONS.length];
}

/** How long a join can be between pieces this long (a third of the shortest at most). */
export function transitionFor(durations: number[], wanted = TRANSITION_SECONDS): number {
  if (durations.length < 2) return 0;
  const shortest = Math.min(...durations);
  const t = Math.min(wanted, shortest / 3);
  return t < 0.1 ? 0 : round(t);
}

/** Where each join starts on the joined timeline (FFmpeg xfade offsets). */
export function xfadeOffsets(durations: number[], t: number): number[] {
  const offsets: number[] = [];
  let elapsed = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    elapsed += durations[i];
    offsets.push(round(elapsed - (i + 1) * t));
  }
  return offsets;
}

/** Loudness the finished video is brought to (what Reels, TikTok and Shorts play at). */
export const TARGET_LUFS = -14;
export const LOUDNESS_FILTER = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11,aresample=48000`;
