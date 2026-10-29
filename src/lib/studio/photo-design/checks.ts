// Whether a design layer can hold the person's photos: the right number of
// windows, big enough, and no face hidden behind the design. Measured numbers
// in, a verdict and a note for the next attempt out. Pure.
import type { Region } from "./geometry";
import type { PhotoDesignPlan, PhotoShape } from "./plan";

/** A photo area smaller than this share of the canvas is a speck, not a window. */
export const SPECK_SHARE = 0.004;
/** The hero window takes at least this share of the canvas, every other one this. */
export const HERO_SHARE = 0.1;
export const WINDOW_SHARE = 0.025;
/** A full-bleed photo keeps at least this share of the canvas. */
export const OVERLAY_SHARE = 0.45;
/** A face counts as hidden when less than this share of it still shows. */
export const FACE_VISIBLE = 0.6;

export type LayerVerdict =
  | {
      ok: true;
      /** Region index (into `regions`) for each photo, in plan order. */ windows: number[];
    }
  | { ok: false; reason: string; feedback: string };

const SHAPE_ASPECT: Record<PhotoShape, number> = { landscape: 1.5, portrait: 0.75, square: 1 };

export function judgeLayer(
  plan: Pick<PhotoDesignPlan, "layout" | "order" | "shapes" | "key">,
  regions: Region[],
  canvas: { width: number; height: number },
  photoAspects?: number[],
): LayerVerdict {
  const total = canvas.width * canvas.height;
  const real = regions.filter((region) => region.area / total >= SPECK_SHARE);
  const keyWords = `flat pure ${plan.key.name} (${plan.key.hex})`;
  if (plan.layout === "overlay") {
    const shown = real.reduce((sum, region) => sum + region.area, 0) / total;
    if (shown < OVERLAY_SHARE)
      return {
        ok: false,
        reason: "The design covered too much of the photo.",
        feedback: `Leave far more of the canvas as ${keyWords}: at least half of it must stay empty so the real photo shows. Use fewer, smaller design elements, kept to the edges.`,
      };
    return { ok: true, windows: real.map((_, i) => i) };
  }
  const expected = plan.order.length;
  if (real.length !== expected)
    return {
      ok: false,
      reason: `Found ${real.length} photo windows for ${expected} photos.`,
      feedback: `Paint exactly ${expected} separate photo window${expected === 1 ? "" : "s"} in ${keyWords} — no more, no fewer. Do not let banners, text or shapes cut a window in two, and use the key colour nowhere else.`,
    };
  const tooSmall = real.findIndex(
    (region, i) => region.area / total < (i === 0 ? HERO_SHARE : WINDOW_SHARE),
  );
  if (tooSmall >= 0)
    return {
      ok: false,
      reason: "A photo window was too small to show the photo.",
      feedback: `Make the photo windows larger: the main window at least ${Math.round(HERO_SHARE * 100 * 1.5)}% of the canvas and every other window at least ${Math.round(WINDOW_SHARE * 100 * 1.5)}%.`,
    };
  // The strongest photo takes the largest window; the rest go where their
  // shape fits best.
  const free = new Set(real.map((_, i) => i).slice(1));
  const windows = [0];
  for (let p = 1; p < expected; p++) {
    const aspect = photoAspects?.[plan.order[p]] ?? SHAPE_ASPECT[plan.shapes[p]];
    let best = -1;
    let bestScore = Infinity;
    for (const index of free) {
      const region = real[index];
      const score = Math.abs(Math.log(region.width / region.height / aspect));
      if (score < bestScore - 1e-9) {
        best = index;
        bestScore = score;
      }
    }
    free.delete(best);
    windows.push(best);
  }
  return { ok: true, windows: windows.map((i) => regions.indexOf(real[i])) };
}

/** Every face that should show still shows (shares measured on the result). */
export function judgeFaces(
  shares: number[],
): { ok: true } | { ok: false; reason: string; feedback: string } {
  const hidden = shares.filter((share) => share < FACE_VISIBLE).length;
  if (!hidden) return { ok: true };
  return {
    ok: false,
    reason: `${hidden} face${hidden === 1 ? " was" : "s were"} covered by the design.`,
    feedback:
      "Keep text, badges, stickers and shapes off people's faces: put them on calm areas, the canvas edges or the frame around the photos.",
  };
}
