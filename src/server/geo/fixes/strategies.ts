// strategies.ts — how each AI Visibility rule can be fixed.
//
//   deterministic  built from scan data without a model (robots, llms.txt,
//                  sitemap) when the repository serves a static file
//   agent          the Mellox GEO Engineer investigates the repository and
//                  proposes a patch (with grounding rules for content)
//   manual         can't be changed safely from source code, or needs facts
//                  only the business has — exact steps + how to validate
//
// Pure. A test enforces that every rule in the catalog has a strategy.

import { GEO_RULES } from "@/lib/geo/rules";
import { fixKindForRule, type FixKind } from "./targets";

export type FixMode = "deterministic" | "agent" | "manual";

/**
 * none          metadata derived from existing values (URLs, language codes)
 * page_text     any new visible text must come from the site's existing text
 * page_text_inputs  as page_text, plus facts the user supplies (authors, dates, profiles)
 */
export type GroundingMode = "none" | "page_text" | "page_text_inputs";

export type RequiredInput = { key: string; label: string; why: string; example: string };

export type FixStrategy = {
  mode: FixMode;
  /** Deterministic fast path when the repository serves the file statically. */
  fastPath: FixKind | null;
  grounding: GroundingMode;
  /** What the change may touch; shown to the agent and the reviewer. */
  editClasses: string[];
  /** page: a targeted rescan of the page · site: site files · full: needs a full rescan. */
  verifyScope: "page" | "site" | "full";
  /** Facts the change needs that Mellox can't know. */
  inputs: RequiredInput[];
  risk: string | null;
  manualSteps: string[];
  validationSteps: string[];
};

const META = ["document head metadata (title, meta, link, framework metadata API)"];
const SCHEMA = ["JSON-LD structured data built from facts on the site"];
const CONTENT = ["reordering or condensing existing page copy", "headings", "semantic markup"];

const rescanPage = "Re-scan the affected page in Mellox and confirm the check passes.";
const viewSource = (what: string) =>
  `Open the live page, view source (not DevTools) and confirm ${what}.`;

const agent = (
  s: Partial<FixStrategy> & Pick<FixStrategy, "editClasses" | "manualSteps">,
): FixStrategy => ({
  mode: "agent",
  fastPath: null,
  grounding: "none",
  verifyScope: "page",
  inputs: [],
  risk: null,
  validationSteps: [rescanPage],
  ...s,
});

const manual = (
  manualSteps: string[],
  validationSteps: string[],
  verifyScope: FixStrategy["verifyScope"] = "page",
): FixStrategy => ({
  mode: "manual",
  fastPath: null,
  grounding: "none",
  editClasses: [],
  verifyScope,
  inputs: [],
  risk: null,
  manualSteps,
  validationSteps,
});

const discovery = (kind: FixKind, steps: string[], check: string): FixStrategy => ({
  mode: "deterministic",
  fastPath: kind,
  grounding: "none",
  editClasses: [
    "discovery files (robots.txt, sitemap.xml, llms.txt) or the route that generates them",
  ],
  verifyScope: "site",
  inputs: [],
  risk: null,
  manualSteps: steps,
  validationSteps: [check, "Run “Verify fix” in Mellox."],
});

const STRATEGIES: Record<string, FixStrategy> = {
  /* ── AI access ── */
  "ai.robots_txt": discovery(
    "robots",
    ["Serve /robots.txt as plain text that allows AI crawlers and lists your sitemap."],
    "curl -s https://your-site/robots.txt returns 200 text/plain with your rules.",
  ),
  "ai.llms_txt": discovery(
    "llms",
    ["Publish /llms.txt: a title, a one-line summary and links to your key pages."],
    "curl -s https://your-site/llms.txt returns 200 with a # heading and links.",
  ),
  "ai.bots": discovery(
    "robots",
    [
      "Remove Disallow rules that block GPTBot, ClaudeBot, PerplexityBot and Google-Extended in robots.txt.",
    ],
    "curl -s https://your-site/robots.txt and confirm no Disallow: / for those user agents.",
  ),

  /* ── Technical ── */
  "tech.https": manual(
    ["Serve every page over HTTPS and redirect http:// to https:// at your host or CDN."],
    ["curl -I http://your-site/ returns a 301 to https://."],
  ),
  "tech.sitemap": discovery(
    "sitemap",
    [
      "Publish /sitemap.xml listing your canonical, indexable pages (or generate it from your framework).",
    ],
    "curl -s https://your-site/sitemap.xml returns valid XML with <loc> entries.",
  ),
  "tech.robots_sitemap": discovery(
    "robots-sitemap",
    ["Add “Sitemap: https://your-site/sitemap.xml” to robots.txt."],
    "robots.txt contains a Sitemap: line with an absolute URL.",
  ),
  "tech.http_errors": manual(
    ["Fix or redirect the pages that return 4xx/5xx; remove links to deleted pages."],
    ["Run a full re-scan; the affected URLs should return 200 or a single redirect."],
    "full",
  ),
  "tech.indexable": agent({
    editClasses: META,
    risk: "Removing noindex publishes the page to search and answer engines. Confirm the page should be public.",
    manualSteps: [
      "Remove the noindex robots meta tag or X-Robots-Tag header from pages that should be indexed.",
    ],
    validationSteps: [viewSource("there is no noindex robots meta tag"), rescanPage],
  }),
  "tech.canonical": agent({
    editClasses: META,
    manualSteps: [
      'Add one absolute self-referencing <link rel="canonical"> per page (framework metadata API where available).',
    ],
    validationSteps: [
      viewSource("exactly one canonical link pointing at the page's own URL"),
      rescanPage,
    ],
  }),
  "tech.title": agent({
    editClasses: META,
    grounding: "page_text",
    manualSteps: ["Give the page one 20–65 character <title> that names what it is about."],
    validationSteps: [viewSource("a single <title> of 20–65 characters"), rescanPage],
  }),
  "tech.duplicate_title": agent({
    editClasses: [...META, "per-route metadata instead of a shared default"],
    grounding: "page_text",
    verifyScope: "full",
    manualSteps: [
      "Give each page its own title (per-route metadata / generateMetadata rather than one shared title).",
    ],
    validationSteps: ["Run a full re-scan; no two pages should share a title."],
  }),
  "tech.meta_description": agent({
    editClasses: META,
    grounding: "page_text",
    manualSteps: ["Add a 70–165 character meta description summarising the page's actual content."],
    validationSteps: [viewSource("one meta description of 70–165 characters"), rescanPage],
  }),
  "tech.duplicate_description": agent({
    editClasses: [...META, "per-route metadata instead of a shared default"],
    grounding: "page_text",
    verifyScope: "full",
    manualSteps: ["Write a distinct description per page from that page's content."],
    validationSteps: ["Run a full re-scan; no two pages should share a description."],
  }),
  "tech.lang": agent({
    editClasses: ["<html lang> attribute or the framework's document/layout"],
    manualSteps: ["Set lang on the <html> element to the page language (e.g. en)."],
    validationSteps: [viewSource('<html lang="…">'), rescanPage],
  }),
  "tech.hreflang": manual(
    [
      "Add reciprocal hreflang links for each language version, including x-default. Needs your list of localized URLs.",
    ],
    ["Each language version links to every other version and to itself."],
    "full",
  ),
  "tech.broken_links": agent({
    editClasses: ["internal link targets in page source"],
    verifyScope: "full",
    manualSteps: ["Update or remove internal links that point at missing pages."],
    validationSteps: ["Run a full re-scan; the broken links list should be empty."],
  }),
  "tech.crawl_depth": manual(
    [
      "Link important pages from the home page or main navigation so they are reachable within three clicks.",
    ],
    ["Run a full re-scan; key pages should be found at depth ≤ 3."],
    "full",
  ),

  /* ── Structured data ── */
  "schema.jsonld": agent({
    editClasses: SCHEMA,
    grounding: "page_text",
    manualSteps: [
      "Add a JSON-LD block describing the page (Organization/WebSite on the home page).",
    ],
    validationSteps: [
      viewSource('a <script type="application/ld+json"> that parses'),
      "Validate with https://validator.schema.org/.",
      rescanPage,
    ],
  }),
  "schema.organization": agent({
    editClasses: SCHEMA,
    grounding: "page_text_inputs",
    manualSteps: ["Add Organization JSON-LD with your real name, URL and logo (sitewide layout)."],
    validationSteps: ["Validate the home page with https://validator.schema.org/.", rescanPage],
  }),
  "schema.org_sameas": agent({
    editClasses: SCHEMA,
    grounding: "page_text_inputs",
    inputs: [
      {
        key: "same_as_urls",
        label: "Official profile URLs",
        why: "sameAs must list profiles you actually own; Mellox won't guess them.",
        example: "https://www.linkedin.com/company/acme, https://x.com/acme",
      },
    ],
    manualSteps: ["Add your official social/profile URLs to Organization.sameAs."],
    validationSteps: ["Validate with https://validator.schema.org/.", rescanPage],
  }),
  "schema.website": agent({
    editClasses: SCHEMA,
    grounding: "page_text",
    manualSteps: ["Add WebSite JSON-LD with name and url on the home page."],
    validationSteps: ["Validate the home page with https://validator.schema.org/.", rescanPage],
  }),
  "schema.page_type": agent({
    editClasses: SCHEMA,
    grounding: "page_text_inputs",
    manualSteps: [
      "Add the schema type that matches the page (Article, Product, Service, FAQPage) using only facts shown on it.",
    ],
    validationSteps: ["Validate with https://validator.schema.org/.", rescanPage],
  }),
  "schema.breadcrumbs": agent({
    editClasses: SCHEMA,
    manualSteps: ["Add BreadcrumbList JSON-LD mirroring the page's position in the site."],
    validationSteps: ["Validate with https://validator.schema.org/.", rescanPage],
  }),
  "schema.open_graph": agent({
    editClasses: META,
    grounding: "page_text",
    manualSteps: [
      "Add og:title, og:description, og:url and og:type (og:image from an existing image).",
    ],
    validationSteps: [viewSource("og:title, og:description and og:url"), rescanPage],
  }),
  "schema.twitter_card": agent({
    editClasses: META,
    grounding: "page_text",
    manualSteps: [
      "Add twitter:card (summary_large_image when an image exists) plus title and description.",
    ],
    validationSteps: [viewSource("a twitter:card meta tag"), rescanPage],
  }),
  "schema.entity_consistency": agent({
    editClasses: [...SCHEMA, ...META],
    grounding: "page_text_inputs",
    verifyScope: "site",
    manualSteps: ["Use the same organisation name in schema, og:site_name and the page footer."],
    validationSteps: ["Run a full re-scan and confirm one consistent name."],
  }),

  /* ── Content ── */
  "content.h1": agent({
    editClasses: ["heading levels"],
    grounding: "page_text",
    manualSteps: ["Make sure the page has exactly one <h1> naming its main topic."],
    validationSteps: [viewSource("exactly one <h1>"), rescanPage],
  }),
  "content.heading_hierarchy": agent({
    editClasses: ["heading levels (no visual restyling)"],
    grounding: "page_text",
    manualSteps: ["Nest headings in order (h1 → h2 → h3) without skipping levels."],
    validationSteps: [rescanPage],
  }),
  "content.title_h1_alignment": agent({
    editClasses: [...META, "headings"],
    grounding: "page_text",
    manualSteps: ["Make the title and the H1 describe the same topic."],
    validationSteps: [rescanPage],
  }),
  "content.substance": manual(
    [
      "Expand the page with genuinely useful information for its audience (specifics, examples, answers). Mellox won't write new claims for you.",
    ],
    [rescanPage],
  ),
  "content.questions_answered": agent({
    editClasses: CONTENT,
    grounding: "page_text",
    manualSteps: [
      "Phrase key section headings as the questions customers ask, with the answer directly underneath.",
    ],
    validationSteps: [rescanPage],
  }),
  "content.direct_answers": agent({
    editClasses: CONTENT,
    grounding: "page_text",
    manualSteps: [
      "Start each section with a one–two sentence direct answer taken from the section's own content.",
    ],
    validationSteps: [rescanPage],
  }),
  "content.faq_schema": agent({
    editClasses: [...SCHEMA, ...CONTENT],
    grounding: "page_text",
    manualSteps: [
      "Add FAQPage JSON-LD only for questions and answers that are visible on the page.",
    ],
    validationSteps: ["Validate with https://validator.schema.org/.", rescanPage],
  }),
  "content.topic_focus": manual(
    ["Keep each page about one topic; split unrelated sections into their own pages."],
    [rescanPage],
  ),
  "content.keyword_stuffing": agent({
    editClasses: CONTENT,
    grounding: "page_text",
    risk: "Rewording copy changes what visitors read; review the diff carefully.",
    manualSteps: ["Remove repeated keywords so the copy reads naturally."],
    validationSteps: [rescanPage],
  }),
  "content.semantic_html": agent({
    editClasses: ["semantic elements (main, article, nav, section) without restyling"],
    manualSteps: ["Wrap the primary content in <main>/<article> and navigation in <nav>."],
    validationSteps: [viewSource("a <main> element around the page content"), rescanPage],
  }),
  "content.image_alt": agent({
    editClasses: ["image alt attributes"],
    grounding: "page_text",
    manualSteps: ["Add descriptive alt text to meaningful images (empty alt for decorative ones)."],
    validationSteps: [rescanPage],
  }),
  "content.internal_links": agent({
    editClasses: ["links to existing pages of the site"],
    manualSteps: ["Link this page to related pages with descriptive anchor text."],
    validationSteps: [rescanPage],
  }),
  "content.scannable": agent({
    editClasses: CONTENT,
    grounding: "page_text",
    manualSteps: [
      "Break long paragraphs into short sections, lists or tables using the existing copy.",
    ],
    validationSteps: [rescanPage],
  }),

  /* ── Authority & trust ── */
  "trust.about": manual(
    ["Publish an About page describing who runs the business. Only you can write this."],
    ["Link it from the navigation or footer, then re-scan."],
    "full",
  ),
  "trust.contact": manual(
    ["Publish contact details (email, form, address or phone) and link them sitewide."],
    ["Re-scan and confirm the contact page is found."],
    "full",
  ),
  "trust.privacy": manual(
    ["Publish a privacy policy reviewed for your jurisdiction. Mellox never generates legal text."],
    ["Link it from the footer and re-scan."],
    "full",
  ),
  "trust.terms": manual(
    ["Publish terms of service reviewed for your business. Mellox never generates legal text."],
    ["Link it from the footer and re-scan."],
    "full",
  ),
  "trust.org_identity": agent({
    editClasses: [...SCHEMA, ...META],
    grounding: "page_text_inputs",
    verifyScope: "site",
    manualSteps: [
      "State the organisation's legal or brand name consistently in schema and the footer.",
    ],
    validationSteps: ["Run a full re-scan."],
  }),
  "trust.identity_consistency": agent({
    editClasses: [...SCHEMA, ...META],
    grounding: "page_text_inputs",
    verifyScope: "full",
    manualSteps: [
      "Use one organisation name everywhere (schema, og:site_name, footer, about page).",
    ],
    validationSteps: ["Run a full re-scan."],
  }),
  "trust.contact_domain": manual(
    ["Use a contact email on your own domain instead of a free mailbox."],
    ["Re-scan the contact page."],
  ),
  "trust.authorship": agent({
    editClasses: ["visible byline", "author in Article JSON-LD"],
    grounding: "page_text_inputs",
    inputs: [
      {
        key: "author_name",
        label: "Author name",
        why: "Mellox won't invent who wrote a page.",
        example: "Jane Doe",
      },
    ],
    manualSteps: ["Show the real author on articles and add author to the Article schema."],
    validationSteps: [rescanPage],
  }),
  "trust.author_credentials": agent({
    editClasses: ["author bio text", "Person JSON-LD"],
    grounding: "page_text_inputs",
    inputs: [
      {
        key: "author_credentials",
        label: "Author role / credentials",
        why: "Credentials must be real; Mellox only adds what you provide.",
        example: "Head of Product, 10 years in logistics software",
      },
    ],
    manualSteps: ["Add a short, accurate author bio with relevant credentials."],
    validationSteps: [rescanPage],
  }),
  "trust.dates": agent({
    editClasses: ["visible published/updated date", "datePublished/dateModified in JSON-LD"],
    grounding: "page_text_inputs",
    inputs: [
      {
        key: "date_published",
        label: "Publication date (YYYY-MM-DD)",
        why: "Dates must be true; Mellox won't guess them.",
        example: "2026-03-14",
      },
    ],
    manualSteps: ["Show when the page was published/updated and match it in the schema."],
    validationSteps: [rescanPage],
  }),
  "trust.claims_sourced": manual(
    ["Link statistics and strong claims to their sources. Only you know the sources."],
    [rescanPage],
  ),
  "trust.superlatives": manual(
    ["Replace unsupported superlatives (“best”, “#1”) with verifiable statements or cite proof."],
    [rescanPage],
  ),
  "trust.citations": manual(
    ["Cite reputable external sources where the page makes factual claims."],
    [rescanPage],
  ),
  "trust.anchor_text": agent({
    editClasses: ["link anchor text"],
    grounding: "page_text",
    manualSteps: ["Replace “click here” style links with descriptive anchor text."],
    validationSteps: [rescanPage],
  }),
  "trust.commercial_balance": manual(
    ["Balance promotional copy with informative content that answers visitors' questions."],
    [rescanPage],
  ),

  /* ── Performance & rendering ── */
  "perf.server_rendered": manual(
    [
      "Render the page's main content on the server (SSR/SSG or prerendering) so crawlers that don't run JavaScript can read it.",
      "For single-page apps: add prerendering for public routes, or migrate those routes to a framework with server rendering.",
    ],
    [
      "curl -s https://your-site/page | grep a sentence from the page; it must be present without JavaScript.",
    ],
  ),
  "perf.js_dependent_content": agent({
    editClasses: ["static fallback markup for key content", "server-rendered metadata"],
    grounding: "page_text",
    risk: "Changing what renders before JavaScript can affect hydration; check the page after deploy.",
    manualSteps: [
      "Make sure headings, key copy and metadata are present in the server HTML, not only after JavaScript runs.",
    ],
    validationSteps: ["curl the page and confirm the key copy is in the HTML.", rescanPage],
  }),
  "perf.viewport": agent({
    editClasses: META,
    manualSteps: [
      'Declare <meta name="viewport" content="width=device-width, initial-scale=1"> (Next.js: export viewport).',
    ],
    validationSteps: [viewSource("a viewport meta tag"), rescanPage],
  }),
  "perf.charset": agent({
    editClasses: META,
    manualSteps: ['Declare <meta charset="utf-8"> as the first element in <head>.'],
    validationSteps: [viewSource('<meta charset="utf-8">'), rescanPage],
  }),
  "perf.html_size": manual(
    ["Reduce the HTML payload: remove inlined data blobs, large inline SVGs and unused markup."],
    ["curl -s https://your-site/page | wc -c is under ~1 MB."],
  ),
  "perf.response_time": manual(
    ["Cache or statically generate the page, or move it closer to users with a CDN."],
    ["curl -w '%{time_starttransfer}' shows under ~800 ms."],
  ),
  "perf.text_ratio": agent({
    editClasses: ["removing unused inline markup", "semantic markup"],
    manualSteps: [
      "Reduce markup bloat relative to readable text (inline styles, wrappers, inline data).",
    ],
    validationSteps: [rescanPage],
  }),
};

const FALLBACK = manual(["Follow the recommendation shown for this finding."], [rescanPage]);

export function strategyForRule(ruleId: string): FixStrategy {
  const key = ruleId.startsWith("ai.bot.") ? "ai.bots" : ruleId;
  const s = STRATEGIES[key] ?? FALLBACK;
  // The deterministic fast path only exists for rules the target planner knows.
  if (s.mode === "deterministic" && !fixKindForRule(ruleId)) return { ...s, mode: "agent" };
  return s;
}

/** Whether a finding can be worked on by the agent (deterministic kinds still go through it for dynamic routes). */
export function isAgentFixable(ruleId: string): boolean {
  return strategyForRule(ruleId).mode !== "manual";
}

/** Rule ids without an explicit strategy (tests assert this is empty). */
export function rulesWithoutStrategy(): string[] {
  return GEO_RULES.map((r) => r.id).filter((id) => !STRATEGIES[id] && !id.startsWith("ai.bot."));
}
