// A typed script becomes a creator-video script without a model call. Pure.
//
// The person writes what the creator says (Holo-style: one text box); code
// splits it into a few timed beats by word count. Shots and product moments
// are plain defaults the prompt builder already knows how to direct.

import { ScriptSchema, type Script } from "./schemas";

const SENTENCE = /(?<=[.!?…])\s+|\n+/;

const clip = (s: string, max: number) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Spoken words, for the counter beside the script box. */
export function typedWordCount(text: string): number {
  return words(text.trim());
}

/** The words of a stored script, one beat per line, for the script box. */
export function scriptToText(script: Pick<Script, "scenes"> | null | undefined): string {
  if (!script) return "";
  return script.scenes
    .map((s) => s.dialogue.trim())
    .filter(Boolean)
    .join("\n");
}

const SHOTS = {
  first: {
    shot: "Close selfie framing at arm's length, talking straight to the lens",
    action: "Starts talking right away, natural and direct",
    productPlacement: "Product in hand, visible in frame",
  },
  middle: {
    shot: "Medium shot, the product clearly in view",
    action: "Shows the product while talking about it",
    productPlacement: "Product held up or in use, label facing the camera",
  },
  last: {
    shot: "Close framing, product beside the face",
    action: "Holds the product up and smiles",
    productPlacement: "Product held up next to the face, label facing the camera",
  },
} as const;

/**
 * Split a typed script into timed beats. Returns null when there is nothing to
 * say. Beats: about one per four seconds, at most four, never more than the
 * sentences available.
 */
export function scriptFromText(
  text: string,
  durationSec: number,
  opts: { cta?: string } = {},
): Script | null {
  const sentences = text
    .split(SENTENCE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return null;

  const beats = Math.max(1, Math.min(4, Math.round(durationSec / 4), sentences.length));
  const total = sentences.reduce((n, s) => n + words(s), 0) || 1;
  const groups: string[][] = Array.from({ length: beats }, () => []);
  let seen = 0;
  for (const s of sentences) {
    // Place each sentence by where its middle falls in the script.
    const mid = (seen + words(s) / 2) / total;
    groups[Math.min(beats - 1, Math.floor(mid * beats))].push(s);
    seen += words(s);
  }
  const filled = groups.filter((g) => g.length);

  const counts = filled.map((g) => Math.max(1, words(g.join(" "))));
  const sum = counts.reduce((a, b) => a + b, 0);
  let start = 0;
  const scenes = filled.map((g, i) => {
    const last = i === filled.length - 1;
    const end = last
      ? durationSec
      : Math.round(Math.min(durationSec, start + (counts[i] / sum) * durationSec) * 10) / 10;
    const kind = i === 0 ? SHOTS.first : last ? SHOTS.last : SHOTS.middle;
    const scene = {
      id: `s${i + 1}`,
      start,
      end: Math.max(end, start + 0.5),
      ...kind,
      dialogue: clip(g.join(" "), 400),
      caption: "",
    };
    start = scene.end;
    return scene;
  });

  const parsed = ScriptSchema.safeParse({
    hook: clip(sentences[0], 200),
    scenes,
    cta: clip(opts.cta?.trim() || sentences[sentences.length - 1], 160),
    postCaption: clip(text, 2000),
    hashtags: [],
    factIds: [],
  });
  return parsed.success ? parsed.data : null;
}
