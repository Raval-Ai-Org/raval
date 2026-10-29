// Writing the one look (`dna.look`, ADR-0032) from Inspo. Pure.

import type { BrandLookSpec, VideoStyle, VisualStyle, WritingStyle } from "@/lib/brand-look/spec";

const filled = (o: object | undefined) =>
  !!o &&
  Object.values(o).some((v) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));

/** Empty sections are dropped so "nothing set" stays nothing. */
export function tidyLook(next: BrandLookSpec): BrandLookSpec {
  return {
    v: 1,
    writing: filled(next.writing) ? (next.writing as WritingStyle) : undefined,
    visual: filled(next.visual) ? (next.visual as VisualStyle) : undefined,
    video: filled(next.video) ? (next.video as VideoStyle) : undefined,
  };
}

export const MAX_EXAMPLES = 3;
export const EXAMPLE_CHARS = 800;

/** Add a pasted example post (trimmed, deduped, at most three, newest first). */
export function addExample(examples: string[] | undefined, text: string): string[] {
  const clean = text.trim().slice(0, EXAMPLE_CHARS);
  const list = examples ?? [];
  if (!clean || list.some((e) => e.trim() === clean)) return list;
  return [clean, ...list].slice(0, MAX_EXAMPLES);
}
