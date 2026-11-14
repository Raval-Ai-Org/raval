import "server-only";

import sharp, { type OverlayOptions } from "sharp";

import {
  LOGO_CORNERS,
  pickLogoCorner,
  type LogoCorner,
  type LogoPlacement,
} from "@/lib/studio/logo-corner";
import { safeFetch } from "@/server/safe-fetch";

// Puts the workspace's real logo on a finished image. The image model is told
// to leave the corner clean and never draw a mark itself, so this is the only
// place a logo comes from. Before placing it, each corner is measured: the
// logo never lands on words, the product or a busy detail (pickLogoCorner).
// Fails open: any problem returns the image unchanged.

export type { LogoCorner };

const MAX_LOGO_BYTES = 4 * 1024 * 1024;
const DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i;

async function logoBytes(logoUrl: string): Promise<Buffer | null> {
  const inline = DATA_URL.exec(logoUrl);
  if (inline) return Buffer.from(inline[1], "base64");
  // The logo URL comes from user-editable Brand DNA.
  const res = await safeFetch(logoUrl, {
    timeoutMs: 10_000,
    maxBytes: MAX_LOGO_BYTES,
    onOverflow: "error",
    headers: { accept: "image/png,image/svg+xml,image/jpeg,image/webp,image/*;q=0.8" },
  });
  return res.ok && res.bytes.byteLength ? Buffer.from(res.bytes) : null;
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Width the corners are measured at, so the scores mean the same on every size. */
const MEASURE_WIDTH = 360;

/**
 * How much is going on in each corner, where a logo `lw`×`lh` (with its chip)
 * would sit on a `w`×`h` picture: the spread of a Laplacian, so flat sky,
 * a plain backdrop or a soft gradient read low and letters read high.
 */
export async function cornerBusyness(
  base: Buffer,
  box: { w: number; h: number; lw: number; lh: number; inset: number },
): Promise<Record<LogoCorner, number>> {
  const scale = MEASURE_WIDTH / box.w;
  const height = Math.max(1, Math.round(box.h * scale));
  const grey = await sharp(base)
    .greyscale()
    .resize(MEASURE_WIDTH, height, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer();
  // The logo's box, its chip's padding and a little air around it.
  const pad = Math.round(box.lw * 0.12) + Math.round(box.inset * 0.5);
  const cw = Math.min(MEASURE_WIDTH, Math.round((box.lw + pad * 2) * scale));
  const ch = Math.min(height, Math.round((box.lh + pad * 2) * scale));
  const inset = Math.max(0, Math.round((box.inset - pad) * scale));
  const out = {} as Record<LogoCorner, number>;
  for (const corner of LOGO_CORNERS) {
    const x0 = corner.endsWith("left") ? inset : Math.max(0, MEASURE_WIDTH - cw - inset);
    const y0 = corner.startsWith("top") ? inset : Math.max(0, height - ch - inset);
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = y0; y < Math.min(height, y0 + ch); y++)
      for (let x = x0; x < Math.min(MEASURE_WIDTH, x0 + cw); x++) {
        const v = grey[y * MEASURE_WIDTH + x];
        sum += v;
        sq += v * v;
        n += 1;
      }
    out[corner] = n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
  }
  return out;
}

export type PlacedLogo = { dataUrl: string; placement: LogoPlacement | null };

/**
 * The logo placed in the brand's corner when it is clear, else the calmest
 * corner, else left off (`placement.skipped`). `placement` is null when no
 * logo could be read; the picture is then unchanged.
 */
export async function placeBrandLogo(
  dataUrl: string,
  logoUrl: string,
  corner: LogoCorner,
): Promise<PlacedLogo> {
  try {
    const match = DATA_URL.exec(dataUrl);
    if (!match) return { dataUrl, placement: null };
    const base = Buffer.from(match[1], "base64");
    const placed = await placedLogoLayers(base, logoUrl, corner);
    if (!placed) return { dataUrl, placement: null };
    if (!placed.layers) return { dataUrl, placement: placed.placement };
    const out = await sharp(base).composite(placed.layers).png().toBuffer();
    return {
      dataUrl: `data:image/png;base64,${out.toString("base64")}`,
      placement: placed.placement,
    };
  } catch {
    return { dataUrl, placement: null };
  }
}

export async function overlayBrandLogo(
  dataUrl: string,
  logoUrl: string,
  corner: LogoCorner,
): Promise<string> {
  return (await placeBrandLogo(dataUrl, logoUrl, corner)).dataUrl;
}

/**
 * The logo (and its chip, when it would vanish into `base`) as layers for a
 * picture the size of `base`, in the corner `pickLogoCorner` chose. A video
 * lays them on every frame, judged on one frame of it. Null when there is no
 * usable logo or no corner is clear of words and detail.
 */
export async function logoLayers(
  base: Buffer,
  logoUrl: string,
  corner: LogoCorner,
): Promise<OverlayOptions[] | null> {
  return (await placedLogoLayers(base, logoUrl, corner))?.layers ?? null;
}

async function placedLogoLayers(
  base: Buffer,
  logoUrl: string,
  preferred: LogoCorner,
): Promise<{ layers: OverlayOptions[] | null; placement: LogoPlacement } | null> {
  try {
    const source = await logoBytes(logoUrl);
    if (!source) return null;

    const { width: w, height: h } = await sharp(base).metadata();
    if (!w || !h) return null;

    const logo = await sharp(source, { density: 300 })
      .resize({ width: Math.round(w * 0.16), height: Math.round(h * 0.1), fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const lw = logo.info.width;
    const lh = logo.info.height;
    const inset = Math.round(w * 0.04);
    // QA before stamping: never over words, the product or a busy detail.
    const busy = await cornerBusyness(base, { w, h, lw, lh, inset }).catch(() => ({}));
    const placement = pickLogoCorner(busy, preferred);
    if (placement.skipped) return { layers: null, placement };
    const corner = placement.corner;
    const left = corner.endsWith("left") ? inset : w - lw - inset;
    const top = corner.startsWith("top") ? inset : h - lh - inset;
    if (left < 0 || top < 0) return null;

    // A transparent mark that would vanish into the picture gets a soft chip.
    let lum = 0;
    let visible = 0;
    for (let i = 0; i < logo.data.length; i += 4) {
      if (logo.data[i + 3] < 128) continue;
      lum += luminance(logo.data[i], logo.data[i + 1], logo.data[i + 2]);
      visible += 1;
    }
    const layers: OverlayOptions[] = [];
    const transparent = visible > 0 && visible < lw * lh * 0.95;
    if (transparent) {
      const stats = await sharp(base).extract({ left, top, width: lw, height: lh }).stats();
      const [r, g, b] = stats.channels.map((channel) => channel.mean);
      const logoLum = lum / visible;
      if (Math.abs(luminance(r, g ?? r, b ?? r) - logoLum) < 70) {
        const pad = Math.round(lw * 0.12);
        const cw = lw + pad * 2;
        const ch = lh + pad * 2;
        const fill = logoLum < 128 ? "#ffffff" : "#111111";
        layers.push({
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="${Math.round(pad * 0.9)}" fill="${fill}" fill-opacity="0.88"/></svg>`,
          ),
          left: Math.max(0, left - pad),
          top: Math.max(0, top - pad),
        });
      }
    }
    layers.push({
      input: logo.data,
      raw: { width: lw, height: lh, channels: 4 },
      left,
      top,
    });
    return { layers, placement };
  } catch {
    return null;
  }
}
