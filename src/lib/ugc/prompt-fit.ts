// Fits a video prompt into a model's character limit without cutting the
// rules at its end. Whole sections go first, least important first; only if
// that is not enough is the end cut. Pure; used by the KIE request builder.

/** Sections a prompt can lose first, in order. The beat sheet, dialogue, product facts and "do not include" stay. */
const DROPPABLE = ["CREATIVE NOTES", "BRAND VOICE", "CAMERA & LOOK"];

const HEADING = /^([A-Z][A-Z &()/-]{3,})(?=:|\s*\(|\s*$)/;

function sections(prompt: string): { name: string | null; text: string }[] {
  const out: { name: string | null; text: string }[] = [];
  for (const line of prompt.split("\n")) {
    const heading = line.match(HEADING)?.[1]?.trim() ?? null;
    if (heading || !out.length) out.push({ name: heading, text: line });
    else out[out.length - 1].text += `\n${line}`;
  }
  return out;
}

export function fitVideoPrompt(prompt: string, limit: number): string {
  if (prompt.length <= limit) return prompt;
  let parts = sections(prompt);
  for (const name of DROPPABLE) {
    parts = parts.filter((part) => part.name !== name);
    const joined = parts.map((part) => part.text).join("\n");
    if (joined.length <= limit) return joined;
  }
  return parts
    .map((part) => part.text)
    .join("\n")
    .slice(0, limit);
}
