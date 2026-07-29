// Compact long chat histories before sending to the model.
//
// Strategy:
// - Always keep the last KEEP_TAIL turns verbatim (needs full fidelity for
//   the current thread of thought).
// - Everything older is collapsed into a single "system" summary message
//   that lists topics/decisions in ~1 line each. This preserves continuity
//   at a fraction of the token cost.
//
// The heuristic summary is deterministic (no LLM call) so it costs zero
// tokens on our side. Callers can optionally pass a pre-computed summary
// (e.g. a running summary cached client-side) to use instead.

export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

const KEEP_TAIL = 12;               // last N turns kept verbatim
const MAX_OLDER_CHARS = 900;        // hard cap on the summary block
const PER_TURN_CHARS = 110;         // per-turn snippet inside summary

export function compactHistory(
  messages: ChatTurn[],
  opts: { keepTail?: number; precomputedSummary?: string } = {},
): ChatTurn[] {
  const keep = opts.keepTail ?? KEEP_TAIL;
  if (messages.length <= keep) return messages;

  const older = messages.slice(0, messages.length - keep);
  const tail = messages.slice(-keep);

  const summary = opts.precomputedSummary?.trim()
    ? opts.precomputedSummary.trim()
    : heuristicSummary(older);

  if (!summary) return tail;

  return [
    {
      role: "system",
      content: `## Earlier in this conversation (compact)\n${summary}`,
    },
    ...tail,
  ];
}

function heuristicSummary(older: ChatTurn[]): string {
  // Pair user->assistant turns and emit one line per exchange.
  const lines: string[] = [];
  for (let i = 0; i < older.length; i++) {
    const m = older[i];
    if (m.role !== "user") continue;
    const next = older[i + 1];
    const q = firstSentence(m.content, PER_TURN_CHARS);
    const a = next && next.role === "assistant"
      ? firstSentence(next.content, PER_TURN_CHARS)
      : "";
    lines.push(a ? `- Q: ${q} → A: ${a}` : `- Q: ${q}`);
  }
  // Cap total size, prefer most recent older exchanges.
  const joined = lines.slice(-24).join("\n");
  return joined.length > MAX_OLDER_CHARS
    ? joined.slice(joined.length - MAX_OLDER_CHARS)
    : joined;
}

function firstSentence(text: string, n: number): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  // Prefer sentence boundary
  const m = clean.match(/^(.{20,}?[.!?])\s/);
  const s = m ? m[1] : clean;
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}
