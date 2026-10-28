// The product catalogue (ADR-0035): what a brand actually sells. Pure.
//
// Discovery reads a site's own product data (Shopify's product feed, then
// schema.org Product markup on product pages); nothing here is written by a
// model. A product a person adds or edits goes through decideProduct.
import { z } from "zod";
import { largerImage, type ProductPageSignals } from "@/lib/ugc/product-page";

export const MAX_DISCOVERED = 10;
export const MAX_IMAGES_PER_CANDIDATE = 3;
export const MAX_PRODUCT_IMAGES = 8;

export const PRODUCT_KINDS = ["product", "service"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export type ProductSource = "scan" | "shopify" | "manual";

/** Something discovery found on the site, before a person keeps it. */
export type ProductCandidate = {
  name: string;
  description: string;
  price: string;
  url: string | null;
  category: string;
  images: string[];
  source: Exclude<ProductSource, "manual">;
  fingerprint: string;
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

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

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
  return `name:${p.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}`.slice(0, 200);
}

const PRODUCT_PATH = /\/(products?|shop|item|p)\/[^/?#]+\/?$/i;
const NOT_PRODUCT = /\/(collections?|categor(y|ies)|tags?|cart|checkout|account|search|blog)\b/i;

/** Links on the site that look like single product pages, most likely first. */
export function productLinks(links: string[], origin: string): string[] {
  let host: string;
  try {
    host = new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link, origin);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== host) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    if (!PRODUCT_PATH.test(u.pathname) || NOT_PRODUCT.test(u.pathname)) continue;
    u.hash = "";
    u.search = "";
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_DISCOVERED) break;
  }
  return out;
}

function safeImage(url: unknown, base: string): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return largerImage(u.toString());
  } catch {
    return null;
  }
}

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
    const images = (Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : [])
      .map((img) => safeImage(img?.src, origin))
      .filter((u): u is string => !!u)
      .slice(0, MAX_IMAGES_PER_CANDIDATE);
    out.push({
      name: clip(name, 160),
      description: clip(decode(typeof p.body_html === "string" ? p.body_html : ""), 600),
      price: clip(price, 60),
      url,
      category: clip(typeof p.product_type === "string" ? decode(p.product_type) : "", 80),
      images,
      source: "shopify",
      fingerprint: productFingerprint({ url, name }),
    });
  }
  return out;
}

/** One product page's structured data as a candidate, or null when it isn't one. */
export function toCandidate(signals: ProductPageSignals): ProductCandidate | null {
  const name = decode(signals.name);
  // Without schema.org Product data, a page needs at least a price or an image
  // to count as a product, so an "about" page with a /p/ path isn't imported.
  if (!name || (!signals.structured && !signals.price && !signals.images.length)) return null;
  const images = signals.images
    .map((img) => safeImage(img.url, signals.url))
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGES_PER_CANDIDATE);
  return {
    name: clip(name, 160),
    description: clip(decode(signals.description), 600),
    price: clip(signals.price, 60),
    url: signals.url,
    category: clip(decode(signals.category), 80),
    images,
    source: "scan",
    fingerprint: productFingerprint({ url: signals.url, name }),
  };
}

/** Unique candidates (by fingerprint and by name), the richest first, capped. */
export function dedupeCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const byKey = new Map<string, ProductCandidate>();
  const names = new Set<string>();
  const score = (c: ProductCandidate) =>
    (c.images.length ? 4 : 0) + (c.price ? 2 : 0) + (c.description ? 1 : 0);
  for (const c of [...candidates].sort((a, b) => score(b) - score(a))) {
    const name = c.name.toLowerCase();
    if (byKey.has(c.fingerprint) || names.has(name)) continue;
    byKey.set(c.fingerprint, c);
    names.add(name);
    if (byKey.size >= MAX_DISCOVERED) break;
  }
  return [...byKey.values()];
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

/** Onboarding's gate: at least one product or service to write about. */
export function hasSellable(products: Pick<Product, "status">[]): boolean {
  return products.some((p) => p.status === "active");
}
