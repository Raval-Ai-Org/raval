// A typed script becomes a creator-video script without a model call. Pure.
//
// The person writes what the creator says (Holo-style: one text box); code
// splits it into a few timed beats by word count. Shots and product moments
// are plain defaults the prompt builder already knows how to direct.

import type { UgcFormat } from "./formats/types";
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
export function scriptToText(
  script: Pick<Script, "scenes"> | null | undefined,
  format?: UgcFormat | null,
): string {
  if (!script) return "";
  // A two-person script names who speaks ("Host: ..."), so editing keeps the roles.
  const named = format?.roles.length === 2 && script.scenes.some((s) => s.speaker === "B");
  const nameOf = (key: string | undefined) => {
    const title = format?.roles.find((r) => r.key === (key === "B" ? "B" : "A"))?.title ?? "";
    const word = title.replace(/^THE\s+/i, "").toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  };
  return script.scenes
    .filter((s) => s.dialogue.trim())
    .map((s) => (named ? `${nameOf(s.speaker)}: ${s.dialogue.trim()}` : s.dialogue.trim()))
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

const SPEAKER_LINE = /^\s*([A-Za-z][\w' ]{0,20}):\s+(.+)$/;

/**
 * A typed script for a library format: one beat per line or sentence, shaped
 * on the format's own beats (shots, cuts, who speaks). Lines written as
 * "Name: words" set who speaks: the first name is role A, the second role B.
 */
function formatScriptFromText(
  text: string,
  durationSec: number,
  format: UgcFormat,
  opts: { cta?: string; onScreen?: string },
): Script | null {
  const rawLines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const named = rawLines.filter((l) => SPEAKER_LINE.test(l)).length >= 2;
  const names: string[] = [];
  const lines = (
    named
      ? rawLines
      : text
          .split(SENTENCE)
          .map((s) => s.trim())
          .filter(Boolean)
  ).map((line) => {
    const m = named ? SPEAKER_LINE.exec(line) : null;
    if (!m) return { words: line, speaker: undefined as "A" | "B" | undefined };
    const name = m[1].trim().toLowerCase();
    if (!names.includes(name) && names.length < 2) names.push(name);
    return {
      words: m[2].trim(),
      speaker: names.indexOf(name) === 1 ? ("B" as const) : ("A" as const),
    };
  });
  if (!lines.length) return null;
  const maxBeats = Math.max(1, Math.min(8, Math.round(durationSec / 1.5)));
  // Too many lines for the length: join neighbours so each beat still gets time.
  const groups: (typeof lines)[] = [];
  const per = Math.ceil(lines.length / maxBeats);
  for (let i = 0; i < lines.length; i += per) groups.push(lines.slice(i, i + per));

  const counts = groups.map((g) => Math.max(1, words(g.map((l) => l.words).join(" "))));
  const sum = counts.reduce((a, b) => a + b, 0);
  let start = 0;
  const scenes = groups.map((g, i) => {
    const last = i === groups.length - 1;
    const beat =
      format.beats[
        i === 0
          ? 0
          : last
            ? format.beats.length - 1
            : Math.min(
                format.beats.length - 2,
                Math.max(1, Math.round((i / (groups.length - 1)) * (format.beats.length - 1))),
              )
      ] ?? format.beats[0];
    const end = last
      ? durationSec
      : Math.round(Math.min(durationSec, start + (counts[i] / sum) * durationSec) * 10) / 10;
    const speaker =
      format.speech === "none"
        ? ("none" as const)
        : (g[0].speaker ?? (beat.speaker === "none" ? "A" : beat.speaker));
    const scene = {
      id: `s${i + 1}`,
      start,
      end: Math.max(end, start + 0.5),
      shot: beat.shot,
      action: beat.action,
      productPlacement: "",
      dialogue: format.speech === "none" ? "" : clip(g.map((l) => l.words).join(" "), 400),
      caption: "",
      speaker,
      cut:
        i === 0
          ? beat.cut === "split"
            ? ("split" as const)
            : ("open" as const)
          : beat.cut === "open"
            ? ("hard" as const)
            : beat.cut,
      role: beat.role,
    };
    start = scene.end;
    return scene;
  });
  const first = lines[0].words;
  const parsed = ScriptSchema.safeParse({
    hook: clip(first, 200),
    scenes,
    cta: clip(opts.cta?.trim() || "", 160),
    postCaption: "",
    hashtags: [],
    factIds: [],
    format: format.id,
    onScreen: clip(opts.onScreen ?? "", 80),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Split a typed script into timed beats. Returns null when there is nothing to
 * say. Beats: about one per four seconds, at most four, never more than the
 * sentences available. With a library format, the beats follow the format.
 */
export function scriptFromText(
  text: string,
  durationSec: number,
  opts: { cta?: string; format?: UgcFormat | null; onScreen?: string } = {},
): Script | null {
  if (opts.format) return formatScriptFromText(text, durationSec, opts.format, opts);
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
