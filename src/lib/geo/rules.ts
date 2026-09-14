// rules.ts — the AI Visibility rule catalog.
//
// Merges the original Mellox 45-point audit (AI crawler access, schema,
// crawlability, answer-ready content, trust, rendering) with the GEO module's
// rule sets (content AEO rules R-STR/R-QNA/R-TOP, trust / authority / claim /
// source engines, technical extraction flags). Each rule is pure: it reads a
// PageAnalysis or the site artifacts and returns pass / warn / fail / na with a
// human-readable detail and evidence. Scoring lives in score.ts.
//
// Rule ids are stable — findings, workflow state and scan comparisons key off
// them. Add new rules; don't rename existing ones.

import { AI_BOTS, parseRobotsAllow } from "./robots";
import type {
  CrawledPage,
  Effort,
  FixSafety,
  GeoCategoryId,
  PageAnalysis,
  RuleOutcome,
  Severity,
  SiteArtifacts,
} from "./types";

export type ScanMode = "quick" | "full";

export type SiteContext = {
  site: SiteArtifacts;
  mode: ScanMode;
  pages: CrawledPage[];
  /** Fetched HTML pages with an analysis and a non-error status. */
  analyzed: { page: CrawledPage; a: PageAnalysis }[];
  home: { page: CrawledPage; a: PageAnalysis } | null;
  statusByUrl: Map<string, number | null>;
  titleCounts: Map<string, number>;
  descriptionCounts: Map<string, number>;
};

export type PageContext = { page: CrawledPage; a: PageAnalysis; site: SiteContext };

type BaseRule = {
  id: string;
  category: GeoCategoryId;
  title: string;
  /** Relative weight inside its category. */
  weight: number;
  /** Severity when the rule fails; a warning is one level lower. */
  severity: Severity;
  /** The action shown in "Fix next". */
  recommendation: string;
  /** Rules sharing an actionKey collapse into one recommended action. */
  actionKey?: string;
  fixId: string | null;
  safety: FixSafety;
  effort: Effort;
  /** 0..1 — how reliable the heuristic is (feeds prioritisation). */
  confidence: number;
};

export type SiteRule = BaseRule & { scope: "site"; evaluate: (ctx: SiteContext) => RuleOutcome };
export type PageRule = BaseRule & { scope: "page"; evaluate: (ctx: PageContext) => RuleOutcome };
export type GeoRule = SiteRule | PageRule;

const pass = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "pass",
  detail,
  evidence,
});
const warn = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "warn",
  detail,
  evidence,
});
const fail = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "fail",
  detail,
  evidence,
});
const na = (detail: string): RuleOutcome => ({ status: "na", detail });

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const isContentPage = (a: PageAnalysis) => a.pageType !== "legal" && a.pageType !== "contact";
const isArticle = (a: PageAnalysis) => a.pageType === "article";

/* ───────────────────────── AI engine access ───────────────────────── */

const botRules: SiteRule[] = AI_BOTS.map((bot) => ({
  id: `ai.bot.${bot.id.toLowerCase()}`,
  scope: "site",
  category: "ai_access",
  title: `${bot.id} can crawl`,
  weight: 2,
  severity: "high",
  recommendation: "Unblock AI crawlers in robots.txt",
  actionKey: "ai.bots",
  fixId: "bots",
  safety: "auto_safe",
  effort: "low",
  confidence: 0.95,
  evaluate: ({ site }) => {
    if (site.robots.status !== "found") {
      return na(`No robots.txt — ${bot.who} is allowed by default.`);
    }
    const verdict = parseRobotsAllow(site.robots.text, bot.id);
    return verdict === "block"
      ? fail(`Blocked in robots.txt — ${bot.who} can't read your site.`, { bot: bot.id })
      : pass(`${bot.who} can crawl.`, { bot: bot.id });
  },
}));

const aiAccess: GeoRule[] = [
  {
    id: "ai.robots_txt",
    scope: "site",
    category: "ai_access",
    title: "robots.txt published",
    weight: 4,
    severity: "medium",
    recommendation: "Publish robots.txt",
    fixId: "robots",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ site }) =>
      site.robots.status === "found"
        ? pass(`Found at ${site.origin}/robots.txt.`)
        : site.robots.status === "error"
          ? warn("robots.txt could not be fetched — crawlers treat that as unknown rules.")
          : warn("No robots.txt — engines have to guess your crawl rules."),
  },
  {
    id: "ai.llms_txt",
    scope: "site",
    category: "ai_access",
    title: "llms.txt for AI crawlers",
    weight: 5,
    severity: "high",
    recommendation: "Publish /llms.txt",
    fixId: "llms",
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ site }) =>
      site.llms.found
        ? pass(
            `Found at ${site.origin}/llms.txt${site.llms.full ? " (plus llms-full.txt)" : ""}.`,
            { bytes: site.llms.bytes },
          )
        : warn("Missing — add /llms.txt so LLMs know which pages are your canonical sources."),
  },
  ...botRules,
];

/* ───────────────────────── Technical & indexability ───────────────────────── */

const technical: GeoRule[] = [
  {
    id: "tech.https",
    scope: "site",
    category: "technical",
    title: "Served over HTTPS",
    weight: 5,
    severity: "high",
    recommendation: "Serve the site over HTTPS",
    fixId: "https",
    safety: "manual_review",
    effort: "medium",
    confidence: 1,
    evaluate: ({ site }) =>
      site.https
        ? pass("Secure scheme.")
        : fail("Not served over HTTPS — most engines deprioritize plain-HTTP sources."),
  },
  {
    id: "tech.sitemap",
    scope: "site",
    category: "technical",
    title: "XML sitemap",
    weight: 4,
    severity: "medium",
    recommendation: "Publish sitemap.xml",
    fixId: "sitemap",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ site }) =>
      site.sitemap.found
        ? pass(
            `${site.sitemap.urls.toLocaleString()} URLs${site.sitemap.isIndex ? " (sitemap index)" : ""}.`,
            { sources: site.sitemap.sources },
          )
        : warn("No valid XML sitemap at /sitemap.xml or in robots.txt."),
  },
  {
    id: "tech.robots_sitemap",
    scope: "site",
    category: "technical",
    title: "Sitemap declared in robots.txt",
    weight: 2,
    severity: "low",
    recommendation: "Declare your sitemap in robots.txt",
    fixId: "robots-sitemap",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ site }) =>
      site.robots.status !== "found"
        ? na("No robots.txt to declare it in.")
        : site.robots.sitemaps.length
          ? pass(`robots.txt advertises ${site.robots.sitemaps.length} sitemap(s).`)
          : warn("Add a `Sitemap:` line so every crawler finds your full URL list."),
  },
  {
    id: "tech.http_errors",
    scope: "site",
    category: "technical",
    title: "Pages load without errors",
    weight: 5,
    severity: "high",
    recommendation: "Fix pages returning errors",
    fixId: "broken-pages",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.95,
    evaluate: ({ pages }) => {
      const attempted = pages.filter((p) => p.state === "fetched" || p.state === "failed");
      if (!attempted.length) return na("No pages were fetched.");
      const broken = attempted.filter((p) => p.state === "failed" || (p.statusCode ?? 0) >= 400);
      const evidence = {
        broken: broken
          .slice(0, 10)
          .map((p) => ({ url: p.url, status: p.statusCode, reason: p.skipReason })),
      };
      if (!broken.length)
        return pass(`All ${attempted.length} crawled pages responded successfully.`);
      const share = broken.length / attempted.length;
      const detail = `${broken.length} of ${attempted.length} crawled pages returned an error or failed to load.`;
      return share > 0.1 ? fail(detail, evidence) : warn(detail, evidence);
    },
  },
  {
    id: "tech.indexable",
    scope: "page",
    category: "technical",
    title: "Indexable (no noindex)",
    weight: 5,
    severity: "critical",
    recommendation: "Remove noindex from pages that should be found",
    fixId: "noindex",
    safety: "manual_review",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a, page }) => {
      const header = (page.xRobotsTag ?? "").toLowerCase();
      if (a.robotsMeta?.noindex || /noindex|none/.test(header)) {
        return fail(
          `Marked noindex (${a.robotsMeta?.noindex ? `meta robots "${a.robotsMeta.raw}"` : `X-Robots-Tag "${page.xRobotsTag}"`}) — engines are told to drop this page.`,
          { meta: a.robotsMeta?.raw ?? null, header: page.xRobotsTag },
        );
      }
      return pass(
        a.robotsMeta ? `Meta robots: ${a.robotsMeta.raw || "(empty)"}` : "Default (index, follow).",
      );
    },
  },
  {
    id: "tech.canonical",
    scope: "page",
    category: "technical",
    title: "Canonical URL",
    weight: 3,
    severity: "medium",
    recommendation: "Add canonical tags",
    fixId: "canonical",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a }) => {
      if (!a.canonicals.length) return warn("No <link rel=canonical>.");
      if (a.canonicals.length > 1) {
        return fail(`${a.canonicals.length} conflicting canonical URLs.`, {
          canonicals: a.canonicals,
        });
      }
      const self = a.canonicals[0].replace(/\/$/, "") === a.url.replace(/\/$/, "");
      return pass(
        self ? "Self-referencing canonical." : `Canonical points to ${a.canonicals[0]}.`,
        {
          canonical: a.canonicals[0],
        },
      );
    },
  },
  {
    id: "tech.title",
    scope: "page",
    category: "technical",
    title: "Title tag",
    weight: 4,
    severity: "high",
    recommendation: "Write a clear title tag",
    fixId: "title",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) => {
      if (!a.title) return fail("Missing <title>.");
      const len = a.title.length;
      if (a.titleCount > 1)
        return warn(`${a.titleCount} <title> tags — engines pick one at random.`);
      if (len < 20 || len > 65) {
        return warn(`"${a.title}" is ${len} characters — aim for 20–65.`, {
          title: a.title,
          length: len,
        });
      }
      return pass(`"${a.title}" · ${len} characters.`);
    },
  },
  {
    id: "tech.duplicate_title",
    scope: "page",
    category: "technical",
    title: "Unique title",
    weight: 2,
    severity: "medium",
    recommendation: "Give every page a unique title",
    fixId: "title",
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a, site }) => {
      if (site.mode === "quick" || !a.title) return na("Needs a multi-page scan.");
      const n = site.titleCounts.get(a.title.toLowerCase()) ?? 1;
      return n > 1
        ? warn(`Shared with ${n - 1} other page(s): "${a.title}".`)
        : pass("Unique in this scan.");
    },
  },
  {
    id: "tech.meta_description",
    scope: "page",
    category: "technical",
    title: "Meta description",
    weight: 3,
    severity: "medium",
    recommendation: "Write quotable meta descriptions",
    fixId: "meta-desc",
    safety: "assisted",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) => {
      if (!a.metaDescription) return fail("Missing meta description.");
      const len = a.metaDescription.length;
      return len < 70 || len > 165
        ? warn(`${len} characters — aim for 70–165 so engines can quote it whole.`)
        : pass(`${len} characters.`);
    },
  },
  {
    id: "tech.duplicate_description",
    scope: "page",
    category: "technical",
    title: "Unique meta description",
    weight: 1,
    severity: "low",
    recommendation: "Give every page a unique meta description",
    fixId: "meta-desc",
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a, site }) => {
      if (site.mode === "quick" || !a.metaDescription) return na("Needs a multi-page scan.");
      const n = site.descriptionCounts.get(a.metaDescription.toLowerCase()) ?? 1;
      return n > 1 ? warn(`Shared with ${n - 1} other page(s).`) : pass("Unique in this scan.");
    },
  },
  {
    id: "tech.lang",
    scope: "page",
    category: "technical",
    title: "Language declared",
    weight: 1,
    severity: "low",
    recommendation: "Declare the page language",
    fixId: "lang",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) =>
      a.lang ? pass(`<html lang="${a.lang}">`) : warn("Missing <html lang=…>."),
  },
  {
    id: "tech.hreflang",
    scope: "page",
    category: "technical",
    title: "hreflang is consistent",
    weight: 1,
    severity: "low",
    recommendation: "Fix conflicting hreflang declarations",
    fixId: null,
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a }) =>
      !a.hreflang.length
        ? na("No hreflang declared (fine for single-locale sites).")
        : a.hreflangConflict
          ? fail("The same language points to different URLs.", {
              hreflang: a.hreflang.slice(0, 10),
            })
          : pass(`${a.hreflang.length} alternates declared.`),
  },
  {
    id: "tech.broken_links",
    scope: "page",
    category: "technical",
    title: "No broken internal links",
    weight: 3,
    severity: "medium",
    recommendation: "Fix broken internal links",
    fixId: "broken-links",
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a, site }) => {
      if (site.mode === "quick") return na("Needs a multi-page scan.");
      const broken = a.links.internal.filter((l) => (site.statusByUrl.get(l.href) ?? 0) >= 400);
      return broken.length
        ? fail(`${broken.length} link(s) to pages that return errors.`, {
            links: broken
              .slice(0, 10)
              .map((l) => ({ href: l.href, text: l.text, status: site.statusByUrl.get(l.href) })),
          })
        : pass("No links to error pages found in this scan.");
    },
  },
  {
    id: "tech.crawl_depth",
    scope: "page",
    category: "technical",
    title: "Reachable within 3 clicks",
    weight: 1,
    severity: "low",
    recommendation: "Link deep pages closer to the homepage",
    fixId: "internal-links",
    safety: "assisted",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ page, site }) =>
      site.mode === "quick"
        ? na("Needs a multi-page scan.")
        : page.depth > 3
          ? warn(
              `Found ${page.depth} links from the homepage — crawlers visit deep pages less often.`,
            )
          : pass(`${page.depth} click(s) from the homepage.`),
  },
];

/* ───────────────────────── Structured data & entities ───────────────────────── */

const structuredData: GeoRule[] = [
  {
    id: "schema.jsonld",
    scope: "page",
    category: "structured_data",
    title: "JSON-LD structured data",
    weight: 6,
    severity: "high",
    recommendation: "Add JSON-LD schema",
    fixId: "ld",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) => {
      const { blocks, parseErrors, types } = a.schema;
      if (!blocks)
        return fail("No JSON-LD — AI engines have nothing structured to ground answers on.");
      if (parseErrors) {
        return warn(`${parseErrors} of ${blocks} JSON-LD block(s) are not valid JSON.`, { types });
      }
      return pass(`${blocks} block(s): ${types.slice(0, 6).join(", ") || "untyped"}.`, { types });
    },
  },
  {
    id: "schema.organization",
    scope: "site",
    category: "structured_data",
    title: "Organization entity",
    weight: 4,
    severity: "medium",
    recommendation: "Add Organization schema",
    fixId: "org-schema",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ home }) => {
      if (!home) return na("Homepage was not analyzed.");
      const org = home.a.schema.organizations[0];
      return org
        ? pass(`${org.types.join(", ")} "${org.name}".`, { organization: org })
        : warn("No Organization / LocalBusiness schema on the homepage.");
    },
  },
  {
    id: "schema.org_sameas",
    scope: "site",
    category: "structured_data",
    title: "Organization linked to profiles (sameAs)",
    weight: 2,
    severity: "low",
    recommendation: "Link your Organization to its official profiles",
    fixId: "org-sameas",
    safety: "manual_review",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ home }) => {
      const org = home?.a.schema.organizations[0];
      if (!org) return na("No Organization schema yet.");
      return org.sameAs.length
        ? pass(`${org.sameAs.length} sameAs profile(s).`, { sameAs: org.sameAs })
        : warn(`"${org.name}" has no sameAs links — engines can't disambiguate the brand.`);
    },
  },
  {
    id: "schema.website",
    scope: "site",
    category: "structured_data",
    title: "WebSite entity",
    weight: 2,
    severity: "low",
    recommendation: "Add WebSite schema",
    fixId: "ld",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ home }) =>
      !home
        ? na("Homepage was not analyzed.")
        : home.a.schema.hasWebSite
          ? pass("WebSite schema found.")
          : warn("No WebSite schema on the homepage."),
  },
  {
    id: "schema.page_type",
    scope: "page",
    category: "structured_data",
    title: "Markup matches the page type",
    weight: 2,
    severity: "medium",
    recommendation: "Mark up articles and products with their schema type",
    fixId: "article-schema",
    safety: "assisted",
    effort: "low",
    confidence: 0.75,
    evaluate: ({ a }) => {
      const types = a.schema.types.map((t) => t.toLowerCase());
      if (a.pageType === "article") {
        return types.some((t) => /article|blogposting|report/.test(t))
          ? pass("Article markup present.")
          : warn("Looks like an article but has no Article / BlogPosting schema.");
      }
      if (a.pageType === "product") {
        return types.includes("product")
          ? pass("Product markup present.")
          : warn("Product page without Product schema.");
      }
      return na("Not an article or product page.");
    },
  },
  {
    id: "schema.breadcrumbs",
    scope: "page",
    category: "structured_data",
    title: "Breadcrumb markup",
    weight: 1,
    severity: "low",
    recommendation: "Add BreadcrumbList schema",
    fixId: "breadcrumbs",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.8,
    evaluate: ({ a }) => {
      let segments = 0;
      try {
        segments = new URL(a.url).pathname.split("/").filter(Boolean).length;
      } catch {
        /* keep 0 */
      }
      if (a.pageType === "home" || segments < 2) return na("Top-level page.");
      return a.schema.hasBreadcrumbList
        ? pass("BreadcrumbList schema found.")
        : warn(`${segments} levels deep without BreadcrumbList schema.`);
    },
  },
  {
    id: "schema.open_graph",
    scope: "page",
    category: "structured_data",
    title: "Open Graph tags",
    weight: 2,
    severity: "low",
    recommendation: "Complete your Open Graph tags",
    fixId: "og",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) => {
      const has = ["og:title", "og:description", "og:image"].filter((k) => a.og[k]);
      return has.length === 3
        ? pass("og:title, og:description and og:image set.")
        : warn(
            `Missing ${["og:title", "og:description", "og:image"].filter((k) => !a.og[k]).join(", ")}.`,
          );
    },
  },
  {
    id: "schema.twitter_card",
    scope: "page",
    category: "structured_data",
    title: "Twitter / X card",
    weight: 1,
    severity: "low",
    recommendation: "Complete your Open Graph tags",
    actionKey: "schema.open_graph",
    fixId: "og",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) =>
      a.twitter["twitter:card"]
        ? pass(`twitter:card = ${a.twitter["twitter:card"]}.`)
        : warn("Missing twitter:card."),
  },
  {
    id: "schema.entity_consistency",
    scope: "page",
    category: "structured_data",
    title: "Schema entities match visible content",
    weight: 2,
    severity: "medium",
    recommendation: "Name your schema entities in the title or H1",
    fixId: null,
    safety: "assisted",
    effort: "low",
    confidence: 0.7,
    evaluate: ({ a }) =>
      !a.entities.items.some((e) => e.sources.includes("structured_data"))
        ? na("No schema entities declared.")
        : a.entities.consistencyIssues.length
          ? warn(a.entities.consistencyIssues[0], { issues: a.entities.consistencyIssues })
          : pass("Declared entities are named on the page."),
  },
];

/* ───────────────────────── Answer-ready content ───────────────────────── */

const content: GeoRule[] = [
  {
    id: "content.h1",
    scope: "page",
    category: "content",
    title: "One descriptive H1",
    weight: 3,
    severity: "medium",
    recommendation: "Use exactly one H1",
    fixId: "h1",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) =>
      a.h1Count === 0
        ? fail("No H1 — engines have to guess the page's topic.")
        : a.h1Count > 1
          ? warn(`${a.h1Count} H1 tags — keep one and demote the rest to H2.`)
          : pass(`"${a.headings.find((h) => h.level === 1)?.text ?? ""}"`),
  },
  {
    id: "content.heading_hierarchy",
    scope: "page",
    category: "content",
    title: "Logical heading outline",
    weight: 2,
    severity: "low",
    recommendation: "Fix heading level skips",
    fixId: "heading-hierarchy",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a }) =>
      a.headings.length < 2
        ? na("Too few headings to form an outline.")
        : a.structure.hierarchyValid
          ? pass(`${a.headings.length} headings in order.`)
          : warn(a.hierarchyIssues[0] ?? "Heading levels skip.", { issues: a.hierarchyIssues }),
  },
  {
    id: "content.title_h1_alignment",
    scope: "page",
    category: "content",
    title: "Title and H1 agree",
    weight: 2,
    severity: "low",
    recommendation: "Align each page's title and H1",
    fixId: "h1",
    safety: "assisted",
    effort: "low",
    confidence: 0.75,
    evaluate: ({ a }) =>
      a.titleH1Aligned === null
        ? na("No title or H1.")
        : a.titleH1Aligned
          ? pass("Title and H1 share the same topic.")
          : warn("Title and H1 describe different topics.", {
              title: a.title,
              h1: a.headings.find((h) => h.level === 1)?.text ?? null,
            }),
  },
  {
    id: "content.substance",
    scope: "page",
    category: "content",
    title: "Substantive copy",
    weight: 3,
    severity: "medium",
    recommendation: "Expand thin pages",
    fixId: "thin-content",
    safety: "assisted",
    effort: "high",
    confidence: 0.8,
    evaluate: ({ a }) => {
      if (!isContentPage(a)) return na("Legal and contact pages are short by design.");
      const lean = a.pageType === "product" || a.pageType === "listing";
      const [failBelow, warnBelow] = lean ? [100, 250] : [150, 400];
      const detail = `${a.text.words.toLocaleString()} words of text.`;
      return a.text.words < failBelow
        ? fail(detail)
        : a.text.words < warnBelow
          ? warn(detail)
          : pass(detail);
    },
  },
  {
    id: "content.questions_answered",
    scope: "page",
    category: "content",
    title: "Questions have answers",
    weight: 3,
    severity: "high",
    recommendation: "Answer every question heading directly",
    fixId: "answer-blocks",
    safety: "assisted",
    effort: "medium",
    confidence: 0.8,
    evaluate: ({ a }) => {
      const q = a.questions;
      if (!q.total) return na("No questions on the page.");
      const evidence = { unanswered: q.unansweredHeadings, answered: q.answered, total: q.total };
      if (!q.unansweredHeadings.length && q.answered === q.total) {
        return pass(`All ${q.total} questions are answered.`, evidence);
      }
      const detail = `${q.total - q.answered} of ${q.total} questions have no answer${q.unansweredHeadings[0] ? `, e.g. "${q.unansweredHeadings[0]}"` : ""}.`;
      return q.answered / q.total < 0.5 ? fail(detail, evidence) : warn(detail, evidence);
    },
  },
  {
    id: "content.direct_answers",
    scope: "page",
    category: "content",
    title: "Direct, quotable answers",
    weight: 2,
    severity: "medium",
    recommendation: "Answer every question heading directly",
    actionKey: "content.questions_answered",
    fixId: "answer-blocks",
    safety: "assisted",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ a }) =>
      !a.questions.answered
        ? na("No answered questions to assess.")
        : a.questions.direct
          ? pass(`${a.questions.direct} answer(s) open with a direct statement.`)
          : warn("Answers don't open with a direct statement engines can lift."),
  },
  {
    id: "content.faq_schema",
    scope: "page",
    category: "content",
    title: "FAQ schema for Q&A content",
    weight: 2,
    severity: "medium",
    recommendation: "Add FAQ schema",
    fixId: "faq",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.85,
    evaluate: ({ a }) =>
      a.questions.faqSchema
        ? pass("FAQPage / QAPage schema present.")
        : a.questions.total < 2
          ? na("Not a question-and-answer page.")
          : warn(`${a.questions.total} questions without FAQPage schema.`),
  },
  {
    id: "content.topic_focus",
    scope: "page",
    category: "content",
    title: "Main topic in title or H1",
    weight: 2,
    severity: "medium",
    recommendation: "Put each page's main topic in its title and H1",
    fixId: "h1",
    safety: "assisted",
    effort: "low",
    confidence: 0.65,
    evaluate: ({ a }) =>
      !a.topic.primary || a.topic.depth === "thin"
        ? na("Not enough text to infer a topic.")
        : a.topic.inTitle || a.topic.inH1
          ? pass(`Centres on "${a.topic.primary}".`, { supporting: a.topic.supporting })
          : warn(`Main topic "${a.topic.primary}" is not in the title or H1.`, {
              supporting: a.topic.supporting,
            }),
  },
  {
    id: "content.keyword_stuffing",
    scope: "page",
    category: "content",
    title: "Natural keyword use",
    weight: 2,
    severity: "high",
    recommendation: "Reduce keyword repetition",
    fixId: null,
    safety: "assisted",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ a }) =>
      a.topic.stuffing
        ? fail(
            `"${a.topic.stuffing.term}" is ${a.topic.stuffing.density}% of the words.`,
            a.topic.stuffing,
          )
        : pass("No over-repeated terms."),
  },
  {
    id: "content.semantic_html",
    scope: "page",
    category: "content",
    title: "Semantic HTML landmarks",
    weight: 2,
    severity: "low",
    recommendation: "Use semantic HTML landmarks",
    fixId: "semantic-html",
    safety: "assisted",
    effort: "medium",
    confidence: 0.85,
    evaluate: ({ a }) => {
      const n = a.landmarks.length;
      const detail = `${n} of 7 landmarks: ${a.landmarks.join(", ") || "none"}.`;
      return n >= 4 ? pass(detail) : n >= 2 ? warn(detail) : fail(detail);
    },
  },
  {
    id: "content.image_alt",
    scope: "page",
    category: "content",
    title: "Image alt text",
    weight: 2,
    severity: "low",
    recommendation: "Add alt text to images",
    fixId: "alt",
    safety: "assisted",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) => {
      const { total, missingAlt } = a.images;
      if (!total) return na("No images.");
      const coverage = pct(total - missingAlt, total);
      const detail = `${total - missingAlt}/${total} images have alt (${coverage}%).`;
      return coverage >= 90 ? pass(detail) : coverage >= 60 ? warn(detail) : fail(detail);
    },
  },
  {
    id: "content.internal_links",
    scope: "page",
    category: "content",
    title: "Internal linking",
    weight: 2,
    severity: "low",
    recommendation: "Link related pages to each other",
    fixId: "internal-links",
    safety: "assisted",
    effort: "medium",
    confidence: 0.85,
    evaluate: ({ a }) => {
      const n = a.links.internal.length;
      const detail = `${n} internal · ${a.links.external.length} external links.`;
      return n >= 5 ? pass(detail) : n >= 1 ? warn(detail) : fail(detail);
    },
  },
  {
    id: "content.scannable",
    scope: "page",
    category: "content",
    title: "Scannable sections",
    weight: 1,
    severity: "low",
    recommendation: "Break up long text and fill empty sections",
    fixId: null,
    safety: "assisted",
    effort: "medium",
    confidence: 0.75,
    evaluate: ({ a }) => {
      const { longParagraphs, emptySections, thinSections } = a.structure;
      const problems = [
        longParagraphs ? `${longParagraphs} paragraph(s) over 150 words` : "",
        emptySections.length + thinSections.length
          ? `${emptySections.length + thinSections.length} empty or thin section(s)`
          : "",
      ].filter(Boolean);
      return problems.length
        ? warn(`${problems.join("; ")}.`, { emptySections, thinSections })
        : pass("Sections are well-sized.");
    },
  },
];

/* ───────────────────────── Authority & trust ───────────────────────── */

function anyPage<T>(
  ctx: SiteContext,
  pick: (a: PageAnalysis) => T | null | undefined | false,
): T | null {
  for (const { a } of ctx.analyzed) {
    const v = pick(a);
    if (v) return v;
  }
  return null;
}

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|protonmail|gmx|yandex|mail)\./i;

function nameTokens(name: string): Set<string> {
  return new Set(
    (name.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(
      (t) => !/^(inc|llc|ltd|corp|co|the|and|group|limited|gmbh|company)$/.test(t),
    ),
  );
}

const authority: GeoRule[] = [
  {
    id: "trust.about",
    scope: "site",
    category: "authority",
    title: "About page",
    weight: 2,
    severity: "medium",
    recommendation: "Publish and link an About page",
    fixId: "about",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.85,
    evaluate: (ctx) => {
      const link = anyPage(
        ctx,
        (a) => a.trust.aboutLink ?? (a.pageType === "about" ? a.url : null),
      );
      return link
        ? pass(`About page: ${link}`)
        : warn("No About page linked — engines can't learn who you are.");
    },
  },
  {
    id: "trust.contact",
    scope: "site",
    category: "authority",
    title: "Contact details",
    weight: 2,
    severity: "medium",
    recommendation: "Make contact details easy to find",
    fixId: "contact",
    safety: "manual_review",
    effort: "low",
    confidence: 0.85,
    evaluate: (ctx) => {
      const link = anyPage(ctx, (a) => a.trust.contactLink);
      const email = anyPage(ctx, (a) => a.trust.emails[0]);
      const phone = anyPage(ctx, (a) => a.trust.phones > 0);
      return link || email || phone
        ? pass(
            [link && "contact page", email && "email", phone && "phone"]
              .filter(Boolean)
              .join(" · "),
            {
              contactLink: link,
              email,
            },
          )
        : warn("No contact page, email or phone number found.");
    },
  },
  {
    id: "trust.privacy",
    scope: "site",
    category: "authority",
    title: "Privacy policy",
    weight: 2,
    severity: "medium",
    recommendation: "Link a privacy policy",
    fixId: "privacy",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.9,
    evaluate: (ctx) => {
      const link = anyPage(
        ctx,
        (a) =>
          a.trust.privacyLink ?? (a.pageType === "legal" && /privacy/.test(a.url) ? a.url : null),
      );
      return link ? pass(`Privacy policy: ${link}`) : warn("No privacy policy link found.");
    },
  },
  {
    id: "trust.terms",
    scope: "site",
    category: "authority",
    title: "Terms of service",
    weight: 1,
    severity: "low",
    recommendation: "Link your terms of service",
    fixId: "privacy",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.85,
    evaluate: (ctx) => {
      const link = anyPage(ctx, (a) => a.trust.termsLink);
      return link ? pass(`Terms: ${link}`) : warn("No terms of service link found.");
    },
  },
  {
    id: "trust.org_identity",
    scope: "site",
    category: "authority",
    title: "Declared business identity",
    weight: 3,
    severity: "medium",
    recommendation: "Declare your organization's name consistently",
    fixId: "org-schema",
    safety: "manual_review",
    effort: "low",
    confidence: 0.85,
    evaluate: ({ home }) => {
      if (!home) return na("Homepage was not analyzed.");
      const name = home.a.trust.siteName ?? home.a.trust.copyrightName;
      return name
        ? pass(`Identified as "${name}".`)
        : warn("No organization name in schema, og:site_name or a copyright notice.");
    },
  },
  {
    id: "trust.identity_consistency",
    scope: "site",
    category: "authority",
    title: "Consistent business name",
    weight: 2,
    severity: "medium",
    recommendation: "Declare your organization's name consistently",
    actionKey: "trust.org_identity",
    fixId: "org-schema",
    safety: "manual_review",
    effort: "low",
    confidence: 0.7,
    evaluate: ({ home }) => {
      if (!home) return na("Homepage was not analyzed.");
      const names: Record<string, string> = {};
      const a = home.a;
      if (a.schema.organizations[0]) names.schema = a.schema.organizations[0].name;
      if (a.og["og:site_name"]) names.og_site_name = a.og["og:site_name"];
      if (a.trust.copyrightName) names.copyright = a.trust.copyrightName;
      const values = Object.values(names);
      if (values.length < 2) return na("Only one source names the business.");
      const sets = values.map(nameTokens);
      const conflict = sets.some((s, i) =>
        sets.slice(i + 1).some((o) => ![...s].some((t) => o.has(t))),
      );
      return conflict
        ? warn(
            `Names disagree: ${Object.entries(names)
              .map(([k, v]) => `${k} "${v}"`)
              .join(", ")}.`,
            names,
          )
        : pass("Schema, social metadata and copyright agree.", names);
    },
  },
  {
    id: "trust.contact_domain",
    scope: "site",
    category: "authority",
    title: "Contact email on your domain",
    weight: 1,
    severity: "low",
    recommendation: "Use a contact email on your own domain",
    fixId: null,
    safety: "manual_review",
    effort: "low",
    confidence: 0.8,
    evaluate: (ctx) => {
      const emails = [...new Set(ctx.analyzed.flatMap(({ a }) => a.trust.emails))];
      if (!emails.length) return na("No email address published.");
      const host = ctx.site.host;
      if (emails.some((e) => e.endsWith(`@${host}`) || e.endsWith(`.${host}`))) {
        return pass("A contact email uses your domain.");
      }
      return emails.every((e) => FREE_MAIL.test(e))
        ? warn(
            `Only webmail addresses (${emails[0]}) — a domain address reads as more established.`,
          )
        : pass("Contact email published.");
    },
  },
  {
    id: "trust.authorship",
    scope: "page",
    category: "authority",
    title: "Article has a named author",
    weight: 2,
    severity: "medium",
    recommendation: "Add author bylines to articles",
    fixId: "author-byline",
    safety: "manual_review",
    effort: "low",
    confidence: 0.8,
    evaluate: ({ a }) =>
      !isArticle(a)
        ? na("Not an article.")
        : a.trust.byline
          ? pass(`By ${a.trust.byline}.`)
          : warn("No author byline or author schema."),
  },
  {
    id: "trust.author_credentials",
    scope: "page",
    category: "authority",
    title: "Author expertise shown",
    weight: 1,
    severity: "low",
    recommendation: "Show author credentials and profiles",
    fixId: "author-byline",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.6,
    evaluate: ({ a }) => {
      if (!isArticle(a) || !a.trust.byline) return na("No article byline.");
      const author = a.schema.authors[0];
      const shown =
        a.trust.credentials.length || author?.jobTitle || author?.url || author?.sameAs.length;
      return shown
        ? pass("Author title, credentials or profile link present.", {
            credentials: a.trust.credentials,
          })
        : warn(`"${a.trust.byline}" has no job title, credentials or profile link.`);
    },
  },
  {
    id: "trust.dates",
    scope: "page",
    category: "authority",
    title: "Published / updated date",
    weight: 1,
    severity: "low",
    recommendation: "Show when articles were published and updated",
    fixId: "article-schema",
    safety: "assisted",
    effort: "low",
    confidence: 0.8,
    evaluate: ({ a }) =>
      !isArticle(a)
        ? na("Not an article.")
        : a.trust.datePublished || a.trust.dateModified
          ? pass(`Dated ${a.trust.dateModified ?? a.trust.datePublished}.`)
          : warn("No published or updated date — engines favour fresh, dated sources."),
  },
  {
    id: "trust.claims_sourced",
    scope: "page",
    category: "authority",
    title: "Statistics are sourced",
    weight: 3,
    severity: "medium",
    recommendation: "Cite sources for statistics",
    fixId: "cite-sources",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.65,
    evaluate: ({ a }) => {
      const { statistical, statisticalUnsupported, samples } = a.claims;
      if (!statistical) return na("No statistical claims.");
      if (!statisticalUnsupported) return pass(`${statistical} statistic(s), all near a source.`);
      const detail = `${statisticalUnsupported} of ${statistical} statistic(s) have no nearby source.`;
      return statisticalUnsupported / statistical > 0.5
        ? fail(detail, { samples })
        : warn(detail, { samples });
    },
  },
  {
    id: "trust.superlatives",
    scope: "page",
    category: "authority",
    title: "Superlatives are backed",
    weight: 1,
    severity: "low",
    recommendation: "Back or soften superlative claims",
    fixId: "cite-sources",
    safety: "manual_review",
    effort: "low",
    confidence: 0.6,
    evaluate: ({ a }) =>
      a.claims.superlativeUnsupported >= 2
        ? warn(
            `${a.claims.superlativeUnsupported} unbacked claims like "the best" or "industry-leading".`,
            {
              samples: a.claims.samples,
            },
          )
        : pass("No unbacked superlatives."),
  },
  {
    id: "trust.citations",
    scope: "page",
    category: "authority",
    title: "Long-form content cites sources",
    weight: 2,
    severity: "medium",
    recommendation: "Cite sources for statistics",
    actionKey: "trust.claims_sourced",
    fixId: "cite-sources",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ a }) =>
      !isArticle(a) || a.text.words < 600
        ? na("Not long-form content.")
        : a.sources.citationCandidates
          ? pass(`${a.sources.citationCandidates} source link(s), ${a.sources.primary} primary.`)
          : warn("A long article with no links to sources."),
  },
  {
    id: "trust.anchor_text",
    scope: "page",
    category: "authority",
    title: "Descriptive link text",
    weight: 1,
    severity: "low",
    recommendation: "Replace “click here” links with descriptive text",
    fixId: null,
    safety: "auto_safe",
    effort: "low",
    confidence: 0.85,
    evaluate: ({ a }) =>
      !a.links.external.length
        ? na("No outbound links.")
        : a.sources.weakAnchors >= 2
          ? warn(`${a.sources.weakAnchors} outbound links say "click here", "here" or similar.`)
          : pass("Outbound links describe their destination."),
  },
  {
    id: "trust.commercial_balance",
    scope: "page",
    category: "authority",
    title: "Commercial links balanced with sources",
    weight: 1,
    severity: "low",
    recommendation: "Balance affiliate links with independent sources",
    fixId: null,
    safety: "manual_review",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ a }) =>
      !a.sources.affiliate
        ? na("No affiliate or sponsored links.")
        : a.sources.affiliate >= 3 && !a.sources.citationCandidates
          ? warn(`${a.sources.affiliate} affiliate/sponsored links and no independent sources.`)
          : pass("Commercial links are balanced."),
  },
];

/* ───────────────────────── Rendering & performance ───────────────────────── */

const performance: GeoRule[] = [
  {
    id: "perf.server_rendered",
    scope: "page",
    category: "performance",
    title: "Text in the server-rendered HTML",
    weight: 4,
    severity: "high",
    recommendation: "Server-render your page copy",
    fixId: "ssr",
    safety: "manual_review",
    effort: "high",
    confidence: 0.8,
    evaluate: ({ a }) => {
      const detail = `${a.text.words.toLocaleString()} words readable without JavaScript.`;
      if (!isContentPage(a)) return a.text.words < 20 ? fail(detail) : pass(detail);
      return a.text.words < 50
        ? fail(`${detail} LLM crawlers that skip JavaScript may see an empty shell.`)
        : a.text.words < 150
          ? warn(detail)
          : pass(detail);
    },
  },
  {
    id: "perf.viewport",
    scope: "page",
    category: "performance",
    title: "Mobile viewport",
    weight: 3,
    severity: "high",
    recommendation: "Declare a mobile viewport",
    fixId: "viewport",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.95,
    evaluate: ({ a }) =>
      a.viewport ? pass("Responsive viewport declared.") : fail("Missing <meta name=viewport>."),
  },
  {
    id: "perf.charset",
    scope: "page",
    category: "performance",
    title: "Character set declared",
    weight: 1,
    severity: "low",
    recommendation: "Declare a character set",
    fixId: "charset",
    safety: "auto_safe",
    effort: "low",
    confidence: 0.9,
    evaluate: ({ a }) =>
      a.charset ? pass("Charset declared.") : warn('Add <meta charset="utf-8">.'),
  },
  {
    id: "perf.html_size",
    scope: "page",
    category: "performance",
    title: "HTML payload size",
    weight: 2,
    severity: "medium",
    recommendation: "Slim down heavy HTML",
    fixId: null,
    safety: "manual_review",
    effort: "high",
    confidence: 0.9,
    evaluate: ({ a }) => {
      const kb = a.bytes / 1024;
      const detail = `${kb.toFixed(0)} KB of HTML${a.truncated ? " (over the 2 MB read limit)" : ""}.`;
      return a.truncated || kb >= 600 ? fail(detail) : kb >= 250 ? warn(detail) : pass(detail);
    },
  },
  {
    id: "perf.response_time",
    scope: "page",
    category: "performance",
    title: "Response time",
    weight: 1,
    severity: "low",
    recommendation: "Speed up slow pages",
    fixId: null,
    safety: "manual_review",
    effort: "high",
    confidence: 0.6,
    evaluate: ({ page }) => {
      if (page.fetchMs === null) return na("Not measured.");
      const detail = `Fetched in ${(page.fetchMs / 1000).toFixed(1)} s from Mellox's crawler.`;
      return page.fetchMs <= 1500
        ? pass(detail)
        : page.fetchMs <= 4000
          ? warn(detail)
          : fail(detail);
    },
  },
  {
    id: "perf.text_ratio",
    scope: "page",
    category: "performance",
    title: "Content-to-markup ratio",
    weight: 1,
    severity: "low",
    recommendation: "Slim down heavy HTML",
    actionKey: "perf.html_size",
    fixId: null,
    safety: "manual_review",
    effort: "high",
    confidence: 0.6,
    evaluate: ({ a }) =>
      a.bytes > 3000 && a.text.textToHtmlRatio < 0.03
        ? warn(
            `Visible text is ${(a.text.textToHtmlRatio * 100).toFixed(1)}% of the HTML — mostly scripts and markup.`,
          )
        : pass(`Text is ${(a.text.textToHtmlRatio * 100).toFixed(1)}% of the HTML.`),
  },
];

export const GEO_RULES: readonly GeoRule[] = [
  ...aiAccess,
  ...technical,
  ...structuredData,
  ...content,
  ...authority,
  ...performance,
];

export const RULE_BY_ID: ReadonlyMap<string, GeoRule> = new Map(GEO_RULES.map((r) => [r.id, r]));
