// Product and service discovery during a Brand DNA scan (ADR-0035). No model
// call: it reads the site's own data and returns candidates that onboarding
// keeps (a person removes what they don't want). Every request goes through
// the SSRF guard.
//
//   1. The store's public feed: Shopify `/products.json`, WooCommerce's Store
//      API. Either one is the whole catalogue with photos and prices.
//   2. Otherwise product and service pages: links from the crawl, the
//      sitemap and its product sitemaps, and the site's listing pages
//      (/shop, /services…), each read for schema.org markup; markup found on
//      the listing pages themselves (ItemList, OfferCatalog) counts too.
//
// Never throws and never runs past its budget: no products is a fact.
import "server-only";
import {
  LISTING_PATHS,
  MAX_DISCOVERED,
  catalogFromJsonLd,
  catalogLinks,
  catalogSitemaps,
  dedupeCandidates,
  parseShopifyProducts,
  parseWooProducts,
  sitemapLocs,
  toCandidate,
  type CatalogLink,
  type ProductCandidate,
} from "@/lib/products/catalog";
import { extractInternalLinks, extractJsonLd } from "@/lib/crawl/html";
import { parseProductPage } from "@/lib/ugc/product-page";
import { fetchPublicText, safeFetch } from "@/server/safe-fetch";

const USER_AGENT = "Mozilla/5.0 MelloxBrandBot";
const BUDGET_MS = 18_000;
const PAGE_CONCURRENCY = 6;

export type DiscoverDeps = {
  fetchJson: (url: string) => Promise<unknown | null>;
  fetchPage: (url: string) => Promise<string>;
};

const defaultDeps: DiscoverDeps = {
  fetchJson: async (url) => {
    try {
      const res = await safeFetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        timeoutMs: 5_000,
        maxBytes: 3 * 1024 * 1024,
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
      return JSON.parse(res.text());
    } catch {
      return null;
    }
  },
  fetchPage: (url) =>
    fetchPublicText(url, {
      headers: { "User-Agent": USER_AGENT },
      timeoutMs: 6_000,
      maxBytes: 3 * 1024 * 1024,
      requireTextContent: true,
    }),
};

/** Run `fn` over `items`, a few at a time, keeping order. */
async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export type DiscoverOptions = {
  /** The `/sitemap.xml` the scan already read, to avoid reading it twice. */
  sitemapXml?: string;
  /** Called with what is known so far, so the person sees products early. */
  onPartial?: (products: ProductCandidate[]) => void;
};

async function discover(
  origin: URL,
  links: string[],
  deps: DiscoverDeps,
  opts: DiscoverOptions,
): Promise<ProductCandidate[]> {
  const base = origin.origin;
  const [shopify, woo] = await Promise.all([
    deps.fetchJson(new URL(`/products.json?limit=${MAX_DISCOVERED}`, base).toString()),
    deps.fetchJson(
      new URL(`/wp-json/wc/store/v1/products?per_page=${MAX_DISCOVERED}`, base).toString(),
    ),
  ]);
  const fromFeed = [...parseShopifyProducts(shopify, base), ...parseWooProducts(woo, base)];
  // A store feed is the whole catalogue; services may still sit on their own pages.
  if (fromFeed.length >= MAX_DISCOVERED) return dedupeCandidates(fromFeed);
  if (fromFeed.length) opts.onPartial?.(dedupeCandidates(fromFeed));

  // Product sitemaps and listing pages, read side by side.
  const sitemapXml =
    opts.sitemapXml ??
    (await deps.fetchPage(new URL("/sitemap.xml", base).toString()).catch(() => ""));
  const childSitemaps = catalogSitemaps(sitemapXml, base);
  const listingUrls = LISTING_PATHS.map((p) => new URL(p, base).toString());
  const [children, listings] = await Promise.all([
    Promise.all(childSitemaps.map((u) => deps.fetchPage(u).catch(() => ""))),
    Promise.all(listingUrls.map((u) => deps.fetchPage(u).catch(() => ""))),
  ]);

  const fromMarkup: ProductCandidate[] = [];
  const listingLinks: string[] = [];
  listings.forEach((html, i) => {
    if (!html) return;
    const page = listingUrls[i];
    fromMarkup.push(...catalogFromJsonLd(extractJsonLd(html), page));
    listingLinks.push(...extractInternalLinks(html, new URL(page)));
  });
  const pool = [
    ...listingLinks,
    ...links,
    ...children.flatMap((xml) => sitemapLocs(xml, base)),
    ...sitemapLocs(sitemapXml, base),
  ];
  const known = dedupeCandidates([...fromFeed, ...fromMarkup]);
  if (known.length) opts.onPartial?.(known);

  // Pages for things the feed or markup didn't already give with a photo.
  const have = new Set(known.filter((c) => c.images.length && c.url).map((c) => c.url));
  const pages: CatalogLink[] = catalogLinks(pool, base, MAX_DISCOVERED * 2)
    .filter((l) => !have.has(l.url) && !(fromFeed.length && l.kind === "product"))
    .slice(0, MAX_DISCOVERED);
  const found = await pooled(pages, PAGE_CONCURRENCY, async (link) => {
    const html = await deps.fetchPage(link.url).catch(() => "");
    if (!html) return [];
    const marked = catalogFromJsonLd(extractJsonLd(html), link.url);
    // The page's own Product/Service markup wins; the page fills the gaps.
    const own = marked.find((c) => c.url === link.url) ?? marked[0];
    const page = toCandidate(parseProductPage(html, link.url), link.kind);
    if (!own || !page) return own ? [own] : page ? [page] : [];
    return [
      {
        ...own,
        url: link.url,
        fingerprint: page.fingerprint,
        description: own.description || page.description,
        price: own.price || page.price,
        category: own.category || page.category,
        images: own.images.length ? own.images : page.images,
      },
    ];
  });
  return dedupeCandidates([...fromFeed, ...fromMarkup, ...found.flat()]);
}

export async function discoverProducts(
  origin: URL,
  links: string[],
  deps: DiscoverDeps = defaultDeps,
  budgetMs = BUDGET_MS,
  opts: DiscoverOptions = {},
): Promise<ProductCandidate[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // What was known when the budget ran out is still worth keeping.
  let partial: ProductCandidate[] = [];
  const withPartial: DiscoverOptions = {
    ...opts,
    onPartial: (p) => {
      partial = p;
      opts.onPartial?.(p);
    },
  };
  const timeout = new Promise<ProductCandidate[]>((resolve) => {
    timer = setTimeout(() => resolve(partial), budgetMs);
  });
  try {
    return await Promise.race([
      discover(origin, links, deps, withPartial).catch(() => partial),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
