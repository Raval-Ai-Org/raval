// Intelligent chat-context selector.
//
// Instead of dumping the entire Brand DNA + all insights + all competitors +
// customer signals + workspace stats + coach + competitor alerts on every
// chat turn, we score each candidate section against the current user
// message and only include what's relevant, within a strict char budget.
//
// Always-in-core (tiny header, ~250 chars): brand identity so the model
// never loses who it's talking about. Everything else is opt-in based on
// keyword overlap or user's explicit topic cues.

export type CtxSection = {
  id: string;
  label: string;                 // section heading in output
  body: string;                  // section content (already stringified)
  keywords: string[];            // triggers that activate this section
  baseScore?: number;            // >0 always considered (still competes on budget)
  maxChars?: number;             // per-section cap
};

export type CtxSources = {
  // Always-in-core fields (kept tiny)
  brandName?: string;
  oneLiner?: string;
  voice?: string;
  audience?: string;
  website?: string;
  // Optional structured buckets — each becomes a candidate section
  sections: CtxSection[];
};

const STOP = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are",
  "be","this","that","it","as","at","by","i","we","you","my","our","your",
  "please","can","could","would","should","do","does","did","have","has","had",
  "make","help","need","want","give","show","tell","use","about","from","into",
  "some","any","also","just","not","no","yes","ok",
]);

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of (s || "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (!t || t.length < 3 || STOP.has(t)) continue;
    out.add(t);
  }
  return out;
}

function scoreSection(section: CtxSection, queryToks: Set<string>): number {
  if (section.baseScore && section.baseScore > 0 && queryToks.size === 0) {
    return section.baseScore;
  }
  let score = section.baseScore ?? 0;
  const bodyToks = tokens(section.body);
  for (const kw of section.keywords) {
    if (queryToks.has(kw)) score += 3;
  }
  for (const t of queryToks) {
    if (bodyToks.has(t)) score += 1;
  }
  return score;
}

/**
 * Build a compact, ranked context string for the current user message.
 *
 * budget: hard char cap for the returned block (default 2500 — was 6000).
 */
export function buildSmartChatContext(
  lastUserMessage: string,
  sources: CtxSources,
  budget = 2500,
): string {
  const lines: string[] = [];

  // Core header — ~250 chars, always included.
  const core: string[] = [];
  if (sources.brandName) core.push(`- Brand: ${sources.brandName}`);
  if (sources.oneLiner) core.push(`- One-liner: ${trim(sources.oneLiner, 160)}`);
  if (sources.voice) core.push(`- Voice: ${trim(sources.voice, 120)}`);
  if (sources.audience) core.push(`- Audience: ${trim(sources.audience, 160)}`);
  if (sources.website) core.push(`- Website: ${sources.website}`);
  if (core.length) {
    lines.push("## Brand");
    lines.push(...core);
  }

  const queryToks = tokens(lastUserMessage);

  // Score + sort sections
  const ranked = sources.sections
    .filter((s) => s.body && s.body.trim().length > 0)
    .map((s) => ({ s, score: scoreSection(s, queryToks) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  let used = lines.join("\n").length;
  for (const { s } of ranked) {
    const cap = s.maxChars ?? 600;
    const body = trim(s.body.trim(), cap);
    const block = `\n\n## ${s.label}\n${body}`;
    if (used + block.length > budget) {
      // Try a further-trimmed version once
      const remain = budget - used - (block.length - body.length);
      if (remain < 120) continue;
      lines.push(`\n\n## ${s.label}\n${trim(body, remain)}`);
      break;
    }
    lines.push(block);
    used += block.length;
  }

  return lines.join("").replace(/^\n+/, "");
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
