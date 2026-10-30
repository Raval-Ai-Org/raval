// What a product hero poster will be, decided before anything is drawn
// (ADR-0040). Pure: the occasion, the staging, the colour mood, light and
// set, the product's formula and ingredients, and the exact words. Every
// choice is kept off what the brand's latest posters used (variety.ts), so
// no two posters look alike.
import { benefitLines, ingredientsOf, supportLine, textureOf } from "./copy";
import type { ProductHeroCopy } from "./prompt";
import { CROP_SAFE, pickStaging, stagingById, type Staging } from "./stagings";
import {
  occasionOf,
  pickTopic,
  pickVariety,
  rotateBenefits,
  type HeroLook,
  type Occasion,
  type Topic,
} from "./variety";

export type HeroProduct = {
  name: string;
  category?: string | null;
  description?: string | null;
  benefits?: readonly string[];
};

export type ProductHeroPlan = {
  staging: Staging;
  texture: string | null;
  ingredients: string[];
  occasion: Occasion | null;
  topic: Topic;
  copy: ProductHeroCopy;
  allowText: boolean;
  /** What is stored on the post; the concept writer adds its idea and words. */
  look: HeroLook;
};

export function planProductHero(args: {
  seed: string;
  brief: string;
  product: HeroProduct;
  /** The piece's own on-image line (the copy writer's headline), if any. */
  headline?: string | null;
  /** The brand's look allows no words on pictures (`maxWords: 0`). */
  noWords?: boolean;
  /** Latest stagings, newest first (from `meta.art_direction`). */
  recent?: readonly string[];
  /** The brand's latest product posters, newest first (from `meta.hero_look`). */
  recentLooks?: readonly Partial<HeroLook>[];
  /** The campaign the piece belongs to, read for its occasion. */
  context?: string | null;
  lean?: { liked: string[]; avoided: string[] } | null;
  /** An edit keeps the staging it had. */
  keepStaging?: string | null;
  /** The product runs off its photo's edge: only crop-safe stagings. */
  cropped?: boolean;
}): ProductHeroPlan {
  const texture = textureOf(args.product);
  const ingredients = ingredientsOf(args.product.description);
  const allBenefits = benefitLines(args.product.benefits ?? []);
  const headline = args.headline?.replace(/\s+/g, " ").trim() || null;
  const allowText = !args.noWords;
  const looks = args.recentLooks ?? [];
  const occasion = occasionOf([args.brief, args.context ?? ""].join(" "));
  const recent = [
    ...new Set([...(args.recent ?? []), ...looks.map((l) => l.staging).filter(Boolean)]),
  ] as string[];
  const topic = pickTopic({
    seed: args.seed,
    brief: args.brief,
    benefits: allowText ? allBenefits.length : 0,
    texture,
    ingredients,
    recent: looks,
  });
  const kept = stagingById(args.keepStaging);
  const staging =
    (kept && (!args.cropped || CROP_SAFE.includes(kept.id)) ? kept : null) ??
    pickStaging({
      seed: args.seed,
      brief: args.brief,
      texture,
      benefits: allowText ? allBenefits.length : 0,
      ingredients,
      hasText: allowText && !!headline,
      recent,
      lean: args.lean,
      preferred: occasion?.stagings ?? topic.stagings,
      cropped: args.cropped,
    });
  const benefits = rotateBenefits(allBenefits, looks, args.seed, 4);
  const variety = pickVariety({
    seed: args.seed,
    staging,
    brief: [args.brief, args.context ?? ""].join(" "),
    occasion,
    recent: looks,
  });
  const support = supportLine(args.product.description);
  return {
    staging,
    texture,
    ingredients,
    occasion,
    topic,
    allowText,
    copy: { headline, support, benefits },
    look: {
      staging: staging.id,
      ...variety,
      occasion: occasion?.id ?? null,
      topic: topic.id,
      headline,
      support,
      benefits: staging.id === "benefit-column" ? benefits : [],
    },
  };
}
