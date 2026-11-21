// board.ts — the storyboard a person sees before any video credit is spent
// (pure, browser-safe).
//
// A long or premium AI video is planned first and shown as a real storyboard:
// every scene with its time, camera, action, the exact words spoken and shown,
// the sound, and a drawn frame. The video is made only when the person presses
// Create, from exactly this plan (a media-only revision keeps the parent's
// storyboard, runner.server.ts). Short clips (8 s, a picture brought to life)
// skip it: there is nothing to misunderstand and the clip costs little.
//
// The same scene shape is used for Creator (UGC) videos, built from their
// script (`boardFromCreatorScript`), so both screens draw one storyboard.
import type { CreateJobInput } from "../jobs";
import type { VideoStoryboard } from "./storyboard";

/** Frames beyond the first are drawn in these media slots, never linked to the post. */
export const BOARD_SLOT = "board:";
export const boardSlot = (index: number) => `${BOARD_SLOT}${index}`;
export const isBoardSlot = (slot: string) => slot.startsWith(BOARD_SLOT);

/**
 * Key frames drawn for one storyboard: the opening, the middle and the end.
 * Every other scene shows the key frame it follows from, so the whole video
 * is covered for the price of three cheap stills.
 */
export const MAX_BOARD_FRAMES = 3;
/** A video this long or longer is always storyboarded first. */
export const STORYBOARD_MIN_SECONDS = 16;
/** Models whose videos cost the most: always storyboarded first. */
export const STORYBOARD_MODELS = new Set(["premium", "cinematic", "long"]);
/** A Creator video gets a storyboard only when it is this long… */
export const CREATOR_STORYBOARD_MIN_SECONDS = 15;
/** …and has this many scenes: a short talking-head script needs no storyboard. */
export const CREATOR_STORYBOARD_MIN_SCENES = 4;

/** Does this Creator script get a storyboard before it is rendered? */
export function creatorNeedsStoryboard(script: { scenes: unknown[] } | null, seconds: number) {
  return (
    !!script &&
    seconds >= CREATOR_STORYBOARD_MIN_SECONDS &&
    script.scenes.length >= CREATOR_STORYBOARD_MIN_SCENES
  );
}

/**
 * Must this video be planned and shown before it is made? Only AI videos
 * (code-made ones cost little and show their own preview), and only long or
 * premium ones.
 */
export function needsStoryboard(input: Pick<CreateJobInput, "type" | "controls">): boolean {
  const c = input.controls;
  const video = input.type === "video" || (input.type === "story" && c.storyMode === "video");
  if (!video) return false;
  if (c.videoMode && c.videoMode !== "generate") return false;
  if (c.videoKind === "motion-post" || c.videoKind === "motion-graphics") return false;
  const seconds = c.durationSec ?? 8;
  return seconds >= STORYBOARD_MIN_SECONDS || STORYBOARD_MODELS.has(c.videoModelKey ?? "");
}

export type BoardScene = {
  id: string;
  /** 1-based, as shown on the card. */
  number: number;
  /** Which clip the scene is in (a story video chains its clips). */
  clip: number;
  start: number;
  end: number;
  camera: string;
  action: string;
  /** What is said in this scene (voiceover or dialogue), exactly as it will be. */
  words: string;
  /** Words drawn on screen by code (never by the video model). */
  onScreen: string;
  sound: string;
  /** The media slot its frame is drawn in, when it has one. */
  frameSlot?: string;
};

export type Board = {
  logline: string;
  seconds: number;
  scenes: BoardScene[];
  /** The look every scene keeps (cast, setting, light, palette, camera). */
  bible: { label: string; value: string }[];
  endCard?: { headline: string; detail: string };
};

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Which scenes get a key frame: the first and the last, then evenly between,
 * each moved to the opening shot of its clip when one is near (a clip is one
 * render, so its opening is what the video will really look like).
 */
export function framePicks(scenes: Pick<BoardScene, "clip">[], max = MAX_BOARD_FRAMES): number[] {
  const n = scenes.length;
  if (!n || max <= 0) return [];
  if (n <= max) return scenes.map((_, i) => i);
  const opens = scenes
    .map((scene, i) => (i === 0 || scenes[i - 1].clip !== scene.clip ? i : -1))
    .filter((i) => i >= 0);
  const picked = new Set<number>();
  for (let k = 0; k < max; k++) {
    const target = max === 1 ? 0 : Math.round((k * (n - 1)) / (max - 1));
    // The last key frame stays on the last scene: it shows how the video ends.
    const open = k === max - 1 ? undefined : opens.find((i) => Math.abs(i - target) <= 1);
    const pick = open !== undefined && !picked.has(open) ? open : target;
    picked.add(picked.has(pick) ? target : pick);
  }
  return [...picked].sort((a, b) => a - b);
}

/** The key frame a scene shows: its own, else the latest one before it (else the first). */
export function keyFrameFor(board: Board, index: number): { slot?: string; own: boolean } {
  const own = board.scenes[index]?.frameSlot;
  if (own) return { slot: own, own: true };
  for (let i = index - 1; i >= 0; i--)
    if (board.scenes[i].frameSlot) return { slot: board.scenes[i].frameSlot, own: false };
  return { slot: board.scenes.find((s) => s.frameSlot)?.frameSlot, own: false };
}

/** The storyboard of a planned Studio video, scene by scene, with its frame slots. */
export function boardFromStoryboard(sb: VideoStoryboard, clipSeconds: number[]): Board {
  const scenes: BoardScene[] = [];
  let offset = 0;
  sb.clips.forEach((clip, c) => {
    const length = clipSeconds[c] ?? Math.max(...clip.shots.map((s) => s.end), 0);
    clip.shots.forEach((shot, s) => {
      scenes.push({
        id: `c${c}s${s}`,
        number: scenes.length + 1,
        clip: c,
        start: round(offset + shot.start),
        end: round(offset + shot.end),
        camera: clean(shot.camera),
        action: clean(shot.action),
        // A clip's voiceover and words run over the clip: shown on its first scene.
        words: s === 0 ? clean(clip.voiceover) : "",
        onScreen: s === 0 ? clean(clip.onScreen) : "",
        sound: s === 0 ? clean(clip.sound) : "",
      });
    });
    offset += length;
  });
  framePicks(scenes).forEach((index, k) => {
    scenes[index].frameSlot = k === 0 ? "main" : boardSlot(k);
  });
  const b = sb.bible;
  const bible = [
    ...b.cast.map((member) => ({ label: member.id || "Cast", value: clean(member.look) })),
    { label: "Product", value: clean(b.product) },
    { label: "Setting", value: clean(b.setting) },
    { label: "Light", value: clean(b.lighting) },
    { label: "Colours", value: clean(b.palette) },
    { label: "Camera", value: clean(b.camera) },
  ].filter((entry) => entry.value);
  return {
    logline: clean(sb.logline),
    seconds: round(offset),
    scenes,
    bible,
    endCard: sb.endCard?.headline ? sb.endCard : undefined,
  };
}

/** The scene a frame slot draws, for the frame's prompt. */
export function sceneForSlot(board: Board, slot: string): BoardScene | undefined {
  return board.scenes.find((scene) => scene.frameSlot === slot);
}

/**
 * The prompt for one storyboard frame: a still from that exact moment, in the
 * video's look, so the frames read as one film. No words: on-screen words are
 * drawn by code in the video and shown under the frame here.
 */
export function boardFramePrompt(
  sb: VideoStoryboard,
  scene: BoardScene,
  extra: { brandRules?: string; style?: string } = {},
): string {
  const cast = sb.bible.cast.map((member) => `${member.id}: ${member.look}`).join("; ");
  return [
    `A single still frame from a video storyboard, scene ${scene.number}: ${scene.action}`,
    scene.camera ? `Camera: ${scene.camera}.` : "",
    sb.bible.setting ? `Setting: ${sb.bible.setting}.` : "",
    sb.bible.lighting ? `Light: ${sb.bible.lighting}.` : "",
    sb.bible.palette ? `Colours: ${sb.bible.palette}.` : "",
    cast ? `On screen: ${cast}.` : "",
    sb.bible.product ? `Product: ${sb.bible.product}. Keep it exactly as in the reference.` : "",
    extra.brandRules ?? "",
    extra.style ?? "",
    "Realistic, cinematic, the same people, place and light as the other frames of this video. No words, captions, logos, subtitles or interface.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Seconds as the card shows them: 0:00. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A Creator (UGC) script, as the same storyboard. */
export function boardFromCreatorScript(script: {
  hook?: string;
  cta?: string;
  onScreen?: string;
  scenes: {
    id: string;
    start: number;
    end: number;
    shot: string;
    action: string;
    dialogue: string;
    caption: string;
  }[];
}): Board {
  const scenes: BoardScene[] = script.scenes.map((scene, i) => ({
    id: scene.id || `scene-${i + 1}`,
    number: i + 1,
    clip: i,
    start: round(scene.start),
    end: round(scene.end),
    camera: clean(scene.shot),
    action: clean(scene.action),
    words: clean(scene.dialogue),
    onScreen: i === 0 ? clean(script.onScreen || scene.caption) : clean(scene.caption),
    sound: "",
  }));
  framePicks(scenes).forEach((index, k) => {
    scenes[index].frameSlot = boardSlot(k);
  });
  return {
    logline: clean(script.hook),
    seconds: round(Math.max(0, ...script.scenes.map((s) => s.end))),
    scenes,
    bible: script.cta ? [{ label: "Ends on", value: clean(script.cta) }] : [],
  };
}

/** A stable key for a Creator script's storyboard: an edited script needs new frames. */
export function creatorBoardKey(board: Board): string {
  const text = board.scenes.map((s) => `${s.start}|${s.end}|${s.action}|${s.words}`).join("\n");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

/**
 * The controls a new piece is made with: a video that needs a storyboard is
 * asked for as one (the server decides the same way). An edit keeps what it has.
 */
export function withStoryboard<C extends CreateJobInput["controls"]>(
  type: CreateJobInput["type"],
  controls: C,
): C {
  if (controls.videoPreview || !needsStoryboard({ type, controls })) return controls;
  return { ...controls, videoPreview: true, videoQuote: undefined };
}
