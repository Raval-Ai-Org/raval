// Client-side canvas compositor: overlays the workspace's real logo onto
// a generated post image. Runs entirely in the browser so we never bill a
// second AI call to place the mark — and the logo is guaranteed to be the
// actual brand asset, not an AI hallucination.

import type { ImgSize } from "@/lib/post-image";

export type LogoCorner = "tl" | "tr" | "bl" | "br";

export type CompositeOptions = {
  logoUrl: string;
  size: ImgSize;
  /** Corner placement. Defaults to bottom-right (feed-safe). */
  corner?: LogoCorner;
  /** Logo width as % of canvas width. Default 12%. */
  widthPct?: number;
  /** Inset from the edge as % of canvas width. Default 4%. */
  insetPct?: number;
  /** Background chip color under the logo (semi-transparent). null = none. */
  chip?: string | null;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo load failed"));
    img.src = src;
  });
}

function dimensions(size: ImgSize): { w: number; h: number } {
  const [w, h] = size.split("x").map((n) => parseInt(n, 10));
  return { w, h };
}

/**
 * Take a data-URL post image, overlay `logoUrl` in a safe corner, return
 * a new data-URL (PNG). Returns the original on any error so the UI never
 * breaks because of an overlay failure.
 */
export async function compositeLogoOnImage(
  baseDataUrl: string,
  opts: CompositeOptions,
): Promise<string> {
  if (typeof document === "undefined") return baseDataUrl;
  try {
    const [base, logo] = await Promise.all([
      loadImage(baseDataUrl),
      loadImage(opts.logoUrl),
    ]);
    const { w, h } = dimensions(opts.size);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return baseDataUrl;
    ctx.drawImage(base, 0, 0, w, h);

    const widthPct = opts.widthPct ?? 0.12;
    const insetPct = opts.insetPct ?? 0.04;
    const corner: LogoCorner = opts.corner ?? "br";

    const logoW = Math.round(w * widthPct);
    const ratio = logo.height / logo.width || 1;
    const logoH = Math.round(logoW * ratio);
    const inset = Math.round(w * insetPct);

    let x = w - logoW - inset;
    let y = h - logoH - inset;
    if (corner === "tl") { x = inset; y = inset; }
    else if (corner === "tr") { x = w - logoW - inset; y = inset; }
    else if (corner === "bl") { x = inset; y = h - logoH - inset; }

    // Optional soft chip behind the logo for legibility on busy scenes.
    if (opts.chip) {
      const pad = Math.round(logoW * 0.18);
      ctx.fillStyle = opts.chip;
      const r = Math.round(logoW * 0.14);
      roundRect(ctx, x - pad, y - pad, logoW + pad * 2, logoH + pad * 2, r);
      ctx.fill();
    }

    ctx.drawImage(logo, x, y, logoW, logoH);
    return canvas.toDataURL("image/png");
  } catch {
    return baseDataUrl;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
