// Length caps for the blocks every generator reads (Round 5, token cost).
// A block is cut at a line boundary so no fact is left half-written. Pure.

/** Most characters each brain block may take in a Studio prompt. */
export const CONTEXT_CAPS = {
  catalog: 1800,
  audience: 1500,
  rivals: 800,
  strategy: 1500,
  goal: 600,
  campaigns: 900,
} as const;

export function capBlock(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastLine = cut.lastIndexOf("\n");
  return (lastLine > max * 0.5 ? cut.slice(0, lastLine) : cut.replace(/\s+\S*$/, "")).trim();
}
