// The product catalogue (ADR-0035): what a brand actually sells. Pure.
//
// Discovery reads a site's own product data first: Shopify's and
// WooCommerce's public feeds, then schema.org Product / Service markup on
// product, service and listing pages. What the Brand DNA model names from the
// crawled text is kept only when groundCatalog finds it on the site, so
// nothing here is invented. A product a person adds or edits goes through
// decideProduct.
import { z } from "zod";
import { largerImage, type ProductPageSignals } from "@/lib/ugc/product-page";

export const MAX_DISCOVERED = 24;
export const MAX_IMAGES_PER_CANDIDATE = 3;
export const MAX_PRODUCT_IMAGES = 8;

export const PRODUCT_KINDS = ["product", "service"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export type ProductSource = "scan" | "shopify" | "manual";

/** Something discovery found on the site, before it is kept. */
export type ProductCandidate = {
  name: string;
  description: string;
  price: string;
  url: string | null;
  category: string;
  images: string[];
  source: Exclude<ProductSource, "manual">;
  fingerprint: string;
  /** Absent means "product" (what discovery sent before it found services). */
  kind?: ProductKind;
};

export type ProductImage = { assetId: string; url: string | null };

/** A stored product as the browser sees it. */
export type Product = {
  id: string;
  kind: ProductKind;
  name: string;
  description: string;
  price: string;
  url: string | null;
  category: string;
  benefits: string[];
  images: ProductImage[];
  primaryAssetId: string | null;
  source: ProductSource;
  position: number;
  status: "active" | "archived";
};

const text = (max: number) => z.string().trim().max(max).default("");

export const ProductInputSchema = z.object({
  kind: z.enum(PRODUCT_KINDS).default("product"),
  name: z.string().trim().min(1).max(160),
  description: text(1200),
  price: text(60),
  url: z.string().trim().url().max(600).nullable().optional(),
  category: text(80),
  benefits: z.array(z.string().trim().min(2).max(160)).max(6).default([]),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  "#39": "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  hellip: "…",
};

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const asText = (v: unknown): string =>
  typeof v === "string" ? decode(v) : typeof v === "number" ? String(v) : "";
/** Lower-case words with single spaces and a space at each end, for whole-word matching. */
function looseText(s: string): string {
  const words = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return ` ${words} `;
}
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Stable identity for one product: its normalised page, else its name. */
export function productFingerprint(p: { url?: string | null; name: string }): string {
  if (p.url) {
    try {
      const u = new URL(p.url);
      const path = u.pathname.replace(/\/+$/, "").toLowerCase();
      return `url:${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 200);
    } catch {
      /* fall through to the name */
    }
  }
  // Stored rows are keyed on this exact form: don't change it.
  return `name:${p.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}`.slice(0, 200);
}

/** A name compared loosely: case, accents and punctuation don't matter. */
export const nameKey = (name: string) => looseText(name).trim();

// ── Links ───────────────────────────────────────────────────────────────────

const PRODUCT_PATH =
  /\/(products?|shop|store|item|items|p|product-page|catalog|catalogue)\/[^/?#]+\/?$/i;
// Not "/solutions/": on most sites those are industry pages, not things sold.
const SERVICE_PATH =
  /\/(services?|treatments?|offerings?|packages?|programs?|programmes?|courses?|classes|workshops?)\/[^/?#]+\/?$/i;
const NOT_PRODUCT =
  /\/(collections?|categor(y|ies)|product-category|tags?|cart|checkout|account|search|blog|news|feed|wp-content|page)(\/|$)/i;
const FILE_PATH = /\.(xml|jpe?g|png|webp|gif|svg|pdf|zip|css|js)$/i;

export type CatalogLink = { url: string; kind: ProductKind };

/**
 * Links on the site that look like one product's or one service's page, in
 * the order they were found. A Shopify product inside a collection
 * (`/collections/mugs/products/blue-mug`) counts; the collection page doesn't.
 */
export function catalogLinks(links: string[], origin: string, max = MAX_DISCOVERED): CatalogLink[] {
  const host = hostOf(origin);
  if (!host) return [];
  const out: CatalogLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link, origin);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "").toLowerCase() !== host) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    const path = u.pathname;
    if (FILE_PATH.test(path)) continue;
    const kind: ProductKind | null = PRODUCT_PATH.test(path)
      ? "product"
      : SERVICE_PATH.test(path)
        ? "service"
        : null;
    if (!kind) continue;
    const head = path
      .replace(kind === "product" ? PRODUCT_PATH : SERVICE_PATH, "")
      .replace(/^\/collections\/[^/]+$/i, "");
    if (NOT_PRODUCT.test(head)) continue;
    u.hash = "";
    u.search = "";
    const key = u.toString().replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: u.toString(), kind });
    if (out.length >= max) break;
  }
  return out;
}

/** Links on the site that look like single product pages, in the order found. */
export function productLinks(links: string[], origin: string): string[] {
  return catalogLinks(links, origin)
    .filter((l) => l.kind === "product")
    .map((l) => l.url);
}

/** Pages that usually list everything a site sells, to look for links and markup. */
export const LISTING_PATHS = [
  "/shop",
  "/products",
  "/collections/all",
  "/store",
  "/services",
  "/menu",
  "/pricing",
] as const;

/**
 * Child sitemaps of a sitemap index that list products or services
 * (WooCommerce/Yoast `product-sitemap.xml`, Shopify `sitemap_products_1.xml`).
 */
export function catalogSitemaps(xml: string, origin: string): string[] {
  if (!xml || !/<sitemapindex/i.test(xml)) return [];
  const host = hostOf(origin);
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = m[1].replace(/&amp;/g, "&");
    if (!/(product|service|shop|store)/i.test(loc) || /categor|tag|brand/i.test(loc)) continue;
    if (hostOf(loc) !== host) continue;
    out.push(loc);
    if (out.length >= 3) break;
  }
  return out;
}

/** Every `<loc>` in a sitemap, same host only. */
export function sitemapLocs(xml: string, origin: string, max = 400): string[] {
  if (!xml) return [];
  const host = hostOf(origin);
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = m[1].replace(/&amp;/g, "&");
    if (hostOf(loc) === host) out.push(loc);
    if (out.length >= max) break;
  }
  return out;
}

function safeImage(url: unknown, base: string): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/\.svg(\?|$)/i.test(u.pathname)) return null;
    return largerImage(u.toString());
  } catch {
    return null;
  }
}

const images = (list: unknown[], base: string) =>
  list
    .map((u) => safeImage(u, base))
    .filter((u): u is string => !!u)
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, MAX_IMAGES_PER_CANDIDATE);

// ── Store feeds ─────────────────────────────────────────────────────────────

/** Shopify's public `/products.json` feed, read as candidates. */
export function parseShopifyProducts(json: unknown, origin: string): ProductCandidate[] {
  const list = (json as { products?: unknown })?.products;
  if (!Array.isArray(list)) return [];
  const out: ProductCandidate[] = [];
  for (const raw of list.slice(0, MAX_DISCOVERED * 2)) {
    const p = raw as Record<string, unknown>;
    const name = typeof p.title === "string" ? decode(p.title) : "";
    if (!name) continue;
    const handle = typeof p.handle === "string" ? p.handle : "";
    const url = handle
      ? new URL(`/products/${encodeURIComponent(handle)}`, origin).toString()
      : null;
    const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : [];
    const price = typeof variants[0]?.price === "string" ? (variants[0].price as string) : "";
    out.push({
      name: clip(name, 160),
      description: clip(decode(typeof p.body_html === "string" ? p.body_html : ""), 600),
      price: clip(price, 60),
      url,
      category: clip(typeof p.product_type === "string" ? decode(p.product_type) : "", 80),
      images: images(
        (Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []).map(
          (img) => img?.src,
        ),
        origin,
      ),
      source: "shopify",
      fingerprint: productFingerprint({ url, name }),
      kind: "product",
    });
  }
  return out;
}

/** WooCommerce's public Store API (`/wp-json/wc/store/v1/products`), read as candidates. */
export function parseWooProducts(json: unknown, origin: string): ProductCandidate[] {
  if (!Array.isArray(json)) return [];
  const host = hostOf(origin);
  const out: ProductCandidate[] = [];
  for (const raw of json.slice(0, MAX_DISCOVERED * 2)) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = asText(p.name);
    if (!name) continue;
    const link = typeof p.permalink === "string" ? p.permalink : "";
    const url = link && hostOf(link) === host ? link : null;
    const prices = (p.prices ?? {}) as Record<string, unknown>;
    const minor = Number(prices.currency_minor_unit ?? 2);
    const amount = Number(prices.price);
    const price =
      Number.isFinite(amount) && amount > 0 && Number.isInteger(minor) && minor >= 0 && minor <= 4
        ? [asText(prices.currency_code), (amount / 10 ** minor).toFixed(minor)]
            .filter(Boolean)
            .join(" ")
        : "";
    const cats = Array.isArray(p.categories) ? (p.categories as Record<string, unknown>[]) : [];
    out.push({
      name: clip(name, 160),
      description: clip(asText(p.short_description) || asText(p.description), 600),
      price: clip(price, 60),
      url,
      category: clip(asText(cats[0]?.name), 80),
      images: images(
        (Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []).map(
          (img) => img?.src,
        ),
        origin,
      ),
      source: "scan",
      fingerprint: productFingerprint({ url, name }),
      kind: "product",
    });
  }
  return out;
}

// ── Structured data ────────────────────────────────────────────────────────

const typesOf = (node: Record<string, unknown>): string[] =>
  (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase());

const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct", "productmodel"]);
const SERVICE_TYPES = new Set(["service", "course", "foodservice", "financialproduct"]);

function ldImageList(v: unknown): unknown[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(ldImageList);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ldImageList(o.url ?? o.contentUrl);
  }
  return [];
}

function ldPrice(offers: unknown): string {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list as Array<Record<string, unknown>>) {
    const spec = (offer?.priceSpecification ?? {}) as Record<string, unknown>;
    const amount = asText(offer?.price ?? offer?.lowPrice ?? spec.price);
    const currency = asText(offer?.priceCurrency ?? spec.priceCurrency);
    if (amount) return [currency, amount].filter(Boolean).join(" ");
  }
  return "";
}

/**
 * Products and services declared in a page's JSON-LD: a Product or Service
 * node, the items of an ItemList, and a business's OfferCatalog
 * (`hasOfferCatalog` → Offer → `itemOffered`).
 */
export function catalogFromJsonLd(nodes: unknown[], pageUrl: string): ProductCandidate[] {
  const host = hostOf(pageUrl);
  const out: ProductCandidate[] = [];
  const seen = new Set<unknown>();
  const visit = (n: unknown, depth: number) => {
    if (!n || typeof n !== "object" || depth > 7 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach((x) => visit(x, depth + 1));
    const node = n as Record<string, unknown>;
    const types = typesOf(node);
    const kind: ProductKind | null = types.some((t) => PRODUCT_TYPES.has(t))
      ? "product"
      : types.some((t) => SERVICE_TYPES.has(t))
        ? "service"
        : null;
    const name = asText(node.name);
    if (kind && name.length >= 2 && name.length <= 160) {
      const raw = typeof node.url === "string" ? node.url : "";
      let url: string | null = null;
      try {
        url = raw ? new URL(raw, pageUrl).toString() : null;
      } catch {
        url = null;
      }
      if (url && hostOf(url) !== host) url = null;
      // A Product on its own page is that page.
      if (!url && kind === "product" && /\/(products?|p|shop|item)\//i.test(pageUrl)) url = pageUrl;
      out.push({
        name: clip(name, 160),
        description: clip(asText(node.description), 600),
        price: clip(ldPrice(node.offers), 60),
        url,
        category: clip(asText(node.category).split(/[>/]/).pop()?.trim() ?? "", 80),
        images: images(ldImageList(node.image), pageUrl),
        source: "scan",
        fingerprint: productFingerprint({ url, name }),
        kind,
      });
      // A ProductGroup's variants are the same product.
      if (types.includes("productgroup")) return;
    }
    for (const key of [
      "@graph",
      "itemListElement",
      "item",
      "itemOffered",
      "hasOfferCatalog",
      "makesOffer",
      "offers",
      "mainEntity",
      "hasPart",
    ]) {
      if (key === "offers" && kind) continue;
      visit(node[key], depth + 1);
    }
  };
  nodes.forEach((n) => visit(n, 0));
  return out;
}

/** One product or service page's signals as a candidate, or null when it isn't one. */
export function toCandidate(
  signals: ProductPageSignals,
  kind: ProductKind = "product",
): ProductCandidate | null {
  let name = decode(signals.name);
  // A page title without markup carries the site's name or a tagline:
  // "Web design | Studio", "Web design: grow online".
  if (!signals.structured) {
    const head = name.split(/\s[|–—-]\s|:\s/)[0]?.trim() ?? "";
    if (head.length >= 3) name = head;
  }
  // Without schema.org Product data, a product page needs at least a price or
  // an image, so an "about" page with a /p/ path isn't imported. A service page
  // is recognised by its address.
  if (!name || name.length < 2) return null;
  if (kind === "product" && !signals.structured && !signals.price && !signals.images.length)
    return null;
  return {
    name: clip(name, 160),
    description: clip(decode(signals.description), 600),
    price: clip(signals.price, 60),
    url: signals.url,
    category: clip(decode(signals.category), 80),
    images: images(
      signals.images.map((img) => img.url),
      signals.url,
    ),
    source: "scan",
    fingerprint: productFingerprint({ url: signals.url, name }),
    kind,
  };
}

// ── What the model named, checked against the site ──────────────────────────

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or our that the their this to we with you your".split(
    " ",
  ),
);

/**
 * Items the Brand DNA model listed from the crawled pages, kept only when the
 * site says so: the name appears in the crawled text, a price only if it is
 * written there, a link only to this site, and a description only when most
 * of its words are the site's own. Never adds anything the text doesn't hold.
 */
export function groundCatalog(
  claims: unknown,
  evidence: { text: string; origin: string },
): ProductCandidate[] {
  if (!Array.isArray(claims)) return [];
  const page = looseText(evidence.text);
  const host = hostOf(evidence.origin);
  const out: ProductCandidate[] = [];
  const names = new Set<string>();
  for (const raw of claims.slice(0, MAX_DISCOVERED * 2)) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = asText(c.name).replace(/^["'“”]+|["'“”]+$/g, "");
    const key = nameKey(name);
    if (name.length < 2 || name.length > 120 || !key || names.has(key)) continue;
    if (!page.includes(` ${key} `)) continue;
    names.add(key);
    const kind: ProductKind = c.kind === "service" ? "service" : "product";
    const price = asText(c.price);
    const priceDigits = price.replace(/[^\d.,]/g, "").replace(/[.,]00$/, "");
    const keepPrice = priceDigits.length > 0 && page.includes(looseText(priceDigits));
    let url: string | null = null;
    const link = asText(c.url);
    if (link) {
      try {
        const u = new URL(link, evidence.origin);
        url = hostOf(u.toString()) === host && /^https?:$/.test(u.protocol) ? u.toString() : null;
      } catch {
        url = null;
      }
    }
    const description = asText(c.description);
    const words = looseText(description)
      .trim()
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w));
    const found = words.filter((w) => page.includes(` ${w} `)).length;
    const keepDescription = words.length > 0 && found / words.length >= 0.7;
    out.push({
      name: clip(name, 160),
      description: keepDescription ? clip(description, 400) : "",
      price: keepPrice ? clip(price, 60) : "",
      url,
      category: "",
      images: [],
      source: "scan",
      fingerprint: productFingerprint({ url, name }),
      kind,
    });
  }
  return out;
}

/** The product or service page whose address spells this name (`/services/web-design`). */
export function linkForName(name: string, links: CatalogLink[]): CatalogLink | null {
  const slug = nameKey(name).replace(/ /g, "-");
  if (slug.length < 3) return null;
  return (
    links.find((l) => {
      try {
        const last = new URL(l.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
        return last.toLowerCase() === slug;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * Unique candidates (by fingerprint and by name), the richest first, capped.
 * When two copies meet, the one with more detail wins and borrows what the
 * other had (a photo from markup, a description from the text).
 */
export function dedupeCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const score = (c: ProductCandidate) =>
    (c.images.length ? 4 : 0) + (c.price ? 2 : 0) + (c.description ? 1 : 0);
  const byKey = new Map<string, ProductCandidate>();
  const byName = new Map<string, ProductCandidate>();
  const order: ProductCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => score(b) - score(a))) {
    const name = nameKey(c.name);
    const same = byKey.get(c.fingerprint) ?? byName.get(name);
    if (same) {
      if (!same.images.length && c.images.length) same.images = c.images;
      if (!same.price && c.price) same.price = c.price;
      if (!same.description && c.description) same.description = c.description;
      if (!same.url && c.url) same.url = c.url;
      if (!same.category && c.category) same.category = c.category;
      continue;
    }
    if (order.length >= MAX_DISCOVERED) continue;
    const copy = { ...c, images: [...c.images] };
    byKey.set(c.fingerprint, copy);
    byName.set(name, copy);
    order.push(copy);
  }
  return order;
}

export type ProductDecision =
  { ok: true; input: ProductInput; fingerprint: string } | { ok: false; error: string };

/** Clean a product a person added or edited. A service needs no photo. */
export function decideProduct(raw: unknown): ProductDecision {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const url = typeof o.url === "string" && o.url.trim() ? o.url.trim() : null;
  const parsed = ProductInputSchema.safeParse({
    ...o,
    url: url && /^https?:\/\//i.test(url) ? url : url ? `https://${url}` : null,
    benefits: Array.isArray(o.benefits)
      ? (o.benefits as unknown[]).filter((b) => typeof b === "string" && b.trim().length >= 2)
      : [],
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "name") return { ok: false, error: "Give it a name." };
    if (field === "url") return { ok: false, error: "That link doesn't look right." };
    return { ok: false, error: "Some details are too long. Shorten them and try again." };
  }
  return {
    ok: true,
    input: parsed.data,
    fingerprint: productFingerprint({ url: parsed.data.url, name: parsed.data.name }),
  };
}

/** What Brand DNA's `products` text says, derived from the catalogue. */
export function productsSummary(products: Pick<Product, "name" | "status">[]): string {
  return products
    .filter((p) => p.status === "active")
    .map((p) => p.name)
    .slice(0, 12)
    .join(", ")
    .slice(0, 600);
}

/** "4 products and 2 services": only the kinds that are there. */
export function foundLine(items: { kind?: ProductKind }[]): string {
  const services = items.filter((i) => i.kind === "service").length;
  const products = items.length - services;
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  return [products ? count(products, "product") : "", services ? count(services, "service") : ""]
    .filter(Boolean)
    .join(" and ");
}

/** Onboarding's gate: at least one product or service to write about. */
export function hasSellable(products: Pick<Product, "status">[]): boolean {
  return products.some((p) => p.status === "active");
}
