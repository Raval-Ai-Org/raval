// types.ts — the typed contracts of Mellox AI Visibility (GEO / AEO / SEO
// intelligence). Shared by the pure engine (src/lib/geo), the scan worker
// (src/server/geo) and the UI (src/components/app/geo), so everything here is
// plain data: no functions that touch I/O, safe to import from the browser.

/* ───────────────────────── Scoring vocabulary ───────────────────────── */

export type GeoCategoryId =
  "ai_access" | "technical" | "structured_data" | "content" | "authority" | "performance";

export type GeoCategoryMeta = {
  id: GeoCategoryId;
  name: string;
  short: string;
  /** Share of the overall score. The six weights sum to 1. */
  weight: number;
  blurb: string;
};

export const GEO_CATEGORIES: readonly GeoCategoryMeta[] = [
  {
    id: "ai_access",
    name: "AI engine access",
    short: "AI access",
    weight: 0.2,
    blurb: "Whether ChatGPT, Claude, Gemini and Perplexity are allowed to read your site.",
  },
  {
    id: "technical",
    name: "Technical & indexability",
    short: "Technical",
    weight: 0.2,
    blurb: "Status codes, canonicals, sitemaps and the metadata search and answer engines index.",
  },
  {
    id: "structured_data",
    name: "Structured data & entities",
    short: "Schema",
    weight: 0.15,
    blurb: "Schema.org markup that lets engines resolve your brand and quote you with confidence.",
  },
  {
    id: "content",
    name: "Answer-ready content",
    short: "Content",
    weight: 0.2,
    blurb: "Structure, questions, direct answers and topical focus that answer engines extract.",
  },
  {
    id: "authority",
    name: "Authority & trust",
    short: "Trust",
    weight: 0.2,
    blurb: "First-party identity, authorship, sourcing and claims engines weigh before citing.",
  },
  {
    id: "performance",
    name: "Rendering & performance",
    short: "Rendering",
    weight: 0.05,
    blurb: "Server-rendered text, payload size and response time for crawlers that skip JS.",
  },
];

export const CATEGORY_BY_ID: Record<GeoCategoryId, GeoCategoryMeta> = Object.fromEntries(
  GEO_CATEGORIES.map((c) => [c.id, c]),
) as Record<GeoCategoryId, GeoCategoryMeta>;

/** pass = full credit, warn = half, fail = none, na = excluded from the score. */
export type RuleStatus = "pass" | "warn" | "fail" | "na";
export type Severity = "critical" | "high" | "medium" | "low";
export type Priority = "critical" | "high" | "medium" | "low";
/** From the GEO module's fix-safety classifier: who may apply a fix. */
export type FixSafety = "auto_safe" | "assisted" | "manual_review";
export type Effort = "low" | "medium" | "high";
export type RuleScope = "site" | "page";

/* ───────────────────────── Page analysis ───────────────────────── */

export type LinkRef = { href: string; text: string; rel?: string };

export type SchemaOrganization = {
  name: string;
  types: string[];
  sameAs: string[];
  hasLogo: boolean;
  hasAddress: boolean;
  hasContactPoint: boolean;
};

export type SchemaAuthor = {
  name: string;
  jobTitle: string | null;
  url: string | null;
  sameAs: string[];
};

export type SchemaSummary = {
  blocks: number;
  parseErrors: number;
  types: string[];
  names: string[];
  organizations: SchemaOrganization[];
  authors: SchemaAuthor[];
  publisherName: string | null;
  datePublished: string | null;
  dateModified: string | null;
  faq: { question: string; answer: string }[];
  hasBreadcrumbList: boolean;
  hasWebSite: boolean;
  hasAddress: boolean;
};

export type QuestionItem = {
  text: string;
  source: "heading" | "body" | "faq_schema";
  answered: boolean;
  answerWords: number;
  direct: boolean;
};

export type EntityItem = {
  name: string;
  type: string;
  sources: ("structured_data" | "content")[];
  sameAs: number;
  inTitle: boolean;
  inH1: boolean;
};

export type PageType =
  "home" | "article" | "product" | "contact" | "about" | "legal" | "listing" | "other";

/**
 * Everything the rules need to know about one crawled page. Stored as JSON on
 * geo_scan_pages.extraction — raw HTML is never persisted, so a page can be
 * re-scored from this record alone. `v` versions the shape.
 */
export type PageAnalysis = {
  v: 1;
  url: string;
  pageType: PageType;
  bytes: number;
  truncated: boolean;
  lang: string | null;
  charset: boolean;
  viewport: boolean;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  robotsMeta: { raw: string; noindex: boolean; nofollow: boolean; nosnippet: boolean } | null;
  canonicals: string[];
  headings: { level: number; text: string }[];
  h1Count: number;
  hierarchyIssues: string[];
  landmarks: string[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  schema: SchemaSummary;
  microdataTypes: string[];
  hasBreadcrumbNav: boolean;
  images: { total: number; missingAlt: number; emptyAlt: number };
  links: { internal: LinkRef[]; external: LinkRef[]; mailto: string[]; tel: number };
  hreflang: { lang: string; href: string }[];
  hreflangConflict: boolean;
  text: {
    words: number;
    paragraphs: number;
    textToHtmlRatio: number;
    mainSource: "main" | "article" | "role_main" | "body" | "none";
    excerpt: string;
  };
  structure: {
    sections: number;
    emptySections: string[];
    thinSections: string[];
    longParagraphs: number;
    lists: number;
    repeatedHeadings: string[];
    hierarchyValid: boolean;
  };
  titleH1Aligned: boolean | null;
  questions: {
    items: QuestionItem[];
    total: number;
    answered: number;
    direct: number;
    unansweredHeadings: string[];
    faqSchema: boolean;
  };
  topic: {
    primary: string | null;
    confidence: number;
    supporting: string[];
    inTitle: boolean;
    inH1: boolean;
    lexicalDiversity: number;
    depth: "thin" | "moderate" | "deep";
    stuffing: { term: string; density: number } | null;
  };
  entities: { items: EntityItem[]; hasOrganization: boolean; consistencyIssues: string[] };
  readiness: {
    score: number;
    level: "high" | "moderate" | "low";
    components: { qa: number; structure: number; semantic: number; entity: number };
    positives: string[];
    negatives: string[];
  };
  semanticCoverage: {
    score: number;
    level: "comprehensive" | "moderate" | "narrow";
    gaps: string[];
  };
  trust: {
    aboutLink: string | null;
    contactLink: string | null;
    privacyLink: string | null;
    termsLink: string | null;
    editorialLink: string | null;
    emails: string[];
    phones: number;
    hasAddress: boolean;
    byline: string | null;
    credentials: string[];
    reviewer: string | null;
    copyrightName: string | null;
    siteName: string | null;
    ownershipStatement: boolean;
    datePublished: string | null;
    dateModified: string | null;
  };
  claims: {
    statistical: number;
    statisticalUnsupported: number;
    superlativeUnsupported: number;
    comparative: number;
    samples: string[];
  };
  sources: {
    external: number;
    citationCandidates: number;
    primary: number;
    weakAnchors: number;
    affiliate: number;
    social: number;
    referenceSection: boolean;
  };
};

/* ───────────────────────── Site + crawl records ───────────────────────── */

export type SiteArtifacts = {
  origin: string;
  host: string;
  https: boolean;
  robots: { status: "found" | "missing" | "error"; text: string; sitemaps: string[] };
  llms: { found: boolean; bytes: number; full: boolean };
  sitemap: { found: boolean; urls: number; isIndex: boolean; sources: string[] };
};

export type PageState = "pending" | "fetched" | "failed" | "skipped";

/** A crawled page as the rules see it. */
export type CrawledPage = {
  url: string;
  finalUrl: string | null;
  depth: number;
  state: PageState;
  statusCode: number | null;
  contentType: string | null;
  fetchMs: number | null;
  skipReason: string | null;
  xRobotsTag: string | null;
  analysis: PageAnalysis | null;
};

/* ───────────────────────── Results ───────────────────────── */

export type RuleOutcome = {
  status: RuleStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};

export type GeoFinding = {
  ruleId: string;
  category: GeoCategoryId;
  status: "warn" | "fail";
  severity: Severity;
  priority: Priority;
  /** 0..1 — the GEO module's impact / confidence / effort composite. */
  priorityScore: number;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  /** null for site-wide findings. */
  pageUrl: string | null;
  /** Stable across scans: rule + host + path. Keys workflow state and scan comparison. */
  fingerprint: string;
  /** Overall score points this finding costs (positive). */
  pointImpact: number;
  fixId: string | null;
  safety: FixSafety;
  effort: Effort;
};

export type RuleSummary = {
  ruleId: string;
  category: GeoCategoryId;
  scope: RuleScope;
  title: string;
  weight: number;
  status: RuleStatus;
  /** Achieved share of the rule's weight, 0..1 (mean over applicable pages). */
  credit: number;
  applicable: number;
  passed: number;
  warned: number;
  failed: number;
  /** Overall score points lost to this rule (positive). */
  pointsLost: number;
  detail: string;
};

export type CategoryScore = {
  id: GeoCategoryId;
  name: string;
  weight: number;
  score: number;
  passed: number;
  warned: number;
  failed: number;
  na: number;
  rules: RuleSummary[];
};

export type GeoAction = {
  ruleId: string;
  category: GeoCategoryId;
  priority: Priority;
  priorityScore: number;
  title: string;
  detail: string;
  affectedPages: number;
  pointsLost: number;
  fixId: string | null;
  safety: FixSafety;
  effort: Effort;
};

export type EngineState = "open" | "partial" | "blocked" | "unknown";
export type EngineAccess = {
  id: string;
  name: string;
  state: EngineState;
  bots: string[];
  blocked: string[];
};

export type ScoreTier = "strong" | "workable" | "needs_work";

export type ScanReport = {
  overall: number;
  tier: ScoreTier;
  categories: CategoryScore[];
  actions: GeoAction[];
  engines: EngineAccess[];
  counts: {
    pagesCrawled: number;
    pagesFailed: number;
    pagesSkipped: number;
    passed: number;
    warned: number;
    failed: number;
    findings: number;
  };
  snapshot: {
    title: string | null;
    description: string | null;
    schemaTypes: string[];
    words: number;
    sitemapUrls: number;
    llmsTxt: boolean;
  };
  pageScores: { url: string; score: number; categories: Partial<Record<GeoCategoryId, number>> }[];
};
