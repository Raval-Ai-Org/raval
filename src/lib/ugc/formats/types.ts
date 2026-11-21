// Types for Creator video formats (src/lib/ugc/formats/). Pure.
import type { HookTextPresetId } from "../hook-text";
import type { UgcModelKey } from "../models";

export type UgcFormatGroup = "interview" | "skit" | "talk" | "review" | "lifestyle";

/** How the video is cut together. */
export type FormatEdit = "hard-cuts" | "jump-cuts" | "continuous" | "split-open" | "montage";

/**
 * How clips are joined when the video is longer than one generation:
 * `chain` opens each clip on the last frame of the one before (one unbroken
 * take); `scene-cut` splits at a beat boundary, where a hard cut hides the join.
 */
export type FormatJoin = "chain" | "scene-cut";

export type BeatRole = "hook" | "setup" | "turn" | "payoff" | "button";
/** Who speaks in a beat: role A, role B, or nobody. */
export type Speaker = "A" | "B" | "none";
/** How a beat starts: the opening shot, a hard cut, a split screen, or the same take. */
export type BeatCut = "open" | "hard" | "split" | "continuous";

export type FormatBeat = {
  role: BeatRole;
  /** Share of the video's length (the shares of a format add up to 1). */
  share: number;
  speaker: Speaker;
  cut: BeatCut;
  /** Camera framing for this beat. */
  shot: string;
  /** What happens: the move, the look, the reaction. */
  action: string;
};

export type FormatRole = {
  key: "A" | "B";
  /** How the prompt names them, e.g. "THE HOST". */
  title: string;
  /** Where they are in the frame. */
  position: string;
  /** How they behave on camera. */
  behaviour: string;
};

export type FormatPlace = {
  id: string;
  label: string;
  /** Concrete set details the camera sees. */
  set: string;
  /** The light in that place. */
  light: string;
};

/** A change of the idea that keeps the format: rotated so no two videos match. */
export type FormatTwist = { id: string; idea: string };

export type UgcFormat = {
  id: string;
  label: string;
  group: UgcFormatGroup;
  /** One short line on the card. */
  hint: string;
  /** The show line in the prompt: "a viral street interview filmed inside a moving subway car". */
  show: string;
  /** People on camera (0 = hands only). */
  roles: readonly FormatRole[];
  speech: "dialogue" | "voiceover" | "none";
  /** Who holds the phone and how it moves. */
  camera: string;
  /** Grade and texture. */
  look: string;
  /** The sound bed, without the voices. */
  sound: string;
  edit: FormatEdit;
  join: FormatJoin;
  beats: readonly FormatBeat[];
  places: readonly FormatPlace[];
  twists: readonly FormatTwist[];
  /** Opening patterns the writer may use (rotated). */
  hookPatterns: readonly string[];
  /** How the product shows up without turning the video into an ad. */
  productRole: string;
  hookText: { preset: HookTextPresetId; example: string };
  /** The post caption's pattern. */
  caption: string;
  /** Topic words this format suits; used only to suggest. */
  tags: readonly string[];
  defaultModel: UgcModelKey;
  /** The longest video made in one generation before it is split. */
  maxSingleClipSec: number;
};
