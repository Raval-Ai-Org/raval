"use client";

import { paletteFromPixels } from "@/lib/onboarding/manual-brand";

// The uploaded logo is redrawn in the browser: at most 512px, PNG (WebP when
// that is much smaller), so nothing but pixels is kept and it is small enough
// to live on Brand DNA, where the logo overlay already reads inline images.

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 512;
const TARGET_CHARS = 350_000;

export type ProcessedLogo = { dataUrl: string; palette: string[] };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This logo can't be read. Try a PNG or JPEG."));
    img.src = src;
  });
}

export async function processLogo(file: File): Promise<ProcessedLogo> {
  if (!LOGO_TYPES.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or SVG logo.");
  if (!file.size) throw new Error("This file is empty.");
  if (file.size > MAX_BYTES) throw new Error("Logos up to 10 MB, please.");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't read the logo.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length > TARGET_CHARS) {
      const webp = canvas.toDataURL("image/webp", 0.92);
      if (webp.startsWith("data:image/webp") && webp.length < dataUrl.length) dataUrl = webp;
    }
    if (dataUrl.length > TARGET_CHARS)
      throw new Error("This logo is too detailed. Try a simpler file.");
    // Colours from a small copy: plenty for a palette, cheap to read.
    const sample = document.createElement("canvas");
    const s = Math.min(1, 96 / Math.max(canvas.width, canvas.height));
    sample.width = Math.max(1, Math.round(canvas.width * s));
    sample.height = Math.max(1, Math.round(canvas.height * s));
    const sctx = sample.getContext("2d");
    let palette: string[] = [];
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, sample.width, sample.height);
      palette = paletteFromPixels(sctx.getImageData(0, 0, sample.width, sample.height).data);
    }
    return { dataUrl, palette };
  } finally {
    URL.revokeObjectURL(url);
  }
}
