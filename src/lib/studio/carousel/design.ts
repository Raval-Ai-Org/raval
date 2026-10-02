// Carousel design system: the choices that make every slide of one carousel
// look like one piece, every carousel from one brand look like the same
// profile, and no two carousels in a row look identical.
//
//   look      layout grammar. Fixed per brand (and Style), so the grid stays
//             consistent.
//   colorway  which palette colour is the canvas. Changes between carousels.
//   motif     the shape that runs across slide edges, so slide 2 visibly
//             continues slide 1. Changes between carousels.
//
// Pure and browser-safe: the preview and the server renderer both read it.
import { contrastRatio, hexToRgb, normalizeHex, relLuminance } from "@/lib/color";
import { catalogFont, nearestCatalogFont } from "@/lib/brand-kit/fonts";
import type { CarouselSpecOutput } from "../jobs";
import type { SlideRole } from "./story";

export const CAROUSEL_LOOKS = ["editorial", "bold", "soft", "frame"] as const;
export const CAROUSEL_COLORWAYS = ["light", "dark", "brand"] as const;
export const CAROUSEL_MOTIFS = ["orbit", "wave", "blocks"] as const;

export type CarouselLook = (typeof CAROUSEL_LOOKS)[number];
export type CarouselColorway = (typeof CAROUSEL_COLORWAYS)[number];
export type CarouselMotif = (typeof CAROUSEL_MOTIFS)[number];

export type CarouselDesign = {
  v: 1;
  look: CarouselLook;
  colorway: CarouselColorway;
  motif: CarouselMotif;
};

export type CarouselTheme = CarouselSpecOutput["theme"];

export type CarouselPalette = {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  background?: string | null;
  text?: string | null;
  extra?: (string | null | undefined)[] | null;
};

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Blend `a` toward `b` by `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** Near-black or near-white, whichever reads better on `bg`. */
function pickTextOn(bg: string): string {
  return contrastRatio("#0a0a0a", bg) >= contrastRatio("#fafaf7", bg) ? "#0a0a0a" : "#fafaf7";
}

const INK = "#0b0b0c";
const PAPER = "#ffffff";
const DEFAULT_PRIMARY = "#1f2937";

function hexes(palette: CarouselPalette | null | undefined): string[] {
  const p = palette ?? {};
  return [p.primary, p.secondary, p.accent, ...(p.extra ?? [])]
    .map((c) => normalizeHex(c ?? null))
    .filter((c): c is string => !!c);
}

/** A colour from the palette that reads on `bg`, else `base` pushed until it does. */
function readable(candidates: string[], bg: string, min: number, base: string): string {
  const hit = candidates.find((c) => contrastRatio(c, bg) >= min);
  if (hit) return hit;
  const toward = relLuminance(bg) > 0.5 ? INK : PAPER;
  for (let t = 0.2; t <= 1; t += 0.2) {
    const shade = mixHex(base, toward, t);
    if (contrastRatio(shade, bg) >= min) return shade;
  }
  return toward;
}

/** Whether the brand colour can be a full-bleed canvas of its own. */
function brandCanvas(primary: string): boolean {
  const lum = relLuminance(primary);
  return lum > 0.04 && lum < 0.85;
}

export function availableColorways(
  palette: CarouselPalette | null | undefined,
): CarouselColorway[] {
  const primary = hexes(palette)[0];
  return primary && brandCanvas(primary) ? ["light", "dark", "brand"] : ["light", "dark"];
}

/** A real catalogue family for a font name, so the preview and the render agree. */
export function carouselFont(name: string | null | undefined, fallback: string): string {
  if (!name || !name.trim()) return fallback;
  return (catalogFont(name) ?? nearestCatalogFont(name)).family;
}

export function carouselTheme(args: {
  palette?: CarouselPalette | null;
  fonts?: { heading?: string | null; body?: string | null } | null;
  colorway: CarouselColorway;
}): CarouselTheme {
  const list = hexes(args.palette);
  const primary = list[0] ?? DEFAULT_PRIMARY;
  const background = normalizeHex(args.palette?.background ?? null);
  const text = normalizeHex(args.palette?.text ?? null);

  let bg: string;
  let ink: string;
  let accent: string;
  if (args.colorway === "brand" && brandCanvas(primary)) {
    bg = primary;
    ink = pickTextOn(primary);
    accent = readable(
      [...list.slice(1), ...(background ? [background] : [])],
      primary,
      2.6,
      relLuminance(primary) > 0.5 ? INK : PAPER,
    );
  } else if (args.colorway === "dark") {
    const darkest = [...list, ...(text ? [text] : [])].sort(
      (a, b) => relLuminance(a) - relLuminance(b),
    )[0];
    bg = darkest && relLuminance(darkest) < 0.06 ? darkest : mixHex(INK, primary, 0.16);
    ink = "#f7f6f2";
    accent = readable(list, bg, 4, primary);
  } else {
    bg = background && relLuminance(background) > 0.8 ? background : mixHex(PAPER, primary, 0.05);
    ink = text && contrastRatio(text, bg) >= 7 ? text : mixHex(INK, primary, 0.14);
    accent = readable(list, bg, 3, primary);
  }

  const heading = carouselFont(args.fonts?.heading, "Inter");
  return {
    bg,
    ink,
    accent,
    accentInk: pickTextOn(accent),
    muted: mixHex(ink, bg, 0.36),
    surface: mixHex(bg, ink, 0.07),
    line: mixHex(bg, ink, 0.16),
    headingFont: heading,
    bodyFont: carouselFont(args.fonts?.body, heading),
  };
}

const HEX = /^#[0-9a-f]{6}$/;

/** A stored theme is user-editable meta: only well-formed values are drawn. */
export function safeTheme(raw: unknown): CarouselTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const colour = (key: string) => {
    const hex = normalizeHex(typeof t[key] === "string" ? (t[key] as string) : null);
    return hex && HEX.test(hex) ? hex : null;
  };
  const bg = colour("bg");
  const ink = colour("ink");
  const accent = colour("accent");
  if (!bg || !ink || !accent) return null;
  const heading = carouselFont(typeof t.headingFont === "string" ? t.headingFont : null, "Inter");
  return {
    bg,
    ink,
    accent,
    accentInk: colour("accentInk") ?? pickTextOn(accent),
    muted: colour("muted") ?? mixHex(ink, bg, 0.36),
    surface: colour("surface") ?? mixHex(bg, ink, 0.07),
    line: colour("line") ?? mixHex(bg, ink, 0.16),
    headingFont: heading,
    bodyFont: carouselFont(typeof t.bodyFont === "string" ? t.bodyFont : null, heading),
  };
}

export function safeDesign(raw: unknown): CarouselDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const look = CAROUSEL_LOOKS.find((x) => x === d.look);
  const colorway = CAROUSEL_COLORWAYS.find((x) => x === d.colorway);
  const motif = CAROUSEL_MOTIFS.find((x) => x === d.motif);
  return look && colorway && motif ? { v: 1, look, colorway, motif } : null;
}

/**
 * The design for a new carousel. The look is tied to the brand (and its
 * Style) so a profile reads as one hand; the colourway and motif move with
 * each carousel and never repeat the one before.
 */
export function pickCarouselDesign(args: {
  /** Stable per brand: workspace id plus the Style id, if any. */
  profileKey: string;
  /** Changes per carousel (and per regenerate). */
  seed: string;
  /** Recent carousels' designs, newest first. */
  previous?: ({ colorway?: string; motif?: string } | null | undefined)[];
  palette?: CarouselPalette | null;
}): CarouselDesign {
  const look = CAROUSEL_LOOKS[hash(`look:${args.profileKey}`) % CAROUSEL_LOOKS.length];
  const last = args.previous?.[0];
  const before = args.previous?.[1];
  const combos = availableColorways(args.palette).flatMap((colorway) =>
    CAROUSEL_MOTIFS.map((motif) => ({ colorway, motif })),
  );
  const fresh = combos.filter(
    (c) =>
      c.colorway !== last?.colorway &&
      c.motif !== last?.motif &&
      !(c.colorway === before?.colorway && c.motif === before?.motif),
  );
  const pool = fresh.length ? fresh : combos;
  const pick = pool[hash(`combo:${args.seed}`) % pool.length];
  return { v: 1, look, ...pick };
}

/** The colours one slide draws with. The closing slide flips to the accent. */
export function slideColors(theme: CarouselTheme, role: SlideRole | undefined) {
  if (role !== "cta") {
    return {
      bg: theme.bg,
      ink: theme.ink,
      muted: theme.muted,
      accent: theme.accent,
      accentInk: theme.accentInk,
      surface: theme.surface,
      line: theme.line,
    };
  }
  const ink = theme.accentInk;
  return {
    bg: theme.accent,
    ink,
    muted: mixHex(ink, theme.accent, 0.3),
    accent: ink,
    accentInk: theme.accent,
    surface: mixHex(theme.accent, ink, 0.1),
    line: mixHex(theme.accent, ink, 0.22),
  };
}

/** Canvas size in pixels for a carousel ratio. */
export function carouselCanvas(ratio: string | null | undefined): {
  width: number;
  height: number;
} {
  return ratio === "1:1" ? { width: 1080, height: 1080 } : { width: 1080, height: 1350 };
}

/** Type sizes at a 1080px-wide canvas, chosen by how much there is to say. */
export function headingSize(role: SlideRole | undefined, chars: number, square: boolean): number {
  const big = role === "cover" || role === "cta";
  const steps = big ? [118, 100, 86, 72] : [84, 74, 64, 56];
  const size = chars <= 26 ? steps[0] : chars <= 44 ? steps[1] : chars <= 64 ? steps[2] : steps[3];
  return Math.round(size * (square ? 0.86 : 1));
}

export function bodySize(chars: number, square: boolean): number {
  const size = chars <= 90 ? 44 : chars <= 170 ? 40 : 35;
  return Math.round(size * (square ? 0.9 : 1));
}

/**
 * Scripts the slide fonts can draw. Slides in other scripts (Arabic, Devanagari,
 * CJK…) still preview in the browser, but are not turned into images.
 */
/** Code point ranges the slide fonts cover: Latin, Greek, Cyrillic, punctuation, symbols. */
const DRAWABLE: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x024f],
  [0x0370, 0x03ff],
  [0x0400, 0x04ff],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20bf],
  [0x2100, 0x214f],
  [0x2190, 0x21ff],
  [0x2200, 0x22ff],
];

export function canRenderText(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!DRAWABLE.some(([from, to]) => code >= from && code <= to)) return false;
  }
  return true;
}
