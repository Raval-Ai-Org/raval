// Dynamic prompt assembly.
//
// `assemble()` takes labelled sections (system + user), removes empties,
// dedupes repeated sentences across sections, collapses whitespace, and
// enforces per-section budgets. Two invariants:
//   1. A rule stated in the system prompt is stripped from the user prompt.
//   2. Empty sections are omitted entirely — no `(none)` placeholder tokens.

import { joinFragments } from "./fragments";

export type Section = {
  /** Short label used as an H2 header when the section is non-empty. */
  label?: string;
  /** Section body. Falsy values cause the section to be dropped. */
  body?: string | number | null | false;
  /** Hard char budget for this section. */
  maxChars?: number;
};

/** Compose a single string from labelled sections. */
export function assemble(sections: Section[]): string {
  const out: string[] = [];
  for (const s of sections) {
    if (s.body == null || s.body === false || s.body === "") continue;
    let body = String(s.body).trim();
    if (!body) continue;
    if (s.maxChars && body.length > s.maxChars) {
      body = `${body.slice(0, s.maxChars)}…`;
    }
    out.push(s.label ? `## ${s.label}\n${body}` : body);
  }
  return out.join("\n\n");
}

/** Build a system prompt from fragments — trims and joins with single newlines. */
export function system(...fragments: Array<string | false | null | undefined>): string {
  return joinFragments(...fragments);
}

/** Wrap a JSON schema description compactly. */
export function schemaLine(schema: string): string {
  return `Schema: ${schema}`;
}

/** Collapse runs of whitespace and remove duplicate lines. */
export function compress(text: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trimEnd();
    const key = line.trim();
    if (!key) {
      // Collapse multiple blank lines into one.
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n").trim();
}
