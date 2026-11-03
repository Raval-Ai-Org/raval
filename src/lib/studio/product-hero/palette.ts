// The poster's colours come from the product itself (ADR-0040). Pure.
//
// Studied product feeds are tone-on-tone: the whole frame is a light tint of
// the pack's own colour, the words a deep shade of it, and one contrasting
// accent used a few times. Read from the cut-out's opaque pixels, so a
// product's posts share one colour family and read as a series; the mood
// (light tint, deep, accent world, two-tone, dark) changes post to post
// (variety.ts), so no two posters look the same.
import type { PaletteMood } from "./variety";

export type ProductPalette = {
  /** The pack's own colour, or null for a white, black or clear product. */
  product: string | null;
  /** How the colours are used on this poster (default: a light tint). */
  mood?: PaletteMood;
  background: string;
  /** A second background colour for a two-tone poster. */
  background2?: string;
  text: string;
  accent: string;
};

type Hsl = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      : max === gn
        ? ((bn - rn) / d + 2) * 60
        : ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const BINS = 24;

/**
 * The pack's dominant colour from RGBA pixels: chromatic, opaque pixels
 * vote for their hue, weighted by saturation. Null when too little of the
 * product has a colour (a white bottle with black type, clear glass).
 */
export function dominantColour(rgba: Uint8Array, minShare = 0.12): string | null {
  const weight = new Array<number>(BINS).fill(0);
  const sums = Array.from({ length: BINS }, () => ({ s: 0, l: 0, n: 0 }));
  let opaque = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue;
    opaque++;
    const c = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (c.s < 0.18 || c.l < 0.12 || c.l > 0.94) continue;
    const bin = Math.floor(c.h / (360 / BINS)) % BINS;
    weight[bin] += c.s;
    sums[bin].s += c.s;
    sums[bin].l += c.l;
    sums[bin].n++;
  }
  if (!opaque) return null;
  // Neighbouring bins count together, so a hue on a bin edge isn't split.
  let best = -1;
  let bestWeight = 0;
  for (let b = 0; b < BINS; b++) {
    const w = weight[b] + 0.5 * (weight[(b + 1) % BINS] + weight[(b + BINS - 1) % BINS]);
    if (w > bestWeight) {
      bestWeight = w;
      best = b;
    }
  }
  if (best < 0 || sums[best].n / opaque < minShare) return null;
  const { s, l, n } = sums[best];
  return hslToHex({ h: (best + 0.5) * (360 / BINS), s: s / n, l: l / n });
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Background, text and accent for a product hero. The brand's own accent is
 * kept when it stands apart from the pack's colour; otherwise a warm
 * contrasting hue. A colourless product takes the brand's colour as its world.
 */
export function productPalette(args: {
  product: string | null;
  brandColours?: readonly string[];
  mood?: PaletteMood;
}): ProductPalette {
  const brand = (args.brandColours ?? [])
    .map((c) => ({ hex: c, hsl: hexToHsl(c) }))
    .filter((c): c is { hex: string; hsl: Hsl } => !!c.hsl && c.hsl.s > 0.15);
  const base = (args.product ? hexToHsl(args.product) : null) ?? brand[0]?.hsl ?? null;
  const mood = args.mood ?? "tint";
  if (!base)
    return mood === "noir" || mood === "deep"
      ? { product: args.product, mood, background: "#151517", text: "#f4f2ee", accent: "#e0645c" }
      : { product: args.product, mood, background: "#f2f0ec", text: "#1d1d1f", accent: "#e0645c" };
  const h = base.h;
  const s = Math.min(Math.max(base.s, 0.35), 0.7);
  const brandAccent = brand.find((c) => hueGap(c.hsl.h, h) >= 45);
  const accent = brandAccent ? brandAccent.hex : hslToHex({ h: (h + 160) % 360, s: 0.72, l: 0.6 });
  const accentHue = hexToHsl(accent)?.h ?? (h + 160) % 360;
  const deepText = hslToHex({ h, s: Math.min(s + 0.1, 0.75), l: 0.2 });
  const lightText = hslToHex({ h, s: 0.25, l: 0.95 });
  switch (mood) {
    case "deep":
      return {
        product: args.product,
        mood,
        background: hslToHex({ h, s: Math.min(s + 0.15, 0.8), l: 0.32 }),
        text: lightText,
        accent,
      };
    case "accent-world":
      return {
        product: args.product,
        mood,
        background: hslToHex({ h: accentHue, s: 0.55, l: 0.8 }),
        text: hslToHex({ h: accentHue, s: 0.6, l: 0.2 }),
        accent: hslToHex({ h, s: Math.min(s + 0.15, 0.8), l: 0.45 }),
      };
    case "duo":
      return {
        product: args.product,
        mood,
        background: hslToHex({ h, s, l: 0.84 }),
        background2: hslToHex({ h: accentHue, s: 0.5, l: 0.84 }),
        text: deepText,
        accent,
      };
    case "noir":
      return {
        product: args.product,
        mood,
        background: hslToHex({ h, s: 0.3, l: 0.08 }),
        text: lightText,
        accent: hslToHex({ h, s: Math.min(s + 0.2, 0.85), l: 0.6 }),
      };
    default:
      return {
        product: args.product,
        mood: "tint",
        background: hslToHex({ h, s, l: 0.86 }),
        text: deepText,
        accent,
      };
  }
}

/** Prompt lines for the palette. */
export function paletteLines(p: ProductPalette): string[] {
  const own = p.product ? `, the product's own colour ${p.product} the strongest note` : "";
  const ground =
    p.mood === "deep"
      ? `• A rich, deep colour world: background and set in deep, saturated shades around ${p.background}${own}; the product glows against it.`
      : p.mood === "accent-world"
        ? `• The background and set are the contrasting colour, in tints around ${p.background}, so the product's own colour${p.product ? ` ${p.product}` : ""} pops against it.`
        : p.mood === "duo"
          ? `• Two tones: a smooth blend from ${p.background} to ${p.background2 ?? p.background}${own}.`
          : p.mood === "noir"
            ? `• A dark, quiet world: near-black background around ${p.background}, the light and a soft glow in the product's own colour${p.product ? ` ${p.product}` : ""}.`
            : `• The whole frame lives in the product's colour family: background and set in light tints around ${p.background}${own}.`;
  return [
    "COLOUR — taken from the product itself:",
    ground,
    `• Words in ${p.text}; small icons, stars or one emphasised word in the accent ${p.accent}, a few small hits only.`,
    "• No other colours: no rainbow gradients, no unrelated greens, golds or browns, no colour the product doesn't carry.",
  ];
}
