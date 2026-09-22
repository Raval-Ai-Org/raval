// Ranking placements from the provider catalog. Pure and deterministic, so the
// ordering a user sees can be reproduced and argued with.
//
// Everything here is computed from numbers the provider actually returns. There
// is no invented authority figure and no fabricated traffic estimate: the
// catalog carries a Domain Rating, a referring-domain count, a backlink count,
// an internal rank and a count of keywords the site ranks for, and that is all.
// Topical fit is a separate, explicitly labelled judgement (see match.server.ts)
// because the catalog has no dependable category data.

export type DonorSignals = {
  id: number;
  domain: string;
  ext: string | null;
  page: string | null;
  priceUsd: number;
  dr: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  dfsRank: number | null;
  /** Keywords the site ranks for. A demand signal, NOT a visit count. */
  top100: number | null;
  cat: string | null;
};

export type ScoredDonor = DonorSignals & { score: number };

/** Weights sum to exactly 1. A test enforces it. */
export const WEIGHTS = {
  authority: 0.38,
  reach: 0.22,
  demand: 0.18,
  value: 0.12,
  trust: 0.1,
} as const;

/**
 * Link-farm and throwaway TLDs. A placement here is worth less than nothing —
 * it can actively harm the site it points at.
 */
export const BLOCKED_TLDS = new Set([
  "xyz",
  "top",
  "loan",
  "click",
  "work",
  "gq",
  "cf",
  "ml",
  "ga",
  "tk",
  "buzz",
  "rest",
  "bid",
  "win",
  "download",
  "stream",
  "racing",
  "date",
]);

/**
 * Hosts that serve files or user uploads rather than articles. The catalog
 * genuinely contains these (object storage, CDN buckets, image hosts) and they
 * carry impressive authority numbers, but a link on one is not an editorial
 * placement and Mellox will not sell it as one.
 */
export const NON_EDITORIAL_HOSTS = [
  "storage.googleapis.com",
  "storage.yandexcloud.net",
  "usercontent.one",
  "s3.amazonaws.com",
  "blob.core.windows.net",
  "cdn.shopify.com",
  "googleusercontent.com",
  "cloudfront.net",
  "firebasestorage.app",
  "objects-us-east-1.dream.io",
];

/** A file extension at the end of the sample page means it is not an article. */
const FILE_PAGE = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?)(\?|$)/i;

export type Disqualification =
  "own_site" | "blocked_tld" | "non_editorial_host" | "file_page" | "no_price";

/**
 * Reasons a placement is never offered. Returning the reason rather than a
 * boolean means the UI can say why a domain the user searched for is missing.
 */
export function disqualify(
  donor: DonorSignals,
  ownDomain?: string | null,
): Disqualification | null {
  const domain = donor.domain.toLowerCase();

  if (ownDomain) {
    const own = ownDomain.toLowerCase().replace(/^www\./, "");
    const bare = domain.replace(/^www\./, "");
    if (bare === own || bare.endsWith(`.${own}`)) return "own_site";
  }
  if (donor.ext && BLOCKED_TLDS.has(donor.ext.toLowerCase())) return "blocked_tld";
  if (NON_EDITORIAL_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`))) {
    return "non_editorial_host";
  }
  if (donor.page && FILE_PAGE.test(donor.page)) return "file_page";
  if (!Number.isFinite(donor.priceUsd) || donor.priceUsd <= 0) return "no_price";
  return null;
}

/** Maps a long-tailed count onto 0..1. Doubling the input adds a fixed amount. */
function logScale(value: number | null, ceiling: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  const scaled = Math.log10(1 + value) / Math.log10(1 + ceiling);
  return Math.max(0, Math.min(1, scaled));
}

function authorityScore(donor: DonorSignals): number {
  // Domain Rating is the better signal when present. The provider's own rank
  // is a fallback, not an average: blending an unrated site's 0 with its rank
  // would invent a rating it does not have.
  if (donor.dr !== null) return Math.max(0, Math.min(1, donor.dr / 100));
  return logScale(donor.dfsRank, 1000);
}

/**
 * Price relative to the cheapest thing on offer. At a flat catalog price this
 * is constant and contributes nothing to the ordering, which is correct.
 */
function valueScore(priceUsd: number, cheapestUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;
  const floor = cheapestUsd > 0 ? cheapestUsd : priceUsd;
  return Math.max(0, Math.min(1, floor / priceUsd));
}

function trustScore(donor: DonorSignals): number {
  let score = 1;
  // A site with a lot of backlinks but very few referring domains is usually
  // being linked to sitewide from a handful of places, which is a weaker
  // signal than the raw count suggests.
  const refs = donor.referringDomains ?? 0;
  const links = donor.backlinks ?? 0;
  if (refs > 0 && links / refs > 5000) score -= 0.4;
  if (donor.dr !== null && donor.dr === 0) score -= 0.3;
  if (!donor.cat) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

export function scoreDonor(donor: DonorSignals, cheapestUsd: number): number {
  const raw =
    WEIGHTS.authority * authorityScore(donor) +
    WEIGHTS.reach * logScale(donor.referringDomains, 100_000) +
    WEIGHTS.demand * logScale(donor.top100, 50_000) +
    WEIGHTS.value * valueScore(donor.priceUsd, cheapestUsd) +
    WEIGHTS.trust * trustScore(donor);
  return Math.round(raw * 10_000) / 100;
}

export function rankDonors(
  donors: DonorSignals[],
  options: { ownDomain?: string | null; limit?: number } = {},
): ScoredDonor[] {
  const eligible = donors.filter((donor) => disqualify(donor, options.ownDomain) === null);
  const cheapest = eligible.reduce(
    (min, donor) => (donor.priceUsd > 0 && donor.priceUsd < min ? donor.priceUsd : min),
    Number.POSITIVE_INFINITY,
  );
  const floor = Number.isFinite(cheapest) ? cheapest : 0;

  // One placement per domain: the catalog lists several sample pages for the
  // same site and offering them as separate options would be misleading.
  const best = new Map<string, ScoredDonor>();
  for (const donor of eligible) {
    const scored: ScoredDonor = { ...donor, score: scoreDonor(donor, floor) };
    const existing = best.get(donor.domain);
    if (!existing || scored.score > existing.score) best.set(donor.domain, scored);
  }

  const ordered = [...best.values()].sort(
    (a, b) => b.score - a.score || a.priceUsd - b.priceUsd || a.domain.localeCompare(b.domain),
  );
  return typeof options.limit === "number" ? ordered.slice(0, options.limit) : ordered;
}

export type QualityBand = "strong" | "solid" | "modest";

export function qualityBand(score: number): QualityBand {
  if (score >= 62) return "strong";
  if (score >= 42) return "solid";
  return "modest";
}

export const QUALITY_LABELS: Record<QualityBand, string> = {
  strong: "Strong site",
  solid: "Solid site",
  modest: "Smaller site",
};

export const DISQUALIFY_REASONS: Record<Disqualification, string> = {
  own_site: "This is your own website.",
  blocked_tld: "This domain uses an extension that search engines distrust.",
  non_editorial_host: "This is a file host, not a site that publishes articles.",
  file_page: "The only page available here is a file, not an article.",
  no_price: "This site has no price right now.",
};

/**
 * The facts a card shows, in the provider's own terms. Deliberately returns
 * nulls rather than zeros so the UI can omit a figure it does not have instead
 * of showing a confident "0".
 */
export type DonorFacts = {
  authority: number | null;
  referringDomains: number | null;
  rankingKeywords: number | null;
  category: string | null;
};

export function donorFacts(donor: DonorSignals): DonorFacts {
  return {
    authority: donor.dr,
    referringDomains: donor.referringDomains,
    rankingKeywords: donor.top100,
    category: donor.cat,
  };
}
