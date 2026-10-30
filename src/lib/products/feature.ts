// Which catalogue product a piece is about, and how its real photo is used
// (ADR-0035). Pure: the same brief and catalogue always give the same answer,
// in the browser (to show the pick and its price) and on the server.
//
// - A product the brief names is always used.
// - A brief that is about selling but names nothing ("our new drop", a launch,
//   an offer) features the product shown least recently, so a run of posts
//   moves through the catalogue instead of repeating one item. Only callers
//   that act without a person (Autopilot, Slack) ask for this.
// - The photo is the product's own, never redrawn: a single picture is
//   designed around it, a carousel places it on its slides, a Story or a
//   video starts from it.
import { looseText } from "./catalog";

export type FeatureCandidate = {
  id: string;
  name: string;
  kind: "product" | "service";
  hasPhoto: boolean;
  /** Catalogue order; a higher position was added later. */
  position: number;
};

export type FeaturePick = { id: string; reason: "named" | "rotation" };

/** Words that say nothing about which product it is. */
const GENERIC = new Set(
  (
    "the and for with from our your new set kit pack box bundle size small medium large mini " +
    "edition original classic premium plus pro max one two three ml oz gram grams kg lb " +
    "product products item service services package plan bottle jar tube bag piece pieces"
  ).split(" "),
);

const tokens = (name: string) =>
  looseText(name)
    .trim()
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));

/**
 * The product the brief names, or null. The whole name wins; otherwise the
 * words only this product has (a brand name shared by every item counts for
 * nothing). Two products matching equally well means neither.
 */
export function namedProduct<T extends FeatureCandidate>(text: string, products: T[]): T | null {
  const hay = looseText(text);
  if (hay.trim().length < 3 || !products.length) return null;
  const seen = new Map<string, number>();
  for (const p of products)
    for (const w of new Set(tokens(p.name))) seen.set(w, (seen.get(w) ?? 0) + 1);
  const scored = products
    .map((p) => {
      const full = looseText(p.name);
      if (full.trim().length >= 3 && hay.includes(full)) return { p, score: 100 + full.length };
      const own = [...new Set(tokens(p.name))].filter((w) => seen.get(w) === 1);
      const hits = own.filter((w) => hay.includes(` ${w} `)).length;
      // A long name needs two of its own words; a short one needs all of them.
      const enough = own.length > 0 && hits >= Math.min(2, own.length);
      return { p, score: enough ? hits : 0 };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].p;
}

const SELLING =
  /\b(?:(?:our|my|this|the|new|latest)\s+(?:products?|range|collection|bestsellers?|best[- ]sellers?|drop|flavou?rs?|items?|menu|release)|new arrivals?|back in stock|in stock|shop now|buy now|order now|now available|just (?:landed|dropped|launched|arrived)|bestsellers?|best[- ]sellers?|product (?:shot|photo|launch|showcase|feature|spotlight|post)|launch(?:es|ing)?|on sale|sale ends|discount|\d+\s?% off|limited stock)\b/i;
const FRESH =
  /\b(?:new|latest|launch(?:es|ing)?|just (?:landed|dropped|launched|arrived)|release)\b/i;

/** Is the piece about something the brand sells, whether or not it names it? */
export function wantsProduct(args: { text: string; goal?: string | null; aim?: string | null }) {
  return (
    args.goal === "launch" || args.goal === "offer" || args.aim === "act" || SELLING.test(args.text)
  );
}

/**
 * The product a piece features. `rotate` is for callers acting without a
 * person: a selling brief that names nothing gets the product featured least
 * recently (never-featured first; the newest of those for a launch), photos
 * before no photo. `recent` is product ids, newest first.
 */
export function pickFeaturedProduct(args: {
  text: string;
  goal?: string | null;
  aim?: string | null;
  products: FeatureCandidate[];
  recent: string[];
  rotate: boolean;
}): FeaturePick | null {
  const named = namedProduct(args.text, args.products);
  if (named) return { id: named.id, reason: "named" };
  if (!args.rotate || !args.products.length || !wantsProduct(args)) return null;
  const fresh = FRESH.test(args.text) || args.goal === "launch";
  const lastShown = (id: string) => {
    const i = args.recent.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ranked = [...args.products].sort(
    (a, b) =>
      lastShown(b.id) - lastShown(a.id) ||
      Number(b.hasPhoto) - Number(a.hasPhoto) ||
      (fresh ? b.position - a.position : a.position - b.position),
  );
  return { id: ranked[0].id, reason: "rotation" };
}

type PhotoControls = {
  includeImage?: boolean;
  referenceAssetIds?: string[];
  referenceMode?: string;
  storyMode?: string;
  videoMode?: string;
};

/** Up to this many of a product's photos go on a carousel's slides. */
export const CAROUSEL_PRODUCT_PHOTOS = 3;

/**
 * How a product's own photos are used in a piece, or null when they aren't:
 * a revision keeps what it had, and photos a person chose come first.
 * A single picture is a product hero poster: the product cut out of its main
 * photo and staged (ADR-0040). Without that, `designEnabled` designs around
 * the photo, and false keeps the photo itself.
 */
export function productPhotoControls(args: {
  type: string;
  controls: PhotoControls;
  photoIds: string[];
  revision: boolean;
  designEnabled: boolean;
  heroEnabled?: boolean;
}): { referenceAssetIds: string[]; referenceMode: "preserve" | "design" | "hero" } | null {
  const { type, controls, photoIds } = args;
  if (!photoIds.length || args.revision || controls.referenceAssetIds?.length) return null;
  const single =
    type === "image" || type === "ad" || (type === "social" && Boolean(controls.includeImage));
  if (single)
    return {
      referenceAssetIds: [photoIds[0]],
      referenceMode: args.heroEnabled ? "hero" : args.designEnabled ? "design" : "preserve",
    };
  if (type === "carousel")
    return {
      referenceAssetIds: photoIds.slice(0, CAROUSEL_PRODUCT_PHOTOS),
      referenceMode: "preserve",
    };
  const madeVideo = type === "video" && (controls.videoMode ?? "generate") === "generate";
  if (type === "story" || madeVideo)
    return { referenceAssetIds: [photoIds[0]], referenceMode: "preserve" };
  return null;
}
