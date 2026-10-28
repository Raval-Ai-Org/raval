// The brand's product catalogue, pure half: which links on a website are
// product pages, how a Shopify store's public product feed reads, which product
// a Studio piece should show, and the words that tell an image model to keep
// that product exactly as it is. No I/O; the server fetches through safe-fetch.
import type { ProductPageSignals } from "@/lib/ugc/product-page";

export const MAX_PRODUCTS = 60;
/** Product pages read in one website scan. */
export const SCAN_PAGE_LIMIT = 12;

export type CatalogCandidate = {
  name: string;
  url: string;
  price: string;
  description: string;
  category: string;
  /** Best photo first. */
  images: string[];
};

/** What the browser and Studio see. `imageUrl` is a short-lived signed URL. */
export type CatalogProduct = {
  id: string;
  name: string;
  url: string;
  price: string;
  description: string;
  category: string;
  source: "scan" | "manual";
  isPrimary: boolean;
  imageUrl: string | null;
};

/** The product a Studio job shows, as stored on the job's output. */
export type JobProduct = {
  id: string;
  name: string;
  price: string;
  description: string;
  url: string;
  /** Workspace storage path of the photo, re-signed for every render attempt. */
  storagePath: string | null;
};

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** Paths that name one product on the common shop platforms. */
const PRODUCT_PATH = [
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products\/[^/]+$/i, // Shopify
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?product\/[^/]+$/i, // WooCommerce, many others
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/[^/]+\/[^/]+$/i,
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/p\/[^/]+$/i, // Squarespace
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?p\/[^/]+$/i,
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items?\/[^/]+$/i,
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?store\/[^/]+\/[^/]+$/i,
  /\/[^/]+-p-?\d{3,}(?:\.html?)?$/i,
  /\/dp\/[A-Z0-9]{8,}$/,
];

const NOT_PRODUCT =
  /\/(cart|checkout|account|login|signin|register|search|wishlist|compare|policies|pages|blogs?|news|tag|category|categories|collections\/?$)\b/i;

export function isProductPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (NOT_PRODUCT.test(path)) return false;
  if (/\.(pdf|zip|png|jpe?g|webp|gif|svg|mp4|xml|json)$/i.test(path)) return false;
  return PRODUCT_PATH.some((re) => re.test(path));
}

/**
 * Product page URLs from a site's own links, in the order they appear (the
 * homepage's featured products first), then its sitemap. Same site only,
 * one URL per path, no query strings.
 */
export function productPageCandidates(
  home: string,
  links: string[],
  sitemapUrls: string[] = [],
  limit = SCAN_PAGE_LIMIT,
): string[] {
  let host: string;
  try {
    host = bareHost(new URL(home).hostname);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...links, ...sitemapUrls]) {
    let u: URL;
    try {
      u = new URL(raw, home);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (bareHost(u.hostname) !== host) continue;
    u.hash = "";
    u.search = "";
    const path = u.pathname.replace(/\/+$/, "");
    // The same product under a collection is the same product.
    const key = path.replace(/^.*\/products\//i, "/products/").toLowerCase();
    if (seen.has(key) || !isProductPath(path)) continue;
    seen.add(key);
    out.push(`${u.origin}${path}`);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sitemaps in a sitemap index that hold products (Shopify, Yoast, Rank Math). */
export function productSitemaps(indexXml: string): string[] {
  const out: string[] = [];
  for (const m of indexXml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi)) {
    const loc = m[1].trim();
    if (/product/i.test(loc)) out.push(loc);
    if (out.length >= 3) break;
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const plain = (html: unknown, max: number) =>
  typeof html === "string"
    ? decode(html.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * Shopify's public `/products.json`. Only products with a photo are kept:
 * the whole point of the catalogue is showing the real thing.
 */
export function parseShopifyProducts(json: unknown, origin: string): CatalogCandidate[] {
  const list = (json as { products?: unknown })?.products;
  if (!Array.isArray(list)) return [];
  const out: CatalogCandidate[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    const handle = typeof raw.handle === "string" ? raw.handle.trim() : "";
    const name = plain(raw.title, 160);
    if (!handle || !name) continue;
    const images = (Array.isArray(raw.images) ? raw.images : [])
      .map((img) => (img as { src?: unknown })?.src)
      .filter((src): src is string => typeof src === "string" && /^https:\/\//i.test(src))
      .slice(0, 4);
    if (!images.length) continue;
    const variant = (Array.isArray(raw.variants) ? raw.variants[0] : null) as {
      price?: unknown;
    } | null;
    const price =
      typeof variant?.price === "string" || typeof variant?.price === "number"
        ? String(variant.price).slice(0, 40)
        : "";
    out.push({
      name,
      url: `${origin}/products/${encodeURIComponent(handle)}`,
      price,
      description: plain(raw.body_html, 600),
      category: plain(raw.product_type, 120),
      images,
    });
  }
  return out;
}

/** A parsed page is a product only with Product data, or a price and a photo. */
export function candidateFromPage(signals: ProductPageSignals): CatalogCandidate | null {
  if (!signals.images.length || !signals.name.trim()) return null;
  if (!signals.structured && !signals.price) return null;
  return {
    name: signals.name.trim().slice(0, 160),
    url: signals.url,
    price: signals.price.slice(0, 40),
    description: signals.description.slice(0, 600),
    category: signals.category.slice(0, 120),
    images: signals.images.map((img) => img.url).slice(0, 4),
  };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 2);

const GENERIC = new Set([
  "the",
  "and",
  "for",
  "with",
  "new",
  "set",
  "pack",
  "kit",
  "size",
  "mini",
  "pro",
  "max",
  "edition",
]);

/** How strongly a brief names a product: the share of its distinctive words present. */
export function mentionScore(brief: string, name: string): number {
  return mention(brief, name).score;
}

function mention(brief: string, name: string): { score: number; matched: number } {
  const have = new Set(words(brief));
  const want = [...new Set(words(name).filter((w) => !GENERIC.has(w)))];
  if (!want.length) return { score: 0, matched: 0 };
  const matched = want.filter((w) => have.has(w)).length;
  return { score: matched / want.length, matched };
}

/** Formats that are made to sell a product, so they show one when none is chosen. */
const SELLS = new Set(["ad"]);

/**
 * Which product a piece shows: the one the person chose; else one the brief
 * clearly names; else, for an ad, the main product. "none" means none.
 */
export function pickProduct<T extends { id: string; name: string; isPrimary: boolean }>(
  products: T[],
  args: { chosen?: string | null; brief: string; type: string },
): T | null {
  if (args.chosen === "none") return null;
  if (args.chosen) return products.find((p) => p.id === args.chosen) ?? null;
  // Named: most of its distinctive words, or at least two of them. One shared
  // word ("coffee") is not enough to put a product in a piece.
  let best: T | null = null;
  let bestScore = 0;
  for (const product of products) {
    const { score, matched } = mention(args.brief, product.name);
    if ((score >= 0.6 || matched >= 2) && score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  if (best) return best;
  if (!SELLS.has(args.type)) return null;
  return products.find((p) => p.isPrimary) ?? products[0] ?? null;
}

/** What the copy model knows about the product. Only the site's own words. */
export function productFacts(product: Pick<JobProduct, "name" | "price" | "description" | "url">) {
  return [
    `Name: ${product.name}`,
    product.price ? `Price on the website: ${product.price}` : "",
    product.description ? `From the product page: ${product.description.slice(0, 500)}` : "",
    product.url ? `Page: ${product.url}` : "",
    "Use only these facts about the product. Do not invent features, ingredients, results, discounts or reviews.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The instruction that keeps the real product in the picture. `position` is
 * which attached image holds it (1 = the first).
 */
export function productFidelity(name: string, position = 1): string {
  const which = position === 1 ? "The first attached image" : `Attached image ${position}`;
  return [
    `PRODUCT: ${which} is the real product, "${name}". It must appear in the picture as the hero, clearly visible and in focus.`,
    "Reproduce it exactly: the same shape, proportions, colours, materials, label, packaging and printed text. Do not redesign, relabel, simplify, recolour or swap it for a similar item, and do not add a second different product.",
    "Place it naturally in the scene with matching light, shadow and perspective, as a real product photograph would. Ignore the background and any text around the product in that photo.",
  ].join(" ");
}
