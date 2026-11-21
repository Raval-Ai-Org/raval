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
  "type-wall",
  "story-moment",
  "event-poster",
  "flat-lay",
  "offer-deal",
  "callouts",
  "mono-accent",
  // The brand's own design, learned from its website and its own posts
  // (the style bible, ADR-0048). Exclusive: it never mixes with a template.
  "custom",
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
  {
    id: "type-wall",
    label: "Word wall",
    line: "One word repeated, the hero in front",
    examples: ["/Home/wall/burger-1.webp", "/Home/wall/sunscreen-3.webp"],
    direction:
      "A type-pattern poster: one short brand word set huge and repeated or cropped across the whole background in the brand colour, the hero subject large and sharp in front of it, a small line and the logo. Bold, graphic, instantly recognisable.",
    medium: "typographic",
  },
  {
    id: "story-moment",
    label: "Story moment",
    line: "A cinematic scene with a twist",
    examples: ["/Home/wall/milk-1.webp", "/Home/wall/marketing-that-moves.webp"],
    direction:
      "A cinematic story frame: one real moment with a person or the product, shot like a film still, with one visual twist that tells the story (a shadow of who they become, a reflection, a before-and-after in one frame). Moody light, a short headline in a calm area.",
    medium: "photo",
  },
  {
    id: "event-poster",
    label: "Event & info",
    line: "Dates, times and one clear graphic",
    examples: ["/Home/wall/classes-3.webp", "/Home/wall/classes-1.webp"],
    direction:
      "An event or announcement poster: one bold graphic object in the brand colour as the hero, the event name huge, the exact dates, times and place set as clean labelled blocks on a strict grid. Only the details the brief gives, never invented ones.",
    medium: "typographic",
  },
  {
    id: "flat-lay",
    label: "Top-down flat lay",
    line: "Seen from above, neatly arranged",
    examples: ["/Home/wall/classes-6.webp", "/Home/wall/burger-1.webp"],
    direction:
      "A top-down flat lay: the product and the real things that go with it arranged neatly from directly above on a designed surface in the brand colours, soft even light, a headline in the open space. Tidy, tactile and real.",
    medium: "photo",
  },
  {
    id: "offer-deal",
    label: "Offer & deal",
    line: "The offer as the hero",
    examples: ["/Home/wall/finance-6.webp", "/Home/wall/burger-3.webp"],
    direction:
      "An offer post: the offer itself is the hero, set huge (or on a 3D tag, ticket or badge in the brand colour), one line on what you get and one clear next step. Only the offer the brief states, never an invented price, discount or deadline.",
    medium: "mixed",
  },
  {
    id: "callouts",
    label: "Callouts",
    line: "A hero with floating feature cards",
    examples: ["/Home/wall/see-the-product.webp", "/Home/wall/marketing-that-moves.webp"],
    direction:
      "A callout post: a person or the product as the hero, with small floating cards, labels or product cut-outs around it that point at features or benefits, thin connector lines, a short headline on top. Clean, modern and easy to scan.",
    medium: "mixed",
  },
  {
    id: "mono-accent",
    label: "Mono + one colour",
    line: "Black and white with one brand accent",
    examples: ["/Home/wall/build-2.webp", "/Home/wall/build-1.webp"],
    direction:
      "A monochrome post with one accent: a black-and-white photograph (architecture, product or person) with strong lines, and only the brand's accent colour on the headline and one graphic shape. Sharp, confident and high-end.",
    medium: "photo",
  },
  {
    id: "custom",
    label: "Custom: your own look",
    line: "Made in your website's own design",
    examples: [],
    direction:
      "The brand's own custom design, learned from its website and its own posts: make the picture in exactly that world (its medium, rendering, characters or mascots, objects, backdrops, type and layout), so it looks like it came from the brand's own site. Never swap it for a generic template style (no stock 3D render, no generic product shot) unless the brand's own design is that.",
    medium: "mixed",
  },
];

export const CUSTOM_STYLE: PictureStyleId = "custom";

/** The template styles a person can mix (everything but Custom), for the tile grids. */
export const TEMPLATE_STYLES: readonly PictureStyle[] = PICTURE_STYLES.filter(
  (s) => s.id !== CUSTOM_STYLE,
);

export const MAX_PICTURE_STYLES = 5;

/** How many styles Mox rotates through for a brand on auto. */
export const AUTO_POOL_SIZE = 6;

export function pictureStyleById(id: unknown): PictureStyle | null {
  return PICTURE_STYLES.find((s) => s.id === id) ?? null;
}

/** Known ids only, no repeats, at most three, in the order given. Custom stands alone. */
export function cleanStyleIds(ids: readonly unknown[] | null | undefined): PictureStyleId[] {
  const out: PictureStyleId[] = [];
  for (const id of ids ?? []) {
    const s = pictureStyleById(id);
    if (s && !out.includes(s.id)) out.push(s.id);
    if (out.length >= MAX_PICTURE_STYLES) break;
  }
  return out.includes(CUSTOM_STYLE) ? [CUSTOM_STYLE] : out;
}

/** Tap a style: on if off, off if on; a fourth replaces the oldest. Custom is exclusive. */
export function toggleStyle(
  current: readonly PictureStyleId[],
  id: PictureStyleId,
): PictureStyleId[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (id === CUSTOM_STYLE) return [CUSTOM_STYLE];
  const next = [...current.filter((x) => x !== CUSTOM_STYLE), id];
  return next.length > MAX_PICTURE_STYLES ? next.slice(next.length - MAX_PICTURE_STYLES) : next;
}

/** What a brand sells, in words, to pick styles from. */
type BrandFacts = { industry?: string | null; products?: string | null; brandName?: string | null };

const RULES: Array<{ match: RegExp; styles: PictureStyleId[] }> = [
  {
    match:
      /\b(app|saas|software|platform|fintech|bank|wallet|crypto|ai|tech|startup|digital|web|agency|marketing)\b/i,
    styles: ["app-showcase", "3d", "callouts", "clean-type", "offer-deal", "story-moment"],
  },
  {
    match:
      /\b(food|burger|pizza|restaurant|cafe|coffee|bakery|drink|juice|dairy|milk|snack|grill|kitchen|catering)\b/i,
    styles: ["product-hero", "type-wall", "big-idea", "flat-lay", "bold-poster", "story-moment"],
  },
  {
    match: /\b(beauty|skin|skincare|cosmetic|makeup|hair|salon|spa|fragrance|perfume|sunscreen)\b/i,
    styles: ["people", "product-hero", "type-wall", "colour-pop", "callouts", "flat-lay"],
  },
  {
    match: /\b(fashion|apparel|clothing|wear|shoes|jewel|jewelry|watch|luxury|boutique)\b/i,
    styles: ["people", "dark-premium", "editorial", "mono-accent", "callouts", "story-moment"],
  },
  {
    match:
      /\b(construction|real estate|property|architect|engineering|building|interior|furniture|home)\b/i,
    styles: ["bold-poster", "mono-accent", "editorial", "dark-premium", "big-idea", "callouts"],
  },
  {
    match: /\b(education|school|academy|course|class|tutor|ielts|training|coaching|university)\b/i,
    styles: ["3d", "event-poster", "bold-poster", "flat-lay", "clean-type", "story-moment"],
  },
  {
    match: /\b(health|clinic|medical|dental|pharma|fitness|gym|wellness|yoga)\b/i,
    styles: ["people", "clean-type", "product-hero", "story-moment", "callouts", "3d"],
  },
  {
    match: /\b(travel|hotel|tour|resort|airline|event|events|wedding)\b/i,
    styles: ["big-idea", "editorial", "people", "event-poster", "story-moment", "mono-accent"],
  },
  {
    match: /\b(kids|toy|toys|pet|pets|game|gaming|sport|sports)\b/i,
    styles: ["colour-pop", "illustrated", "big-idea", "3d", "type-wall", "story-moment"],
  },
  {
    match: /\b(finance|insurance|legal|law|consult|consulting|accounting|b2b)\b/i,
    styles: ["clean-type", "dark-premium", "3d", "callouts", "offer-deal", "mono-accent"],
  },
];

const FALLBACK: PictureStyleId[] = [
  "bold-poster",
  "product-hero",
  "clean-type",
  "big-idea",
  "callouts",
  "story-moment",
];

/** Mox's pool: the styles that suit what the brand sells, best first. Deterministic. */
export function autoPictureStyles(facts: BrandFacts): PictureStyleId[] {
  const text = [facts.industry, facts.products, facts.brandName].filter(Boolean).join(" ");
  const hit = text ? RULES.find((r) => r.match.test(text)) : undefined;
  return [...(hit?.styles ?? FALLBACK)].slice(0, AUTO_POOL_SIZE);
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
 * On auto, a brand with its own learned design (`ownDesign`: a style bible
 * from its website or posts) gets Custom only: a template style would pull
 * an anime, retro or space-themed brand back to generic posts.
 */
export function effectiveStyles(
  visual: { styles?: readonly unknown[] | null; stylesAuto?: boolean | null } | null | undefined,
  facts: BrandFacts,
  opts: { ownDesign?: boolean } = {},
): { ids: PictureStyleId[]; auto: boolean } {
  const own = cleanStyleIds(visual?.styles);
  if (own.length && visual?.stylesAuto !== true) return { ids: own, auto: false };
  if (opts.ownDesign) return { ids: [CUSTOM_STYLE], auto: true };
  return { ids: autoPictureStyles(facts), auto: true };
}

/** Is this the brand's own design rather than a template style? */
export function isCustomStyles(ids: readonly PictureStyleId[] | null | undefined): boolean {
  return !!ids?.length && ids[0] === CUSTOM_STYLE;
}

/**
 * Prompt lines: the styles in full, the image model picks the one this post
 * needs. Custom carries the brand's own design in words (`ownDesign`, from
 * the style bible) when there is one.
 */
export function pictureStyleLines(
  ids: readonly PictureStyleId[],
  ownDesign?: string | null,
): string {
  const styles = ids.map(pictureStyleById).filter((s): s is PictureStyle => !!s);
  if (!styles.length) return "";
  if (isCustomStyles(ids)) {
    const own = ownDesign?.trim();
    return own
      ? `Picture style: the brand's own custom design. ${styles[0].direction}\nThe brand's own design: ${own.slice(0, 700)}`
      : `Picture style: the brand's own custom design. ${styles[0].direction} With nothing learned yet, follow the brand's colours, fonts and saved Inspo references.`;
  }
  if (styles.length === 1) return `Picture style: ${styles[0].label}. ${styles[0].direction}`;
  return [
    "Picture styles this brand uses (make this picture in the ONE that suits this post best; never a plain stock photo):",
    ...styles.map((s) => `- ${s.label}: ${s.direction}`),
  ].join("\n");
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Pick one of the brand's styles for one piece, rotating by seed and skipping
 * the ones used lately (`recent`, newest first: a string or a list). With a
 * pool of n styles the last n-1 are skipped, so a run of posts walks the
 * whole pool before a style comes back.
 */
export function styleForPiece(
  ids: readonly PictureStyleId[],
  seed: string,
  recent?: string | readonly (string | null | undefined)[] | null,
): PictureStyleId | null {
  if (!ids.length) return null;
  const used = (typeof recent === "string" ? [recent] : (recent ?? [])).filter(
    (x): x is string => !!x,
  );
  let pool = [...ids];
  for (let keep = ids.length - 1; keep >= 1; keep--) {
    const skip = new Set(used.slice(0, keep));
    const left = ids.filter((id) => !skip.has(id));
    if (left.length) {
      pool = left;
      break;
    }
  }
  return pool[hash(seed) % pool.length] ?? null;
}

/**
 * The styles one piece is told about. A brand on auto gets ONE style for the
 * piece, chosen from Mox's pool and away from the latest posts, so posts move
 * through many looks instead of the same three. A brand that picked its own
 * styles keeps them all and the model picks the one that suits.
 */
export function stylesForPiece(
  styles: { ids: readonly PictureStyleId[]; auto: boolean } | null | undefined,
  seed: string,
  recent: readonly (string | null | undefined)[] = [],
): { ids: PictureStyleId[]; auto: boolean; picked: PictureStyleId | null } | null {
  if (!styles?.ids.length) return null;
  if (!styles.auto || isCustomStyles(styles.ids)) {
    return { ids: [...styles.ids], auto: styles.auto, picked: null };
  }
  const picked = styleForPiece(styles.ids, seed, recent);
  return { ids: picked ? [picked] : [...styles.ids], auto: true, picked };
}
