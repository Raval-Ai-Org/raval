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
  /** Headline of the first Article-like node (absent on analyses stored before v2 rules). */
  headline?: string | null;
  /** Required properties missing from top-level nodes, e.g. `Article: author`. */
  issues?: string[];
  /** Top-level types that were checked for required properties. */
  checkedTypes?: string[];
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
  /** Snippet controls. Absent on analyses stored before these checks existed. */
  snippet?: {
    /** `max-snippet:N` from meta robots; null when not set. */
    maxSnippet: number | null;
    /** Words inside `data-nosnippet` elements. */
    nosnippetWords: number;
  };
  /** Structured data that says something the visible page doesn't. */
  schemaMismatches?: string[];
  /** Quotations on the page (`<blockquote>`, `<q>`). */
  quotes?: number;
  /** Bytes of inline `<script>` payload (framework data), excluded from size checks. */
  inlineScriptBytes?: number;
  /**
   * How the page was read. Absent on pages whose server HTML was used as-is
   * without needing a decision (and on analyses stored before rendering).
   * mode "browser": content fields come from the rendered DOM; bytes, ratio
   * and httpWords still describe the raw server HTML crawlers download.
   */
  rendering?: PageRendering;
};

export type PageRendering = {
  mode: "http" | "browser";
  reason: string;
  httpWords: number;
  renderedWords: number | null;
  markers: string[];
  ms?: number;
};

/* ───────────────────────── Site + crawl records ───────────────────────── */

export type SiteArtifacts = {
  origin: string;
  host: string;
  https: boolean;
  robots: { status: "found" | "missing" | "error"; text: string; sitemaps: string[] };
  llms: {
    found: boolean;
    bytes: number;
    full: boolean;
    /** Problems against the llmstxt.org format. Absent on older scans. */
    issues?: string[];
    /** Links the file lists (capped). */
    links?: string[];
  };
  sitemap: {
    found: boolean;
    urls: number;
    isIndex: boolean;
    sources: string[];
    /** URL entries that carry a `<lastmod>`. Absent on older scans. */
    withLastmod?: number;
    /** Same-site paths listed (capped at `SITEMAP_PATH_CAP`), for coverage checks. */
    paths?: string[];
  };
  /**
   * What answer-engine crawlers got when the homepage was requested with their
   * user agent. A refusal here is a strong hint, not proof: a firewall may turn
   * away a look-alike and still let the real crawler in.
   */
  botAccess?: {
    baselineStatus: number | null;
    checks: { bot: string; status: number | null; blocked: boolean; reason: string | null }[];
  };
  /** Agent-facing extras. Reported, never scored. */
  agent?: {
    markdown: boolean;
    contentSignals: Record<string, string> | null;
    llmsFull: boolean;
  };
};

export const SITEMAP_PATH_CAP = 2000;

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
  evidence?: RuleEvidence;
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
  /** Blocked training crawlers: the owner's choice, not counted against the site. */
  trainingBlocked?: string[];
};

/** How strong the evidence is that a check affects AI answers. */
export type RuleEvidence = "documented" | "measured" | "emerging";

/** Who can close a gap: Mellox alone, Mellox after one answer, or the owner. */
export type FixRoute = "auto" | "needs_input" | "manual";

export type PathStep = {
  ruleId: string;
  title: string;
  points: number;
  affectedPages: number;
  route: FixRoute;
};

export type PathTo100 = {
  /** Points available by route; the three add up to 100 − overall (± rounding). */
  auto: number;
  needsInput: number;
  manual: number;
  steps: PathStep[];
};

export type DimensionSummary = {
  id: string;
  name: string;
  question: string;
  /** null when no applicable check fed this dimension. */
  score: number | null;
  failed: number;
  warned: number;
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
  /** Browser-rendering use in this scan (absent on older scans). */
  rendering?: { available: boolean; reason: string; rendered: number; needed: number };
  /** 2 = tiered crawlers, page-type applicability, single rounding. Absent = 1. */
  scoreVersion?: number;
  dimensions?: DimensionSummary[];
  pathTo100?: PathTo100;
  agent?: SiteArtifacts["agent"];
};
