// brand-extract-events.ts — the NDJSON event contract streamed by
// POST /api/brand-extract. Client-safe (no server imports) so the extraction
// pipeline and the UIs that consume it share one definition.
//
// Consumers must ignore event types they do not recognise: `discovery` was
// added after `progress | result | error`, and older readers skip it.

/** What the homepage itself revealed, sent as soon as it is fetched. */
export type SiteDiscovery = {
  hostname: string;
  siteName: string;
  title: string;
  description: string;
  themeColor: string | null;
  faviconUrl: string | null;
  logoUrl: string | null;
  ogImageUrl: string | null;
};

/** Internal pages chosen for the crawl. */
export type PagesDiscovery = {
  paths: string[];
  sitemapUrls: number;
};

/** Raw visual and structural signals detected across every crawled page. */
export type IdentityDiscovery = {
  /** Hex colors by frequency, before AI curation. */
  colors: string[];
  fonts: string[];
  structuredData: number;
  headings: number;
  socialPlatforms: string[];
};

/** External web research. */
export type MarketDiscovery = {
  mentions: number;
  about: number;
  competitors: number;
  reviews: number;
};

export type BrandExtractDiscovery =
  | { type: "discovery"; kind: "site"; data: SiteDiscovery }
  | { type: "discovery"; kind: "pages"; data: PagesDiscovery }
  | { type: "discovery"; kind: "identity"; data: IdentityDiscovery }
  | { type: "discovery"; kind: "market"; data: MarketDiscovery };

export type BrandExtractProgress = {
  type: "progress";
  stage: string;
  message: string;
  pct: number;
};

export type BrandExtractEvent =
  | BrandExtractProgress
  | BrandExtractDiscovery
  | { type: "error"; stage: string; code: string | undefined; error: string }
  | { type: "result"; data: unknown };

export type Discoveries = {
  site?: SiteDiscovery;
  pages?: PagesDiscovery;
  identity?: IdentityDiscovery;
  market?: MarketDiscovery;
};

/**
 * The `result` payload as a client should treat it: every field optional,
 * because it crossed the network and the model may have left gaps.
 */
export type BrandExtractResult = {
  brandName?: string;
  oneLiner?: string;
  about?: string;
  industry?: string;
  businessModel?: string;
  audience?: string;
  voice?: string;
  values?: string;
  products?: string;
  doRules?: string;
  dontRules?: string;
  mission?: string;
  vision?: string;
  positioning?: string;
  uniqueValueProp?: string;
  audienceTags?: string[];
  valueTags?: string[];
  keywords?: string[];
  colors?: { name: string; hex: string }[];
  fonts?: string[];
  logoUrl?: string | null;
  faviconUrl?: string | null;
  socials?: { platform: string; url: string }[];
  missing?: string[];
  competitors?: {
    name: string;
    url?: string;
    positioning?: string;
    strengths?: string;
    weaknesses?: string;
    notes?: string;
  }[];
  customerSignals?: Partial<
    Record<
      | "jobsToBeDone"
      | "painPoints"
      | "objections"
      | "buyingTriggers"
      | "decisionCriteria"
      | "channels"
      | "feedback",
      string
    >
  >;
  insights?: { title: string; body: string }[];
  sources?: Record<string, { label: string; snippet?: string; url?: string }>;
  extras?: {
    emails?: string[];
    phones?: string[];
    headings?: string[];
    pagesCrawled?: string[];
    externalMentions?: { bucket: string; title: string; url: string; snippet: string }[];
  };
};
