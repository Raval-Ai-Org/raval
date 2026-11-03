// Inspo's places (ADR-0037). Pure and browser-safe.

export const INSPO_SECTIONS = ["board", "post", "video", "voice", "media"] as const;
export type InspoSection = (typeof INSPO_SECTIONS)[number];

/** `?s=` from the URL, or the board. Older Brand tiles map onto their new place. */
export function parseInspoSection(raw: string | null | undefined): InspoSection {
  if (!raw) return "board";
  if ((INSPO_SECTIONS as readonly string[]).includes(raw)) return raw as InspoSection;
  if (raw === "look") return "post";
  if (raw === "assets") return "media";
  if (raw === "writing") return "voice";
  return "board";
}
