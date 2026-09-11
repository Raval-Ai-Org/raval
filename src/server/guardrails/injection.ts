// injection.ts — heuristic prompt-injection detector for untrusted text.
// Deliberately conservative: it flags and removes lines that try to address
// the model ("ignore previous instructions", "you are now…", fake system
// prompts, embedded action tags). It is one layer; the structural defences
// (fencing, the action approval gate, typed tools) do not rely on it.
import "server-only";

const PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "override_instructions",
    re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|system)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?|directions?)\b/i,
  },
  { id: "role_reassignment", re: /\byou are (now|no longer)\b|\bact as (a |an )?(system|developer|admin)\b/i },
  { id: "system_prompt_probe", re: /\b(reveal|print|show|repeat)\b[^.\n]{0,30}\b(system prompt|hidden instructions|your instructions)\b/i },
  { id: "fake_system_turn", re: /^\s*(system|developer)\s*:/im },
  { id: "chat_template", re: /<\|?\s*(im_start|im_end)\s*\|?>/i },
  { id: "action_tag", re: /\[\s*\[\s*action\s*:/i },
  { id: "new_instructions", re: /\b(new|updated|real)\s+instructions?\s*:/i },
];

/** A single line that should be dropped from untrusted content. */
export const INJECTION_LINE_RE = new RegExp(
  [
    PATTERNS[0].re.source,
    PATTERNS[1].re.source,
    PATTERNS[2].re.source,
    PATTERNS[5].re.source,
    PATTERNS[6].re.source,
  ].join("|"),
  "i",
);

/** Pattern ids found in `text` (empty when clean). */
export function detectInjection(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}
