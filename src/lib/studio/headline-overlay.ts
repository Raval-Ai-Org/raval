// Editable picture words (Round 9, flag `headline`). The image model draws a
// picture with no words and a calm area; code sets the headline on it in the
// brand's own font. The word-free picture is kept, so a person fixes a word
// with "Edit text" at no cost and with no new render.
// Pure: the drawing is in src/server/studio/headline-overlay.server.tsx.

/** What the drawer needs, stored on the provider task and then on `output.artwork`. */
export type HeadlineOverlay = { headline: string; brandName: string; font: string };

/** Added to the picture prompt: no words, and a quiet band for the headline. */
export const OVERLAY_SPACE_NOTE =
  "Draw no words, letters, numbers or signs anywhere in the picture. Keep either the top third or the bottom third calm and simple (sky, wall, table, soft shadow, plain background), with no faces or key detail there: a headline is set on it afterwards.";

/** How plain and how bright a band of the picture is (0-1 each). */
export type BandRead = { busy: number; light: number };

export type OverlayPlacement = { at: "top" | "bottom"; ink: "light" | "dark" };

/**
 * Where the headline goes: the calmer band (a tie goes to the bottom, where a
 * headline reads after the picture), and ink that contrasts with it.
 */
export function overlayPlacement(top: BandRead, bottom: BandRead): OverlayPlacement {
  const at = top.busy + 0.04 < bottom.busy ? "top" : "bottom";
  const band = at === "top" ? top : bottom;
  return { at, ink: band.light > 0.62 ? "dark" : "light" };
}

/** Headline size: big for a few words, smaller as it grows; never under 40px on 1080. */
export function overlayFontSize(headline: string, width: number): number {
  const chars = Math.max(1, headline.trim().length);
  const base = width * 0.13;
  const size = chars <= 14 ? base : base * Math.sqrt(14 / chars);
  return Math.round(Math.max(width * 0.037, Math.min(base, size)));
}

/** A headline worth drawing this way: real words, short enough to set big. */
export function overlayHeadline(text: string | null | undefined, maxWords = 12): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 90) return null;
  if (clean.split(" ").length > maxWords) return null;
  return clean;
}
