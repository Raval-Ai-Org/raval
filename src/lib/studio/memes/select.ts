// Which meme templates one concept may choose from, and checks on what it wrote.
//
// Code shortlists (fit, variety of mechanics, nothing used lately, fatigue,
// the brand's taste); the model picks one and writes the words; code checks
// the words fit the template's boxes. Pure and browser-safe.
import { FATIGUED_TEMPLATES, MECHANIC_RULES } from "./formats";
import { MEME_TEMPLATES } from "./templates.generated";
import { MEME_MODES, type MemeMechanic, type MemeMode, type MemeTemplate } from "./types";

export function memeTemplate(id: unknown): MemeTemplate | null {
  return typeof id === "string" ? (MEME_TEMPLATES.find((t) => t.id === id) ?? null) : null;
}

export function memeMode(value: unknown): MemeMode | null {
  return MEME_MODES.includes(value as MemeMode) ? (value as MemeMode) : null;
}

/** Stable 0..1 from a string (FNV-1a), so the same job gets the same shortlist. */
function unit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * About `count` templates with varied mechanics: none used in the brand's
 * latest memes, fatigued ones last, the mechanics the brand loved first.
 */
export function shortlistMemes(args: {
  seed: string;
  recent?: readonly string[];
  likedMechanics?: readonly string[];
  count?: number;
}): MemeTemplate[] {
  const count = args.count ?? 10;
  const recent = new Set(args.recent ?? []);
  const liked = new Set(args.likedMechanics ?? []);
  const ranked = MEME_TEMPLATES.filter((t) => !recent.has(t.id))
    .map((t) => ({
      t,
      score:
        t.fit * 1.5 +
        (liked.has(t.mechanic) ? 1.5 : 0) -
        (FATIGUED_TEMPLATES.has(t.id) ? 2.5 : 0) +
        unit(`${args.seed}:${t.id}`) * 3,
    }))
    .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
  const out: MemeTemplate[] = [];
  const perMechanic = new Map<string, number>();
  for (const { t } of ranked) {
    const used = perMechanic.get(t.mechanic) ?? 0;
    if (used >= 2) continue;
    perMechanic.set(t.mechanic, used + 1);
    out.push(t);
    if (out.length >= count) break;
  }
  return out;
}

/** One menu line per template, short enough for ten in a prompt. */
export function memeMenuLine(t: MemeTemplate): string {
  const rule = MECHANIC_RULES[t.mechanic as MemeMechanic] ?? MECHANIC_RULES.other;
  return `- ${t.id} "${t.name}" (${t.boxes.length} ${t.boxes.length === 1 ? "box" : "boxes"}, ${t.mechanic}): ${t.use} Avoid when ${t.avoid.replace(/^\w/, (c) => c.toLowerCase())} ${rule}`;
}

export const MEME_LINE_MAX_WORDS = 12;
export const MEME_LINE_MAX_CHARS = 70;
export const MEME_TOTAL_MAX_WORDS = 28;

/** What is wrong with a meme's words for its template (empty when fine). */
export function memeLineIssues(template: MemeTemplate, lines: readonly string[]): string[] {
  const issues: string[] = [];
  const clean = lines.map((l) => l.trim());
  if (clean.length !== template.boxes.length)
    issues.push(
      `"${template.id}" has ${template.boxes.length} text boxes; write exactly ${template.boxes.length} lines, in box order.`,
    );
  if (clean.some((l) => !l)) issues.push("Every box needs words; leave none empty.");
  const words = (l: string) => l.split(/\s+/).filter(Boolean).length;
  clean.forEach((l, i) => {
    if (words(l) > MEME_LINE_MAX_WORDS || l.length > MEME_LINE_MAX_CHARS)
      issues.push(
        `Line ${i + 1} is too long for a meme box; cut it to ${MEME_LINE_MAX_WORDS} words.`,
      );
  });
  if (clean.reduce((n, l) => n + words(l), 0) > MEME_TOTAL_MAX_WORDS)
    issues.push(
      `Too many words in total; a meme reads in two seconds (${MEME_TOTAL_MAX_WORDS} words at most).`,
    );
  if (clean.some((l) => /#\w/.test(l))) issues.push("No hashtags in the picture.");
  return issues;
}

/** Where each box's text goes on a picture of this size, in pixels. */
export function memeBoxRects(
  template: MemeTemplate,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number; align: string; color: string; upper: boolean }[] {
  return template.boxes.map((box) => {
    // memegen lets a box run past the edge; the words must stay on the picture.
    const x = Math.min(Math.max(box[0], 0), 0.98);
    const y = Math.min(Math.max(box[1], 0), 0.98);
    const w = Math.min(box[2], 1 - x);
    const h = Math.min(box[3], 1 - y);
    const extra = box.length > 4 ? (box[4] ?? {}) : {};
    return {
      x: Math.round(x * width),
      y: Math.round(y * height),
      w: Math.max(1, Math.round(w * width)),
      h: Math.max(1, Math.round(h * height)),
      align: extra.align ?? "center",
      color: extra.color ?? "white",
      upper: (extra.style ?? "upper") !== "none",
    };
  });
}

/**
 * The largest font size (px) at which the words fit the box, by greedy word
 * wrap with an average glyph width (Anton is narrow: ~0.48em upper case).
 */
export function fitMemeText(
  text: string,
  box: { w: number; h: number },
  opts: { charEm?: number; lineHeight?: number; min?: number; max?: number } = {},
): { size: number; lines: string[] } {
  const charEm = opts.charEm ?? 0.48;
  const lineHeight = opts.lineHeight ?? 1.1;
  const min = opts.min ?? 12;
  const max = Math.max(min, Math.min(opts.max ?? 120, Math.floor(box.h / lineHeight)));
  const words = text.split(/\s+/).filter(Boolean);
  const wrap = (size: number): string[] => {
    const perLine = Math.max(1, Math.floor(box.w / (size * charEm)));
    const out: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= perLine || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    return out;
  };
  for (let size = max; size > min; size--) {
    const lines = wrap(size);
    const widest = Math.max(...lines.map((l) => l.length)) * size * charEm;
    if (lines.length * size * lineHeight <= box.h && widest <= box.w) return { size, lines };
  }
  return { size: min, lines: wrap(min) };
}
