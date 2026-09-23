// humanize-text.ts — strips the em/en-dash "AI voice" tell from generated
// prose. Pure, no server import, so every AI-facing surface can share it: the
// gateways apply it to every generation call's output (src/lib/ai/run.server.ts,
// src/lib/anthropic-gateway.server.ts), and src/lib/studio/humanize.ts
// re-exports it for Studio's existing StudioJobOutput walker.
//
// Prevention is the primary defense (system prompts forbid the em dash); this
// is the safety net for whatever slips through anyway.
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

/** Keys that hold data rather than prose — media/status fields, not copy. */
const SKIP_KEYS = new Set([
  "media",
  "partial",
  "warnings",
  "platform",
  "url",
  "urls",
  "href",
  "link",
  "id",
]);

/**
 * Recursively cleans every string value in a parsed JSON-ish structure
 * (object/array/primitive) — the shape every structured AI completion
 * returns. Used by the gateways so no per-call-site change is needed for a
 * new field to be covered; used by studio/humanize.ts for StudioJobOutput.
 */
export function humanizeDeep<T>(value: T): T {
  if (typeof value === "string") return humanizeText(value) as T;
  if (Array.isArray(value)) return value.map((item) => humanizeDeep(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SKIP_KEYS.has(k) ? v : humanizeDeep(v);
    }
    return out as T;
  }
  return value;
}
