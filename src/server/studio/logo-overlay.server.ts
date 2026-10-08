import "server-only";

import sharp, { type OverlayOptions } from "sharp";

import { safeFetch } from "@/server/safe-fetch";

// Puts the workspace's real logo on a finished image. The image model is told
// to leave the corner clean and never draw a mark itself, so this is the only
// place a logo comes from. Fails open: any problem returns the image unchanged.

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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

export async function overlayBrandLogo(
  dataUrl: string,
  logoUrl: string,
  corner: LogoCorner,
): Promise<string> {
  try {
    const match = DATA_URL.exec(dataUrl);
    if (!match) return dataUrl;
    const base = Buffer.from(match[1], "base64");
    const source = await logoBytes(logoUrl);
    if (!source) return dataUrl;

    const { width: w, height: h } = await sharp(base).metadata();
    if (!w || !h) return dataUrl;

    const logo = await sharp(source, { density: 300 })
      .resize({ width: Math.round(w * 0.16), height: Math.round(h * 0.1), fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const lw = logo.info.width;
    const lh = logo.info.height;
    const inset = Math.round(w * 0.04);
    const left = corner.endsWith("left") ? inset : w - lw - inset;
    const top = corner.startsWith("top") ? inset : h - lh - inset;
    if (left < 0 || top < 0) return dataUrl;

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

    const out = await sharp(base).composite(layers).png().toBuffer();
    return `data:image/png;base64,${out.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}
