// What makes each product poster its own (ADR-0040). Pure.
//
// The brand's look stays the same post after post: its colours (a light tint
// of the pack's own colour), its type and finish, so the feed reads as one
// brand. What changes is the topic (what this poster is about: one benefit,
// the texture, the ingredients, the moment of use...), the staging, the light
// and the set, each kept off what the latest posters used, plus the occasion
// the brief or campaign names. A colour mood other than the brand's own is
// used only when the brief asks for it. Ids are stored on posts
// (`meta.hero_look`): add, never rename.
import { hash } from "../art-direction";
import type { Staging, StagingId } from "./stagings";

/* ───────────── colour moods ───────────── */

export const PALETTE_MOODS = ["tint", "deep", "accent-world", "duo", "noir"] as const;
export type PaletteMood = (typeof PALETTE_MOODS)[number];

/** Brief words that ask for a colour mood. */
const MOOD_ASKS: Record<PaletteMood, RegExp> = {
  tint: /\b(?:soft|light|pastel|clean|fresh|airy|minimal)\b/i,
  deep: /\b(?:rich|deep|bold|saturated|vivid)\b/i,
  "accent-world": /\b(?:pop|contrast|colou?rful|playful|fun)\b/i,
  duo: /\b(?:gradient|two.?tone|duo)\b/i,
  noir: /\b(?:dark|night|evening|luxur\w*|premium|moody|black)\b/i,
};

/* ───────────── light moods ───────────── */

export type LightMood = {
  id: string;
  text: string;
  asks?: RegExp;
  /** Only when the brief or occasion asks: it would change the brand's look. */
  askOnly?: boolean;
};

export const LIGHT_MOODS: readonly LightMood[] = [
  {
    id: "soft-daylight",
    text: "soft, even daylight from a large window to one side, gentle shadows",
    asks: /\b(?:morning|daily|everyday|natural)\b/i,
  },
  {
    id: "golden-hour",
    text: "warm low golden-hour sun from the side, long soft shadows, a warm rim on the product",
    asks: /\b(?:warm|summer|sunset|cosy|cozy|golden)\b/i,
  },
  {
    id: "high-key",
    text: "crisp bright high-key studio light, almost no shadow, glossy specular highlights",
    asks: /\b(?:clean|bright|clinical|fresh)\b/i,
  },
  {
    id: "spotlight",
    text: "one focused spotlight from above in a darker surround, deep falloff, a bright pool under the product",
    askOnly: true,
    asks: /\b(?:launch|reveal|new|dramatic|night)\b/i,
  },
  {
    id: "backlit",
    text: "strong backlight through the product with a glowing rim and a little soft haze in the air",
    asks: /\b(?:glow|radiant|dreamy)\b/i,
  },
  {
    id: "window-shadows",
    text: "hard sunlight through a window, casting crisp geometric window-frame shadows across the set and the product",
    asks: /\b(?:sun|sunny|weekend|slow)\b/i,
  },
];

/* ───────────── sets per staging ───────────── */

export type HeroSet = { id: string; text: string };

/** Surfaces and set builds that fit each staging; one is picked per poster. */
export const SETS: Record<StagingId, readonly HeroSet[]> = {
  "glow-sweep": [
    { id: "paper-sweep", text: "a seamless matte paper sweep" },
    { id: "acrylic-floor", text: "a glossy acrylic floor with a mirror reflection of the product" },
    { id: "satin-sweep", text: "a sweep of soft satin fabric with gentle folds" },
    { id: "still-water", text: "a perfectly still water surface with a soft reflection" },
  ],
  "texture-burst": [
    { id: "pool", text: "a glossy pool of the formula spreading on the surface" },
    { id: "crown-splash", text: "a crown-shaped splash rising around the base" },
    { id: "ribbon-swirl", text: "a single smooth ribbon of the formula wrapping the product" },
  ],
  "benefit-column": [
    { id: "glass-ledge", text: "a thin clear glass ledge with a few droplets" },
    { id: "stone-ledge", text: "a smooth pale stone ledge" },
    { id: "acrylic-block", text: "a tinted translucent acrylic block" },
  ],
  "macro-crop": [
    { id: "mirror", text: "a mirror-like surface reflecting the pack" },
    { id: "wet-sheen", text: "a wet glossy surface with fine beads of water" },
    { id: "paper", text: "a smooth matte paper surface with a crisp shadow" },
  ],
  "wet-glass": [
    { id: "droplet-shelf", text: "a clear glass shelf covered in fresh droplets" },
    { id: "frosted-shelf", text: "a frosted glass shelf with condensation trails" },
    { id: "rippled-glass", text: "a rippled glass shelf with water running off its edge" },
  ],
  "podium-stack": [
    { id: "matte-podiums", text: "matte painted round podiums" },
    { id: "stone-podiums", text: "smooth stone podiums with fine grain" },
    { id: "glossy-podiums", text: "glossy lacquered podiums with soft reflections" },
    { id: "steps", text: "a short flight of wide, shallow steps" },
  ],
  floating: [
    { id: "droplet-orbit", text: "small droplets of its formula floating around it" },
    {
      id: "soft-shapes",
      text: "two or three soft spheres in tints of its colour floating near it",
    },
    { id: "clean-air", text: "nothing but clean air and a soft shadow far below" },
  ],
  "shadow-play": [
    { id: "plinth", text: "a single low plinth" },
    { id: "floor", text: "a plain studio floor meeting a wall" },
    { id: "arch", text: "a plain arch cut into the back wall" },
  ],
  "colour-split": [
    { id: "vertical", text: "two colour blocks split vertically" },
    { id: "horizon", text: "two colour blocks split horizontally like a horizon" },
    { id: "diagonal", text: "two colour blocks split on a diagonal" },
  ],
  "type-wall": [
    { id: "flat-wall", text: "a flat painted wall" },
    { id: "curved-wall", text: "a gently curved wall" },
  ],
  "ingredient-world": [
    { id: "arranged", text: "the ingredients arranged neatly around the base" },
    { id: "falling", text: "the ingredients caught falling around the product" },
    { id: "bed", text: "the product resting on a bed of the ingredients" },
  ],
};

/* ───────────── topics ───────────── */

export type TopicId =
  | "one-benefit"
  | "texture"
  | "ingredients"
  | "the-problem"
  | "moment-of-use"
  | "who-its-for"
  | "the-product"
  | "all-benefits";

export type Topic = {
  id: TopicId;
  /** What the poster is about, for the writer. */
  direction: string;
  needs?: { benefits?: number; texture?: boolean; ingredients?: boolean };
  /** Stagings that show this topic best. */
  stagings: StagingId[];
  asks?: RegExp;
};

export const TOPICS: readonly Topic[] = [
  {
    id: "one-benefit",
    direction:
      "one single benefit from the product's own list, made the whole message; the headline says it in fresh words",
    needs: { benefits: 1 },
    stagings: ["macro-crop", "floating", "type-wall", "colour-split"],
    asks: /\b(?:benefit|result|does|works)\w*/i,
  },
  {
    id: "all-benefits",
    direction: "what the product does, shown as a short list of its own benefits",
    needs: { benefits: 3 },
    stagings: ["benefit-column"],
    asks: /\b(?:benefits|why|features|reasons)\b/i,
  },
  {
    id: "texture",
    direction: "how it looks and feels: its own formula, made irresistible",
    needs: { texture: true },
    stagings: ["texture-burst", "macro-crop"],
    asks: /\b(?:texture|feel|formula|gel|cream|foam|smell)\w*/i,
  },
  {
    id: "ingredients",
    direction: "what is inside: the ingredients its facts name and why they matter",
    needs: { ingredients: true },
    stagings: ["ingredient-world"],
    asks: /\b(?:ingredients?|inside|made with|natural)\b/i,
  },
  {
    id: "the-problem",
    direction:
      "the everyday problem its buyer has, named plainly, and this product as the calm answer",
    stagings: ["colour-split", "shadow-play", "macro-crop"],
    asks: /\b(?:problem|struggle|tired of|fix|solve|help)\w*/i,
  },
  {
    id: "moment-of-use",
    direction:
      "the moment and ritual it belongs to (when and how it is used), without showing people",
    stagings: ["wet-glass", "shadow-play", "glow-sweep"],
    asks: /\b(?:routine|ritual|morning|night|how to|use it|step)\w*/i,
  },
  {
    id: "who-its-for",
    direction: "who it is made for, so the right reader feels it was made for them",
    stagings: ["podium-stack", "glow-sweep", "type-wall"],
    asks: /\b(?:for you|made for|if you|perfect for|skin type)\b/i,
  },
  {
    id: "the-product",
    direction: "the product itself, by name: a confident introduction or reminder",
    stagings: ["glow-sweep", "floating", "podium-stack"],
    asks: /\b(?:meet|new|launch|introduc|hero|bestsell)\w*/i,
  },
];

export function topicById(id: unknown): Topic | null {
  return TOPICS.find((t) => t.id === id) ?? null;
}

/**
 * This poster's topic: one the brief asks for wins, then a fresh one (off
 * the latest three), only from what the product's facts can support.
 */
export function pickTopic(input: {
  seed: string;
  brief: string;
  benefits: number;
  texture: string | null;
  ingredients: readonly string[];
  recent: readonly Partial<HeroLook>[];
}): Topic {
  const fits = TOPICS.filter(
    (t) =>
      (t.needs?.benefits ?? 0) <= input.benefits &&
      (!t.needs?.texture || !!input.texture) &&
      (!t.needs?.ingredients || input.ingredients.length > 0),
  );
  const asked = fits.find((t) => t.asks?.test(input.brief));
  if (asked) return asked;
  const used = new Set(input.recent.slice(0, 3).map((r) => r.topic));
  const fresh = fits.filter((t) => !used.has(t.id));
  const pool = fresh.length ? fresh : fits;
  return pool[hash(`topic:${input.seed}`) % pool.length];
}

/* ───────────── occasions ───────────── */

export type Occasion = {
  id: string;
  asks: RegExp;
  /** The feeling of the poster. */
  mood: string;
  /** The only extra touches the scene may add for it. */
  touches: string;
  stagings?: StagingId[];
  light?: string;
};

export const OCCASIONS: readonly Occasion[] = [
  {
    id: "launch",
    asks: /\b(?:launch\w*|new arrival|just dropped|introduc\w+|meet the|coming soon|reveal)\b/i,
    mood: "a reveal: anticipation and a sense of a first look",
    touches: "a beam of light, a few star glints",
    stagings: ["glow-sweep", "floating", "type-wall"],
    light: "spotlight",
  },
  {
    id: "sale",
    asks: /\b(?:sale|discount|\d+\s?% off|offer|deal|black friday|cyber monday|clearance|promo)\b/i,
    mood: "energetic and confident, made to stop the scroll",
    touches: "bold colour blocks, nothing else",
    stagings: ["colour-split", "podium-stack", "type-wall"],
  },
  {
    id: "eid",
    asks: /\b(?:eid|ramadan|iftar)\b/i,
    mood: "calm, warm and celebratory",
    touches: "a warm lantern glow and a soft crescent of light in the background",
    stagings: ["glow-sweep", "podium-stack"],
  },
  {
    id: "diwali",
    asks: /\bdiwali\b/i,
    mood: "warm and joyful",
    touches: "small warm points of golden light, softly out of focus",
    stagings: ["glow-sweep", "podium-stack"],
  },
  {
    id: "love",
    asks: /\b(?:valentine\w*|mother'?s day|self.?love|for her|for him)\b/i,
    mood: "tender and warm",
    touches: "a few soft petals and one satin ribbon",
    stagings: ["glow-sweep", "floating"],
    light: "backlit",
  },
  {
    id: "gift",
    asks: /\b(?:gift\w*|present|christmas|holiday season|festive|new year)\b/i,
    mood: "warm and festive",
    touches: "a few soft out-of-focus warm lights and one satin ribbon in the accent colour",
    stagings: ["podium-stack", "glow-sweep"],
    light: "golden-hour",
  },
  {
    id: "summer",
    asks: /\b(?:summer|beach|heat|hot days|sun ?care|spf)\b/i,
    mood: "bright, fresh and sunny",
    touches: "clear water, hard sun shadows",
    stagings: ["wet-glass", "shadow-play", "texture-burst"],
    light: "window-shadows",
  },
  {
    id: "winter",
    asks: /\b(?:winter|cold weather|dry air|snow|frost\w*)\b/i,
    mood: "cosy and protective",
    touches: "a light frost on the surface and a few soft snow flecks",
    stagings: ["glow-sweep", "macro-crop"],
    light: "soft-daylight",
  },
  {
    id: "night",
    asks: /\b(?:night ?time|overnight|evening routine|before bed|pm routine)\b/i,
    mood: "calm and quiet, the end of the day",
    touches: "a soft moon-like glow",
    light: "spotlight",
  },
  {
    id: "routine",
    asks: /\b(?:routine|how to use|step by step|daily|morning)\b/i,
    mood: "simple and helpful, an everyday ritual",
    touches: "nothing extra",
    stagings: ["benefit-column", "wet-glass"],
    light: "soft-daylight",
  },
];

export function occasionOf(text: string): Occasion | null {
  return OCCASIONS.find((o) => o.asks.test(text)) ?? null;
}

/* ───────────── what a poster used ───────────── */

/** Stored on the post (`meta.hero_look`) so the next poster differs. */
export type HeroLook = {
  staging: StagingId;
  /** What the poster is about; the brand's look stays the same. */
  topic?: TopicId | null;
  palette: PaletteMood;
  light: string;
  set: string;
  occasion?: string | null;
  /** This poster's own scene idea, written by the concept writer. */
  concept?: string | null;
  headline?: string | null;
  support?: string | null;
  benefits?: string[];
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A stored look, read defensively from user-editable `meta`. */
export function readHeroLook(raw: unknown): Partial<HeroLook> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const palette = PALETTE_MOODS.find((m) => m === r.palette);
  return {
    staging: (str(r.staging) ?? undefined) as StagingId | undefined,
    palette,
    light: str(r.light) ?? undefined,
    set: str(r.set) ?? undefined,
    occasion: str(r.occasion),
    topic: topicById(r.topic)?.id ?? null,
    concept: str(r.concept)?.slice(0, 400) ?? null,
    headline: str(r.headline)?.slice(0, 120) ?? null,
    benefits: Array.isArray(r.benefits)
      ? r.benefits.filter((b): b is string => typeof b === "string").slice(0, 6)
      : [],
  };
}

/**
 * The first option not used by the latest `keepOff` posters; one the brief
 * asks for wins, an occasion's preference next, then the seed.
 */
function pickFresh<T extends string>(
  options: readonly T[],
  used: readonly (T | null | undefined)[],
  seed: string,
  opts: { asked?: T | null; preferred?: T | null; keepOff?: number } = {},
): T {
  const recent = new Set(used.slice(0, opts.keepOff ?? 2).filter(Boolean) as T[]);
  const fresh = options.filter((o) => !recent.has(o));
  const pool = fresh.length ? fresh : options;
  if (opts.asked && options.includes(opts.asked)) return opts.asked;
  if (opts.preferred && pool.includes(opts.preferred)) return opts.preferred;
  return pool[hash(seed) % pool.length];
}

export type VarietyInput = {
  seed: string;
  staging: Staging;
  /** The brief plus the campaign's name, for what the poster asks for. */
  brief: string;
  occasion: Occasion | null;
  /** The brand's own colour mood (default: a light tint of the pack's colour). */
  home?: PaletteMood;
  /** The brand's latest product posters, newest first. */
  recent: readonly Partial<HeroLook>[];
};

/** The colour mood, light and set for this poster. */
export function pickVariety(input: VarietyInput): Pick<HeroLook, "palette" | "light" | "set"> {
  const askedMood = PALETTE_MOODS.find((m) => MOOD_ASKS[m].test(input.brief)) ?? null;
  // The brand's colours stay put; only a brief that asks changes the mood.
  const palette = askedMood ?? input.home ?? "tint";
  const askedLight = LIGHT_MOODS.find((l) => l.asks?.test(input.brief))?.id ?? null;
  const wanted = input.occasion?.light ?? askedLight;
  const lightIds = LIGHT_MOODS.filter((l) => !l.askOnly || l.id === wanted).map((l) => l.id);
  const light = pickFresh(
    lightIds,
    input.recent.map((r) => r.light),
    `light:${input.seed}`,
    {
      preferred: wanted,
      keepOff: 3,
    },
  );
  const sets = SETS[input.staging.id].map((s) => s.id);
  const set = pickFresh(
    sets,
    input.recent.filter((r) => r.staging === input.staging.id).map((r) => r.set),
    `set:${input.seed}`,
    { keepOff: 1 },
  );
  return { palette, light, set };
}

export function lightById(id: string | null | undefined): LightMood | null {
  return LIGHT_MOODS.find((l) => l.id === id) ?? null;
}

export function setById(staging: StagingId, id: string | null | undefined): HeroSet | null {
  return SETS[staging]?.find((s) => s.id === id) ?? null;
}

/**
 * Up to `n` benefits for this poster: the ones the latest posters showed
 * least go first, so a product's posters move through everything it does.
 */
export function rotateBenefits(
  all: readonly string[],
  recent: readonly Partial<HeroLook>[],
  seed: string,
  n = 3,
): string[] {
  if (all.length <= n) return [...all];
  const shown = (b: string) =>
    recent.slice(0, 4).reduce((count, r, i) => count + (r.benefits?.includes(b) ? 4 - i : 0), 0);
  return [...all]
    .map((b) => ({ b, score: shown(b), tie: hash(`${seed}:${b}`) }))
    .sort((x, y) => x.score - y.score || x.tie - y.tie)
    .slice(0, n)
    .map((x) => x.b)
    .sort((x, y) => all.indexOf(x) - all.indexOf(y));
}
