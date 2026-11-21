// Meme template types (browser-safe).

/** How the joke works; formats with one mechanic are interchangeable. */
export type MemeMechanic =
  | "comparison"
  | "preference"
  | "escalation"
  | "dilemma"
  | "irony"
  | "reaction"
  | "self-own"
  | "label-scene"
  | "plan-fail"
  | "expectation-reality"
  | "denial"
  | "announcement"
  | "question"
  | "other";

export type MemeBoxExtra = { align?: string; color?: string; style?: string };

/** [x, y, w, h] as fractions of the picture, plus optional extras. */
export type MemeBox =
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, MemeBoxExtra];

export type MemeTemplate = {
  id: string;
  name: string;
  mechanic: MemeMechanic | string;
  use: string;
  avoid: string;
  /** Marketing fit 2-3 (curated). */
  fit: number;
  /** A real, recognisable person is in the picture. */
  person?: boolean;
  w: number;
  h: number;
  boxes: readonly MemeBox[];
};

/**
 * How a meme is made:
 * - classic: the real template picture, words drawn by code (no image cost);
 * - remix: the template's composition redrawn in the brand's world by the
 *   image model, words drawn by code;
 * - original: an original scene on one of Mellox's own layouts (categories.ts).
 */
export type MemeMode = "classic" | "remix" | "original";
export const MEME_MODES: readonly MemeMode[] = ["classic", "remix", "original"];
