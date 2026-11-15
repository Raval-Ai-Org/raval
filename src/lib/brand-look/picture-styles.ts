// picture-styles.ts — the kinds of picture a brand's posts are made in.
//
// Pure and browser-safe. A brand keeps up to three styles on its look
// (`dna.look.visual.styles`), picked in onboarding or Inspo → Post look, or
// leaves it to Mox (`stylesAuto`, the default), which picks three from what
// the brand sells (`autoPictureStyles`). Every picture prompt names the
// brand's styles with their full direction (`pictureStyleLines`), so the
// image model is told "a bold type-led poster with one hero", not "photo".
//
// Ids are stored on looks: add, never rename. Previews are real posts Mellox
// made (public/Home/wall), never stock art.

export const PICTURE_STYLE_IDS = [
  "bold-poster",
  "product-hero",
  "big-idea",
  "3d",
  "people",
  "illustrated",
  "app-showcase",
  "clean-type",
  "colour-pop",
  "dark-premium",
  "editorial",
] as const;

export type PictureStyleId = (typeof PICTURE_STYLE_IDS)[number];

export type PictureStyle = {
  id: PictureStyleId;
  label: string;
  /** One line under the tile. */
  line: string;
  /** Real Mellox posts in this style, first one is the tile's cover. */
  examples: readonly string[];
  /** What the image model is told, in full. */
  direction: string;
  /** The old one-word medium it maps to, for code that still reads `medium`. */
  medium: "photo" | "illustration" | "3d" | "flat" | "collage" | "typographic" | "mixed";
};

export const PICTURE_STYLES: readonly PictureStyle[] = [
  {
    id: "bold-poster",
    label: "Bold poster",
    line: "Huge headline, one hero",
    examples: ["/Home/wall/build-1.webp", "/Home/wall/burger-3.webp", "/Home/wall/build-6.webp"],
    direction:
      "A designed poster: a huge condensed headline in the brand colours fills a third of the frame, one hero subject cut out large in front of or behind it, a small supporting line and the logo. Strong contrast, deliberate grid, nothing else competing.",
    medium: "typographic",
  },
  {
    id: "product-hero",
    label: "Product hero",
    line: "Your product, lit like a campaign",
    examples: [
      "/Home/wall/burger-2.webp",
      "/Home/wall/sunscreen-5.webp",
      "/Home/wall/burger-6.webp",
    ],
    direction:
      "A campaign product shot: the product (or the thing the brand offers) large and true to life, staged on a designed set in the brand colours, crisp studio light with a soft shadow, a short headline in a calm area. Looks art-directed, never a catalogue cut-out.",
    medium: "photo",
  },
  {
    id: "big-idea",
    label: "Big idea",
    line: "A surprise of scale or place",
    examples: ["/Home/wall/burger-4.webp", "/Home/wall/burger-5.webp", "/Home/wall/finance-3.webp"],
    direction:
      "One surreal, scroll-stopping idea: the hero subject at a surprising scale, in an unexpected place or made of an unexpected material, photographed for real. One idea only, explained by a short headline.",
    medium: "photo",
  },
  {
    id: "3d",
    label: "3D render",
    line: "Glossy objects, dramatic light",
    examples: [
      "/Home/wall/classes-2.webp",
      "/Home/wall/finance-1.webp",
      "/Home/wall/classes-4.webp",
    ],
    direction:
      "A polished 3D render: one glossy hero object (chrome, glass, soft plastic or the product itself) floating or standing on a clean backdrop, dramatic rim light, the brand colour glowing in the object or the set, a short headline set crisply.",
    medium: "3d",
  },
  {
    id: "people",
    label: "People with it",
    line: "A real person, a designed post",
    examples: [
      "/Home/wall/sunscreen-2.webp",
      "/Home/wall/milk-4.webp",
      "/Home/wall/sunscreen-1.webp",
    ],
    direction:
      "A designed campaign post with a person: one confident, natural person using or holding what the brand offers, shot like a fashion campaign on a bold brand-colour backdrop, a big headline beside them. Never a stock-photo pose, never a real or famous person.",
    medium: "photo",
  },
  {
    id: "illustrated",
    label: "Illustrated",
    line: "Characters and bright shapes",
    examples: ["/Home/wall/wallet-2.webp", "/Home/wall/wallet-4.webp"],
    direction:
      "A modern flat illustration: friendly, stylised characters and simple shapes in the brand colours, clean vector edges, soft gradients at most, a clear headline in the brand font. Feels like a fintech or app campaign, never clip art.",
    medium: "illustration",
  },
  {
    id: "app-showcase",
    label: "App & website",
    line: "Your screens in a real device",
    examples: ["/Home/wall/wallet-1.webp", "/Home/wall/wallet-3.webp"],
    direction:
      "A product showcase for software or a website: a phone or laptop showing the brand's own screen, tilted in a designed scene with floating cards that call out one feature, the brand colour as the background and a short benefit headline.",
    medium: "mixed",
  },
  {
    id: "clean-type",
    label: "Clean & minimal",
    line: "Lots of space, sharp type",
    examples: ["/Home/wall/finance-2.webp", "/Home/wall/reel-4.webp", "/Home/wall/finance-5.webp"],
    direction:
      "A calm, minimal post: generous empty space, one sharp headline set beautifully in the brand font, one small object or icon as the accent, a plain or softly graded brand-colour background. Confident and quiet.",
    medium: "typographic",
  },
  {
    id: "colour-pop",
    label: "Colour pop",
    line: "Loud brand colour, big energy",
    examples: ["/Home/wall/milk-2.webp", "/Home/wall/milk-3.webp", "/Home/wall/sunscreen-4.webp"],
    direction:
      "A loud, high-energy brand post: the whole frame flooded with the brand's strongest colour, a hand-lettered or chunky headline, the product and a person or mascot mid-action, small doodles or speed lines for energy.",
    medium: "mixed",
  },
  {
    id: "dark-premium",
    label: "Dark & premium",
    line: "Moody, rich, high-end",
    examples: ["/Home/wall/finance-4.webp", "/Home/wall/build-3.webp", "/Home/wall/classes-5.webp"],
    direction:
      "A dark, premium look: a near-black or deep brand-colour backdrop, one hero lit by a single strong light with a glow in the brand accent colour, fine elegant type, lots of shadow. Feels expensive and calm.",
    medium: "mixed",
  },
  {
    id: "editorial",
    label: "Editorial collage",
    line: "Cut-outs, layers, magazine feel",
    examples: ["/Home/wall/build-4.webp", "/Home/wall/build-5.webp", "/Home/wall/classes-1.webp"],
    direction:
      "An editorial collage: cut-out photos layered with bold shapes and big outlined or condensed type, a magazine grid, small labels and arrows, one accent colour. Busy on purpose but with one clear reading order.",
    medium: "collage",
  },
];

export const MAX_PICTURE_STYLES = 3;

export function pictureStyleById(id: unknown): PictureStyle | null {
  return PICTURE_STYLES.find((s) => s.id === id) ?? null;
}

/** Known ids only, no repeats, at most three, in the order given. */
export function cleanStyleIds(ids: readonly unknown[] | null | undefined): PictureStyleId[] {
  const out: PictureStyleId[] = [];
  for (const id of ids ?? []) {
    const s = pictureStyleById(id);
    if (s && !out.includes(s.id)) out.push(s.id);
    if (out.length >= MAX_PICTURE_STYLES) break;
  }
  return out;
}

/** Tap a style: on if off, off if on; a fourth replaces the oldest. */
export function toggleStyle(
  current: readonly PictureStyleId[],
  id: PictureStyleId,
): PictureStyleId[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  const next = [...current, id];
  return next.length > MAX_PICTURE_STYLES ? next.slice(next.length - MAX_PICTURE_STYLES) : next;
}

/** What a brand sells, in words, to pick styles from. */
type BrandFacts = { industry?: string | null; products?: string | null; brandName?: string | null };

const RULES: Array<{ match: RegExp; styles: PictureStyleId[] }> = [
  {
    match:
      /\b(app|saas|software|platform|fintech|bank|wallet|crypto|ai|tech|startup|digital|web|agency|marketing)\b/i,
    styles: ["app-showcase", "3d", "clean-type"],
  },
  {
    match:
      /\b(food|burger|pizza|restaurant|cafe|coffee|bakery|drink|juice|dairy|milk|snack|grill|kitchen|catering)\b/i,
    styles: ["product-hero", "big-idea", "bold-poster"],
  },
  {
    match: /\b(beauty|skin|skincare|cosmetic|makeup|hair|salon|spa|fragrance|perfume|sunscreen)\b/i,
    styles: ["people", "product-hero", "colour-pop"],
  },
  {
    match: /\b(fashion|apparel|clothing|wear|shoes|jewel|jewelry|watch|luxury|boutique)\b/i,
    styles: ["people", "dark-premium", "editorial"],
  },
  {
    match:
      /\b(construction|real estate|property|architect|engineering|building|interior|furniture|home)\b/i,
    styles: ["bold-poster", "editorial", "dark-premium"],
  },
  {
    match: /\b(education|school|academy|course|class|tutor|ielts|training|coaching|university)\b/i,
    styles: ["3d", "bold-poster", "clean-type"],
  },
  {
    match: /\b(health|clinic|medical|dental|pharma|fitness|gym|wellness|yoga)\b/i,
    styles: ["people", "clean-type", "product-hero"],
  },
  {
    match: /\b(travel|hotel|tour|resort|airline|event|events|wedding)\b/i,
    styles: ["big-idea", "editorial", "people"],
  },
  {
    match: /\b(kids|toy|toys|pet|pets|game|gaming|sport|sports)\b/i,
    styles: ["colour-pop", "illustrated", "big-idea"],
  },
  {
    match: /\b(finance|insurance|legal|law|consult|consulting|accounting|b2b)\b/i,
    styles: ["clean-type", "dark-premium", "3d"],
  },
];

const FALLBACK: PictureStyleId[] = ["bold-poster", "product-hero", "clean-type"];

/** Mox's pick: three styles that suit what the brand sells. Deterministic. */
export function autoPictureStyles(facts: BrandFacts): PictureStyleId[] {
  const text = [facts.industry, facts.products, facts.brandName].filter(Boolean).join(" ");
  const hit = text ? RULES.find((r) => r.match.test(text)) : undefined;
  return [...(hit?.styles ?? FALLBACK)];
}

/** The old one-word medium a style list implies (first style wins). */
export function mediumForStyles(
  ids: readonly PictureStyleId[],
): PictureStyle["medium"] | undefined {
  return ids.length ? pictureStyleById(ids[0])?.medium : undefined;
}

/**
 * The styles a brand's pictures follow: its own picks, else Mox's (auto is
 * the default, so a brand that never chose still gets three real styles).
 */
export function effectiveStyles(
  visual: { styles?: readonly unknown[] | null; stylesAuto?: boolean | null } | null | undefined,
  facts: BrandFacts,
): { ids: PictureStyleId[]; auto: boolean } {
  const own = cleanStyleIds(visual?.styles);
  if (own.length && visual?.stylesAuto !== true) return { ids: own, auto: false };
  return { ids: autoPictureStyles(facts), auto: true };
}

/** Prompt lines: the styles in full, the image model picks the one this post needs. */
export function pictureStyleLines(ids: readonly PictureStyleId[]): string {
  const styles = ids.map(pictureStyleById).filter((s): s is PictureStyle => !!s);
  if (!styles.length) return "";
  if (styles.length === 1) return `Picture style: ${styles[0].label}. ${styles[0].direction}`;
  return [
    "Picture styles this brand uses (make this picture in the ONE that suits this post best; never a plain stock photo):",
    ...styles.map((s) => `- ${s.label}: ${s.direction}`),
  ].join("\n");
}

/** Pick one of the brand's styles for one piece, rotating by seed and skipping the last used. */
export function styleForPiece(
  ids: readonly PictureStyleId[],
  seed: string,
  lastUsed?: string | null,
): PictureStyleId | null {
  if (!ids.length) return null;
  const pool = ids.length > 1 ? ids.filter((id) => id !== lastUsed) : [...ids];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return pool[(h >>> 0) % pool.length] ?? null;
}
