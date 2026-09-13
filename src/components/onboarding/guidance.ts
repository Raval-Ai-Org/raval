/** "Be direct; avoid jargon\n- Use data" → ["Be direct", "avoid jargon", "Use data"]. */
export function splitGuidance(input?: string): string[] {
  if (!input?.trim()) return [];
  let parts = input
    .split(/\r?\n|•|;/)
    .map((part) => part.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const sentences = parts[0]
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length > 1) parts = sentences;
  }
  return parts.slice(0, 5);
}
