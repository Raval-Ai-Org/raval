// Structured signals from a product page: schema.org Product JSON-LD, Open
// Graph / product meta tags, the title and H1, candidate product images and
// the visible text. Pure (no I/O) — the server fetches through safe-fetch and
// hands the HTML here.
import { absoluteUrl, extractJsonLd, extractMeta, stripHtml } from "@/lib/crawl/html";

export type ProductPageSignals = {
  url: string;
  name: string;
  brand: string;
  description: string;
  price: string;
  category: string;
  images: Array<{ url: string; alt: string }>;
  /** Visible page text, for fact extraction. */
  text: string;
  /** True when schema.org Product data was found. */
  structured: boolean;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const asText = (v: unknown): string =>
  typeof v === "string" ? decode(v) : typeof v === "number" ? String(v) : "";

function typesOf(node: any): string[] {
  const t = node?.["@type"];
  return (Array.isArray(t) ? t : [t])
    .filter((x) => typeof x === "string")
    .map((x) => x.toLowerCase());
}

/** Every JSON-LD node, flattening @graph and nested arrays. */
function flattenLd(nodes: any[]): any[] {
  const out: any[] = [];
  const visit = (n: any, depth: number) => {
    if (!n || typeof n !== "object" || depth > 4) return;
    if (Array.isArray(n)) return n.forEach((x) => visit(x, depth + 1));
    out.push(n);
    if (Array.isArray(n["@graph"])) n["@graph"].forEach((x: any) => visit(x, depth + 1));
  };
  nodes.forEach((n) => visit(n, 0));
  return out;
}

function ldImages(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(ldImages);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ldImages(o.url ?? o.contentUrl);
  }
  return [];
}

function ldPrice(offers: unknown): string {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list as Array<Record<string, unknown>>) {
    const amount = asText(offer?.price ?? offer?.lowPrice);
    const currency = asText(offer?.priceCurrency);
    if (amount) return [currency, amount].filter(Boolean).join(" ");
  }
  return "";
}

/**
 * Storefront CDNs (Shopify, imgix, Cloudinary-style params) serve thumbnails
 * from the same URL with a small width. Ask for a size video models accept.
 */
export function largerImage(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    for (const key of ["width", "w"]) {
      const value = Number(u.searchParams.get(key));
      if (value && value < 1024) u.searchParams.set(key, "1200");
    }
    u.searchParams.delete("height");
    return u.toString();
  } catch {
    return url;
  }
}

const JUNK_IMAGE_RE =
  /(sprite|icon|logo|favicon|badge|pixel|spacer|placeholder|avatar|payment|flag)[^/]*$/i;

export function parseProductPage(html: string, pageUrl: string): ProductPageSignals {
  const base = new URL(pageUrl);
  const meta = extractMeta(html);
  const nodes = flattenLd(extractJsonLd(html));
  const product = nodes.find((n) =>
    typesOf(n).some((t) => t === "product" || t === "productgroup"),
  );

  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const h1 = decode(stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "", 200));
  const siteName = decode(meta["og:site_name"] ?? "");

  const name =
    asText(product?.name) ||
    decode(meta["og:title"] ?? "") ||
    h1 ||
    title.split(/\s[|–—-]\s/)[0] ||
    base.hostname;
  const brandNode = product?.brand;
  const brand =
    (typeof brandNode === "object" ? asText(brandNode?.name) : asText(brandNode)) ||
    decode(meta["product:brand"] ?? "") ||
    siteName;
  const description =
    asText(product?.description) ||
    decode(meta["og:description"] ?? "") ||
    decode(meta["description"] ?? "");
  const metaPrice = decode(meta["product:price:amount"] ?? meta["og:price:amount"] ?? "");
  const metaCurrency = decode(meta["product:price:currency"] ?? meta["og:price:currency"] ?? "");
  const price = ldPrice(product?.offers) || [metaCurrency, metaPrice].filter(Boolean).join(" ");
  const category = asText(product?.category).split(/[>/]/).pop()?.trim() ?? "";

  const candidates: Array<{ url: string; alt: string }> = [];
  const push = (href: string | undefined | null, alt = "") => {
    const abs = largerImage(absoluteUrl(href ? decode(href) : null, base));
    if (!abs || !/^https:\/\//i.test(abs)) return;
    if (/\.svg(\?|$)/i.test(abs) || JUNK_IMAGE_RE.test(abs.split("?")[0])) return;
    if (candidates.some((c) => c.url === abs)) return;
    candidates.push({ url: abs, alt: decode(alt).slice(0, 200) });
  };
  ldImages(product?.image).forEach((u) => push(u, name));
  push(meta["og:image:secure_url"] ?? meta["og:image"], name);
  push(meta["twitter:image"], name);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (candidates.length >= 12) break;
    const tag = m[0];
    const src =
      tag.match(/\s(?:data-zoom-image|data-large_image|data-src|src)=["']([^"']+)["']/i)?.[1] ??
      null;
    const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? "";
    const width = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] ?? 0);
    if (width && width < 200) continue;
    if (!src || src.startsWith("data:")) continue;
    // Prefer images that look like the product itself.
    const relevant =
      /product|gallery|media|cdn\/shop|zoom|main|hero/i.test(src) ||
      (alt && name && alt.toLowerCase().includes(name.toLowerCase().split(" ")[0] ?? ""));
    if (relevant) push(src, alt);
  }

  return {
    url: pageUrl,
    name: name.slice(0, 160),
    brand: brand.slice(0, 120),
    description: description.slice(0, 2000),
    price: price.slice(0, 40),
    category: category.slice(0, 120),
    images: candidates.slice(0, 8),
    text: stripHtml(html, 12_000),
    structured: Boolean(product),
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}%.$€£]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A quoted evidence snippet really appears on the page (whitespace/punctuation-insensitive). */
export function evidenceOnPage(evidence: string, pageText: string): boolean {
  const e = norm(evidence);
  if (e.length < 4) return false;
  return norm(pageText).includes(e);
}
