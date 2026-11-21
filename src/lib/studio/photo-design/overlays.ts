// How words go onto a person's own full-bleed photo: a small library of
// proven treatments, learned from small businesses' best posts (reference
// study round 6, docs/studio/reference-study-2026-10.md) and written
// brand-neutral. Each one says where the design sits on the photo and how it
// is built; code picks one that keeps every face clear, so the model never
// decides where words cover a person. Pure and browser-safe.
//
// Ids are stored on photo-design plans: add treatments, never rename ids.
import type { Box } from "./read";

export type OverlayId =
  | "header-band"
  | "curved-panel"
  | "sky-headline"
  | "stat-card"
  | "corner-couplet"
  | "sticker-callout"
  | "side-column"
  | "dark-header";

export type PhotoOverlay = {
  id: OverlayId;
  name: string;
  /** Canvas areas (fractions) the design covers; faces must stay out of them. */
  zones: Box[];
  /** Most words it holds well (all copy lines together). */
  maxWords: number;
  /** Covers the bottom edge (where a video's captions go). */
  usesBottom: boolean;
  /** How it is built, for the design-layer prompt. */
  design: string;
};

export const PHOTO_OVERLAYS: readonly PhotoOverlay[] = [
  {
    id: "header-band",
    name: "Headline band",
    zones: [{ x: 0, y: 0, w: 1, h: 0.32 }],
    maxWords: 16,
    usesBottom: false,
    design:
      "A solid band in the brand's darkest colour across the full width of the top 28–32%, with a crisp straight lower edge. Inside it, left-aligned on a generous margin: the headline over two lines, the first line regular weight and the second line bold (or the key word in the accent colour). Any support line sits small under the headline, still inside the band. Below the band the photo is untouched.",
  },
  {
    id: "curved-panel",
    name: "Curved panel",
    zones: [{ x: 0, y: 0, w: 1, h: 0.36 }],
    maxWords: 14,
    usesBottom: false,
    design:
      "A light panel (cream, off-white or the brand's lightest colour) across the top 30–36%, whose lower edge is one soft, wide curve, like a gentle wave. Inside it, left-aligned: the headline in an elegant serif in caps, a second line smaller in the same serif, and any support line small in the accent colour. Everything else is the photo.",
  },
  {
    id: "sky-headline",
    name: "Headline in the open sky",
    zones: [{ x: 0.04, y: 0.04, w: 0.72, h: 0.3 }],
    maxWords: 9,
    usesBottom: false,
    design:
      "No panel and no box: the words sit straight on the calm top-left of the photo (sky, water or a plain wall), in heavy white caps with a very soft shadow for legibility. If the copy holds a figure, set it larger and in the accent colour at the start of the headline. Any support line small and white under it. Nothing else.",
  },
  {
    id: "stat-card",
    name: "Figure card",
    zones: [{ x: 0.52, y: 0.66, w: 0.44, h: 0.28 }],
    maxWords: 12,
    usesBottom: true,
    design:
      "One small dark rounded card in the lower right (about 40% of the width), with a thin accent-colour line along its bottom edge. Inside it: the headline (or the figure, if the copy has one) large in the accent colour, and any support line in small white type under it. Nothing else on the photo.",
  },
  {
    id: "corner-couplet",
    name: "Quiet corner line",
    zones: [{ x: 0.05, y: 0.74, w: 0.62, h: 0.2 }],
    maxWords: 10,
    usesBottom: true,
    design:
      "No panel: one short statement in bold white sans-serif over two lines, small (about a third of the width), in the lower-left over the darkest calm part of the photo, with a very soft shadow. It reads like a whispered line, not a banner. Nothing else on the photo.",
  },
  {
    id: "sticker-callout",
    name: "Sticker callout",
    zones: [
      { x: 0, y: 0, w: 1, h: 0.28 },
      { x: 0.05, y: 0.56, w: 0.4, h: 0.16 },
    ],
    maxWords: 18,
    usesBottom: false,
    design:
      "A solid band in the brand's darkest colour across the top 24–28% holding the headline in heavy white type, with the key phrase underlined by a thick accent-colour line. Lower on the left, one solid accent-colour rectangle with slightly rounded corners, like a sticker, holding the support line in two or three short lines of dark type. Nothing else.",
  },
  {
    id: "side-column",
    name: "Side column",
    zones: [{ x: 0.5, y: 0.05, w: 0.46, h: 0.62 }],
    maxWords: 16,
    usesBottom: false,
    design:
      "No panel: a column of type on the right half over the calmest, darkest part of the photo: the headline very large and heavy in the accent colour over three short lines, the support line small in white under it, and a button label (only if the copy has one) in a solid rounded pill in a bright brand colour under that. A very soft shadow behind the words for legibility.",
  },
  {
    id: "dark-header",
    name: "Dark header",
    zones: [{ x: 0, y: 0, w: 1, h: 0.34 }],
    maxWords: 14,
    usesBottom: false,
    design:
      "A solid near-black or deep brand-colour block across the top 30–34%. Inside it, centred: the headline in a heavy sans-serif with its last line in the brand's main colour, then one short thin accent-colour rule under it. Any support line sits small under the rule. Below it the photo is untouched.",
  },
];

const BY_ID = new Map(PHOTO_OVERLAYS.map((o) => [o.id, o]));

export function overlayById(id: unknown): PhotoOverlay | null {
  return typeof id === "string" ? (BY_ID.get(id as OverlayId) ?? null) : null;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much of the faces a treatment would cover (0 = none). */
export function faceCover(overlay: PhotoOverlay, faces: Box[]): number {
  const area = faces.reduce((sum, f) => sum + f.w * f.h, 0);
  if (!area) return 0;
  const covered = faces.reduce(
    (sum, f) => sum + overlay.zones.reduce((s, z) => s + overlap(z, f), 0),
    0,
  );
  return Math.min(1, covered / area);
}

function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The treatment for one photo: one that covers no face, fits the words and
 * (for a video opening) leaves the bottom free for captions; picked by the
 * seed among those, avoiding the brand's last few. Null when there are no
 * words or every treatment would cover a face (the plain overlay rules apply).
 */
export function pickOverlay(args: {
  faces: Box[];
  words: number;
  seed: string;
  keepBottomClear?: boolean;
  recent?: (string | null | undefined)[];
}): PhotoOverlay | null {
  if (args.words <= 0) return null;
  const fits = PHOTO_OVERLAYS.filter(
    (o) =>
      faceCover(o, args.faces) === 0 &&
      o.maxWords >= args.words &&
      !(args.keepBottomClear && o.usesBottom),
  );
  if (!fits.length) return null;
  const recent = new Set((args.recent ?? []).filter(Boolean).slice(0, 2));
  const fresh = fits.filter((o) => !recent.has(o.id));
  const pool = fresh.length ? fresh : fits;
  return pool[hash(args.seed) % pool.length];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Lines for the design-layer prompt that build one treatment. */
export function overlayPromptLines(overlay: PhotoOverlay): string[] {
  const where = overlay.zones
    .map(
      (z) =>
        `from ${pct(z.x)} to ${pct(z.x + z.w)} across and ${pct(z.y)} to ${pct(z.y + z.h)} down`,
    )
    .join(", and ");
  return [
    `TREATMENT — "${overlay.name}": ${overlay.design}`,
    `Keep every word and shape of the design inside ${where}; everywhere else stays the flat key colour so the photo shows.`,
    "If the copy has a button label, set it as a small rounded pill inside the same area; never invent one.",
  ];
}
