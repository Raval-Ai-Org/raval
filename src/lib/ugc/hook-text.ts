// The hook text on a finished Creator video: Instagram-style words drawn by
// code after the video is made (video models misspell text). Pure and
// browser-safe. The server draws each cue (`renderCue` in
// src/server/studio/video/finish.server.tsx) and lays it over the footage.
//
// Preset ids are stored on briefs and renders: add presets, never rename one.

export const HOOK_TEXT_PRESET_IDS = [
  "classic",
  "bubble",
  "highlight",
  "pov",
  "reply",
  "headline",
  "split-label",
  "word-pop",
  "stacked",
] as const;
export type HookTextPresetId = (typeof HOOK_TEXT_PRESET_IDS)[number];

export type HookTextPreset = {
  id: HookTextPresetId;
  label: string;
  hint: string;
  /** Lower-case the words (the "pov:" look). */
  lowercase?: boolean;
  /** Where the words sit: the upper third, or a news bar low in the frame. */
  position: "top" | "lower";
  /** Words appear one at a time instead of all at once. */
  wordByWord?: boolean;
  /** Two labels, one per half of a split screen. */
  split?: boolean;
};

export const HOOK_TEXT_PRESETS: readonly HookTextPreset[] = [
  {
    id: "classic",
    label: "Classic",
    hint: "White bold words, black outline",
    position: "top",
  },
  { id: "bubble", label: "Bubble", hint: "Black words on white boxes", position: "top" },
  { id: "highlight", label: "Marker", hint: "Black on a yellow highlight", position: "top" },
  { id: "pov", label: "POV", hint: "Small lower-case words", lowercase: true, position: "top" },
  { id: "reply", label: "Reply", hint: "A comment the video answers", position: "top" },
  { id: "headline", label: "Breaking", hint: "A news bar", position: "lower" },
  {
    id: "split-label",
    label: "Two labels",
    hint: "One label per side",
    position: "top",
    split: true,
  },
  {
    id: "word-pop",
    label: "Word by word",
    hint: "Words pop in one by one",
    position: "top",
    wordByWord: true,
  },
  { id: "stacked", label: "Stacked", hint: "Big words, one in your colour", position: "top" },
];

export function hookTextPreset(id: string | null | undefined): HookTextPreset {
  return HOOK_TEXT_PRESETS.find((p) => p.id === id) ?? HOOK_TEXT_PRESETS[0];
}

/** One timed piece of hook text, drawn by code. */
export type HookCue = {
  text: string;
  start: number;
  end: number;
  preset: HookTextPresetId;
  /** A split-screen label's half. */
  side?: "left" | "right";
  /** A "Replying to" sticker's line above the words. */
  label?: string;
};

/** The longest hook text, in words. */
export const HOOK_TEXT_MAX_WORDS = 8;
/** The hook text stays this long; long enough to read, gone before the turn. */
export const HOOK_TEXT_SECONDS = 2.8;

const round = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The cues for a video's hook text. A split preset needs two labels written as
 * "left / right"; with one part it shows as a plain line. Word by word lands
 * one word every 0.25 s. A "reply" preset carries the line it replies to.
 */
export function hookCues(
  text: string,
  presetId: string,
  duration: number,
  opts: { replyTo?: string } = {},
): HookCue[] {
  const words = clean(text);
  if (!words || duration < 2) return [];
  const preset = hookTextPreset(presetId);
  const end = round(Math.min(HOOK_TEXT_SECONDS, duration - 0.3));
  const shown = preset.lowercase ? words.toLowerCase() : words;
  if (preset.split) {
    const [left, right] = shown.split(/\s+\/\s+/).map(clean);
    if (left && right)
      return [
        { text: left, start: 0, end, preset: preset.id, side: "left" },
        { text: right, start: 0, end, preset: preset.id, side: "right" },
      ];
    return [{ text: shown, start: 0, end, preset: "classic" }];
  }
  if (preset.wordByWord) {
    const parts = shown.split(" ");
    // A word every quarter second, faster for a long line so the whole line still reads.
    const step = Math.min(0.25, (end - 0.6) / parts.length);
    return parts.map((_, i) => ({
      text: parts.slice(0, i + 1).join(" "),
      start: round(i * step),
      end: i === parts.length - 1 ? end : round((i + 1) * step),
      preset: preset.id,
    }));
  }
  const label = preset.id === "reply" ? clean(opts.replyTo ?? "") : "";
  return [{ text: shown, start: 0, end, preset: preset.id, ...(label ? { label } : {}) }];
}
