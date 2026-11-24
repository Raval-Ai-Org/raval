// skill-lines.ts — how Round 9 skill-pack lines reach a prompt (ADR-0053). Pure.
//
// The server picks a few short lines about this business (sector facts, the
// brand's type voice); prompt builders only place them inside the Business
// section, capped here so no pack can grow a prompt into a checklist.

/** Skill-pack lines for the Business section: at most 3, 450 characters (ADR-0053). */
export const SKILL_LINES_MAX = 3;
export const SKILL_LINES_CHARS = 450;
export function skillLinesBody(lines: readonly string[] | undefined): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of lines ?? []) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || out.length >= SKILL_LINES_MAX || used + line.length > SKILL_LINES_CHARS) continue;
    out.push(line);
    used += line.length + 1;
  }
  return out;
}
