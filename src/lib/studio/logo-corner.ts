// Where the brand's real logo goes on a finished picture. Pure and
// browser-safe: the server measures how much is going on in each corner
// (edge energy where the logo would sit) and this decides. The brand's own
// corner wins while it is clear; a corner with words, the product or a busy
// detail in it is never stamped over. With every corner busy the logo is
// left off and the person is told, never laid over a headline.

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const LOGO_CORNERS: readonly LogoCorner[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
];

/** A corner this calm takes the logo with nothing in its way. */
export const CLEAR_CORNER = 6;
/** Above this a corner holds words or a busy detail: never under the logo. */
export const BUSY_CORNER = 12;

export type LogoPlacement =
  | { corner: LogoCorner; moved: boolean; skipped: false }
  | { corner: null; moved: false; skipped: true };

export function pickLogoCorner(
  busy: Partial<Record<LogoCorner, number>>,
  preferred: LogoCorner,
): LogoPlacement {
  const score = (corner: LogoCorner) => busy[corner] ?? Number.POSITIVE_INFINITY;
  // Nothing measured: keep the brand's corner, as before.
  if (LOGO_CORNERS.every((corner) => busy[corner] === undefined))
    return { corner: preferred, moved: false, skipped: false };
  if (score(preferred) <= CLEAR_CORNER) return { corner: preferred, moved: false, skipped: false };
  // The calmest corner; the bottom ones first on a tie, where a mark is expected.
  const calmest = [...LOGO_CORNERS].sort((a, b) => score(a) - score(b))[0];
  // The brand's corner is only a little busy and no corner is clearly calmer.
  if (score(preferred) <= BUSY_CORNER && score(calmest) > CLEAR_CORNER)
    return { corner: preferred, moved: false, skipped: false };
  if (score(calmest) <= BUSY_CORNER)
    return { corner: calmest, moved: calmest !== preferred, skipped: false };
  return { corner: null, moved: false, skipped: true };
}

export const LOGO_LEFT_OFF_NOTE =
  "The logo was left off: every corner of this picture has words or detail in it, and it would have covered them.";
