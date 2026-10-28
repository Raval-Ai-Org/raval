// Product discovery during a Brand DNA scan (ADR-0035). No model call: it
// reads the site's own product data and returns candidates a person keeps or
// drops in onboarding. Every request goes through the SSRF guard.
//
//   1. Shopify's public feed (`/products.json`), when the store has one.
//   2. Otherwise up to ten product pages, read for schema.org Product markup.
//
// Never throws and never runs past its budget: no products is a fact.
import "server-only";
import {
  MAX_DISCOVERED,
  dedupeCandidates,
  parseShopifyProducts,
  productLinks,
  toCandidate,
  type ProductCandidate,
} from "@/lib/products/catalog";
import { parseProductPage } from "@/lib/ugc/product-page";
import { fetchPublicText, safeFetch } from "@/server/safe-fetch";

const USER_AGENT = "Mozilla/5.0 MelloxBrandBot";
const BUDGET_MS = 8_000;

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
        maxBytes: 2 * 1024 * 1024,
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

async function discover(
  origin: URL,
  links: string[],
  deps: DiscoverDeps,
): Promise<ProductCandidate[]> {
  const feed = await deps.fetchJson(
    new URL(`/products.json?limit=${MAX_DISCOVERED}`, origin).toString(),
  );
  const fromFeed = feed ? parseShopifyProducts(feed, origin.origin) : [];
  if (fromFeed.length) return dedupeCandidates(fromFeed);

  const pages = productLinks(links, origin.toString());
  const htmls = await Promise.all(pages.map((u) => deps.fetchPage(u).catch(() => "")));
  const found = htmls
    .map((html, i) => (html ? toCandidate(parseProductPage(html, pages[i])) : null))
    .filter((c): c is ProductCandidate => !!c);
  return dedupeCandidates(found);
}

export async function discoverProducts(
  origin: URL,
  links: string[],
  deps: DiscoverDeps = defaultDeps,
  budgetMs = BUDGET_MS,
): Promise<ProductCandidate[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProductCandidate[]>((resolve) => {
    timer = setTimeout(() => resolve([]), budgetMs);
  });
  try {
    return await Promise.race([discover(origin, links, deps).catch(() => []), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
