// Generated copy should read like a person wrote it. Em dashes are the most
// recognisable tell of machine-written marketing copy, so they never ship:
// the prompt forbids them and this pass removes any that slip through.
// Pure: runs on the server before drafts are saved, and is unit-tested.
import type { StudioJobOutput } from "./jobs";

export function humanizeText(input: string): string {
  if (!input || !/[—–]/.test(input)) return input;
  let s = input;
  // Ranges: "2–4", "9—5" → "2-4".
  s = s.replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2");
  // Attribution or list lead-ins at the start of a line: "— Maria" → "Maria".
  s = s.replace(/^([ \t>*]*)[—–]\s*/gm, "$1");
  // Trailing dashes at the end of a line.
  s = s.replace(/[ \t]*[—–][ \t]*$/gm, "");
  // A dash right before punctuation: "Good coffee —." → "Good coffee.".
  s = s.replace(/[ \t]*[—–][ \t]*([.!?;:,])/g, "$1");
  // Clause breaks: "not charity — quality control" → "not charity, quality control".
  s = s.replace(/[ \t]+[—–][ \t]+/g, ", ");
  // Unspaced em dash between words: "charity—quality" → "charity, quality".
  s = s.replace(/(\S)—(\S)/g, "$1, $2");
  // Unspaced en dash in a compound: "well–known" → "well-known".
  s = s.replace(/(\S)–(\S)/g, "$1-$2");
  // Anything left over.
  s = s.replace(/[—–]/g, ",");
  // Tidy punctuation the replacements can leave behind.
  s = s
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return s;
}

/** Keys that hold data rather than copy. */
const SKIP = new Set(["media", "partial", "warnings", "platform"]);

function walk(value: unknown): unknown {
  if (typeof value === "string") return humanizeText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SKIP.has(k) ? v : walk(v);
    return out;
  }
  return value;
}

/** Every user-facing string in a job's output, with character counts kept honest. */
export function humanizeOutput(output: StudioJobOutput): StudioJobOutput {
  const next = walk(output) as StudioJobOutput;
  if (next.variants) next.variants = next.variants.map((v) => ({ ...v, chars: v.body.length }));
  return next;
}
