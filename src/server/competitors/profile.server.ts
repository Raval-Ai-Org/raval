// profile.server.ts — "who are they, and what do they do?"
//
// Two sources, deliberately: the competitor's own site says what they want to
// be seen as, and third-party coverage says what the market sees. Mellox reads
// both and keeps the URL for every claim, so the Competitors surface can show
// where a statement came from instead of asking the user to trust it.
import "server-only";
import {
  fetchCompetitorPages,
  synthesizeCompetitorProfile,
} from "@/server/research/competitor-intel.server";
import { webSearchMany } from "@/server/research/web-search.server";
import { dedupeSources, hostOf, isAggregatorSource } from "@/lib/research/sources";
import type { CompetitorProfile } from "@/lib/competitors/contracts";

/** Pages worth reading on almost any company site, when a crawler can't find them for us. */
const COMMON_PATHS = ["/about", "/pricing", "/products", "/features"];

export type ProfileInput = {
  name: string;
  domain: string;
  url: string;
};

/**
 * Research one competitor end to end. Throws only when there is genuinely
 * nothing to work from; a missing coverage pass or a failed sub-page is
 * absorbed, because a partial grounded profile beats no profile.
 */
export async function buildCompetitorProfile(input: ProfileInput): Promise<CompetitorProfile> {
  const baseUrl = input.url || `https://${input.domain}`;

  // Coverage search and page discovery run together: the search also tells us
  // which of the competitor's own pages the world considers worth reading,
  // which is exactly what the Tavily extract fallback needs.
  const [coverage, discovered] = await Promise.all([
    webSearchMany(
      [
        `${input.name} ${input.domain} review`,
        `${input.name} pricing`,
        `${input.name} founded headquarters company`,
        `what does ${input.name} do`,
      ],
      { limit: 12, perHost: 2, route: "competitors.profile" },
    ).catch(() => []),
    webSearchMany([`${input.name} about pricing product site:${input.domain}`], {
      limit: 8,
      perHost: 8,
      route: "competitors.profile",
    }).catch(() => []),
  ]);

  const ownPageUrls = [
    ...discovered.filter((source) => hostOf(source.url) === input.domain).map((s) => s.url),
    ...COMMON_PATHS.map((path) => `${baseUrl.replace(/\/+$/, "")}${path}`),
  ];

  const { pages, provider } = await fetchCompetitorPages(baseUrl, {
    extraUrls: [...new Set(ownPageUrls)].slice(0, 6),
  });

  if (!pages.length) {
    throw new Error(
      "Could not read anything from this website. It may block automated readers, or web research is not configured.",
    );
  }

  // Only genuinely third-party coverage informs the profile — quoting the
  // competitor's own blog back as "coverage" would be circular.
  const thirdParty = dedupeSources(
    coverage.filter((source) => hostOf(source.url) !== input.domain),
    { perHost: 1, limit: 6 },
  );

  const result = await synthesizeCompetitorProfile(baseUrl, pages, {
    webSources: thirdParty,
    contentProvider: provider,
  });

  return {
    summary: result.summary,
    products: result.products,
    targetCustomers: result.targetCustomers || result.targetAudience,
    companyFacts: result.companyFacts,
    positioning: result.positioning,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    pricingSignals: result.pricingSignals,
    differentiators: result.differentiators,
    contentThemes: result.contentThemes,
    evidence: result.evidence,
    pagesRead: result.pagesCrawled,
    sources: thirdParty.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet.slice(0, 300),
      // An aggregator is a fine source for coverage even though it is never a
      // competitor candidate; the distinction lives in sources.ts.
    })),
    contentProvider: result.contentProvider,
  };
}

/** True when a coverage source is a listing site rather than a publication. */
export function isListingSource(url: string): boolean {
  return isAggregatorSource(url);
}
