// Is a cut-out a clean product on transparency? (ADR-0040). Pure.
//
// The image model is asked for the product alone on a transparent
// background. Before the cut-out is stored and used, its alpha channel has to
// show that: real transparency around a single subject of a sensible size
// that isn't just the whole photo.

export type CutoutVerdict =
  | {
      ok: true;
      share: number;
      box: { left: number; top: number; width: number; height: number };
      /** The product runs off its photo's edge: only part of it is there. */
      cropped: boolean;
    }
  | { ok: false; reason: string };

const OPAQUE = 128;

/**
 * `alpha` is one byte per pixel. Fails when there is no real transparency,
 * the subject is a speck or nearly the whole frame, or it runs along three or
 * more edges (the background wasn't removed).
 */
export function judgeCutout(alpha: Uint8Array, width: number, height: number): CutoutVerdict {
  if (!width || !height || alpha.length < width * height)
    return { ok: false, reason: "The cut-out is empty." };
  let solid = 0;
  let clear = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      if (a < 16) clear++;
      if (a < OPAQUE) continue;
      solid++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const total = width * height;
  if (clear / total < 0.08) return { ok: false, reason: "The background wasn't removed." };
  const share = solid / total;
  if (share < 0.04) return { ok: false, reason: "The product is too small in the cut-out." };
  if (share > 0.9) return { ok: false, reason: "The background wasn't removed." };
  const edgeShare = (count: number, length: number) => count / length > 0.2;
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  for (let x = 0; x < width; x++) {
    if (alpha[x] >= OPAQUE) top++;
    if (alpha[(height - 1) * width + x] >= OPAQUE) bottom++;
  }
  for (let y = 0; y < height; y++) {
    if (alpha[y * width] >= OPAQUE) left++;
    if (alpha[y * width + width - 1] >= OPAQUE) right++;
  }
  const edges = [
    edgeShare(top, width),
    edgeShare(bottom, width),
    edgeShare(left, height),
    edgeShare(right, height),
  ].filter(Boolean).length;
  if (edges >= 3) return { ok: false, reason: "The background wasn't removed." };
  return {
    ok: true,
    share,
    box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    cropped: edges > 0,
  };
}

/** Alpha below this is the model's glow or haze, not the product. */
const HAZE = 96;
/** Alpha above this is solid product. */
const SOLID = 224;

/**
 * Removes the soft glow an image model leaves around a cut-out and keeps a
 * short ramp at the edge, so the product sits cleanly in any scene. In place.
 */
export function cleanAlpha(alpha: Uint8Array): Uint8Array {
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    alpha[i] = a <= HAZE ? 0 : a >= SOLID ? 255 : Math.round(((a - HAZE) / (SOLID - HAZE)) * 255);
  }
  return alpha;
}

/** The subject's box grown by `pad` (a share of its larger side), kept inside the image. */
export function paddedBox(
  box: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  pad = 0.04,
) {
  const p = Math.round(Math.max(box.width, box.height) * pad);
  const left = Math.max(0, box.left - p);
  const top = Math.max(0, box.top - p);
  return {
    left,
    top,
    width: Math.min(size.width, box.left + box.width + p) - left,
    height: Math.min(size.height, box.top + box.height + p) - top,
  };
}
