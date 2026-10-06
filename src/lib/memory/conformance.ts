// Did a draft break something the team asked Mellox to remember? Only what can
// be checked mechanically: a rule that names exact words to avoid, in quotes
// ('Never say "cheap"'). Everything else is left to the model and to people.
import type { Memory } from "./contracts";
import { isExpired } from "./normalize";

export type MemoryIssue = { memoryId: string; word: string; message: string };

const NEGATIVE = /\b(never|don['’]?t|do not|avoid|stop|no more|not use|without)\b/i;
// Double quotes only: an apostrophe ("don't", "brand's") is not a quote.
const QUOTED = /["“«]([^"“”«»]{2,40})["”»]/g;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Words a memory tells Mellox not to use. Quoted terms in a "never / avoid" rule. */
export function avoidedWords(memory: Memory): string[] {
  if (memory.kind !== "rule" && memory.kind !== "preference") return [];
  if (memory.topic === "visual" || !NEGATIVE.test(memory.body)) return [];
  return [...memory.body.matchAll(QUOTED)]
    .map((m) => m[1].trim())
    .filter((w) => w.length >= 2)
    .slice(0, 8);
}

export function checkMemoryConformance(
  text: string,
  memories: readonly Memory[],
  now: Date = new Date(),
): MemoryIssue[] {
  const body = text ?? "";
  if (!body.trim()) return [];
  const issues: MemoryIssue[] = [];
  for (const memory of memories) {
    if (isExpired(memory.expiresAt, now)) continue;
    for (const word of avoidedWords(memory)) {
      if (new RegExp(`(^|[^\\p{L}])${escapeRe(word)}($|[^\\p{L}])`, "iu").test(body)) {
        issues.push({
          memoryId: memory.id,
          word,
          message: `Uses "${word}", which your team asked Mellox to avoid`,
        });
      }
    }
  }
  return issues.slice(0, 6);
}

/** One-line instruction for a rewrite. "" when nothing is wrong. */
export function memoryFixInstruction(issues: readonly MemoryIssue[]): string {
  if (!issues.length) return "";
  return `Rewrite without: ${issues.map((i) => `"${i.word}"`).join(", ")}. Keep every fact, link and number.`;
}
