// cms-fixes.ts — how each AI Visibility rule is fixed on a WordPress or
// Webflow site, where there is no repository and no pull request.
//
// A CMS fix is a set of field changes (before → after) on real objects: a
// post's meta description, a Webflow page's SEO title, a site's robots.txt.
// For every rule and platform this module says whether Mellox can
//
//   apply     write the change through the platform's API after approval
//   assisted  build the exact snippet and show where to paste it (the API
//             can't reach that setting, e.g. Webflow's head custom code)
//   manual    it needs a person's judgement or facts only the business has
//
// Pure and browser-safe. A test enforces that every rule has an entry.

import { GEO_RULES } from "./rules";

export type CmsProvider = "wordpress" | "webflow";

/** Where WordPress head tags can be written (see src/server/sites/resolve.server.ts). */
export type WordPressSeoBackend = "mellox" | "rankmath" | "jetpack" | "none";

export type CmsField =
  | "seo_title"
  | "meta_description"
  | "canonical"
  | "noindex"
  | "og"
  | "jsonld_page"
  | "jsonld_site"
  | "robots_txt"
  | "llms_txt"
  | "content_html"
  | "image_alt";

export type CmsTarget =
  | { kind: "wp_object"; type: "post" | "page"; id: number; url: string }
  | { kind: "wp_site"; url: string }
  | { kind: "wp_media"; id: number; url: string }
  | { kind: "webflow_page"; siteId: string; pageId: string; url: string }
  | { kind: "webflow_item"; siteId: string; collectionId: string; itemId: string; url: string };

/** One field on one object, exactly as it will be written. */
export type CmsChange = {
  target: CmsTarget;
  field: CmsField;
  /** Platform-specific key the value is written to (e.g. rank_math_description). */
  key: string;
  label: string;
  before: string | boolean | null;
  after: string | boolean | null;
  /** Why this value — shown next to the before/after. */
  reason: string;
};

export type CmsFixMode = "apply" | "assisted" | "manual";

export type CmsRulePlan = {
  mode: CmsFixMode;
  fields: CmsField[];
  /** Plain-language reason for the mode (shown to the person). */
  reason: string;
};

type Entry = { fields: CmsField[]; scope: "page" | "site" };

const RULE_FIELDS: Record<string, Entry> = {
  "ai.robots_txt": { fields: ["robots_txt"], scope: "site" },
  "ai.llms_txt": { fields: ["llms_txt"], scope: "site" },
  "tech.robots_sitemap": { fields: ["robots_txt"], scope: "site" },
  "tech.title": { fields: ["seo_title"], scope: "page" },
  "tech.duplicate_title": { fields: ["seo_title"], scope: "page" },
  "tech.meta_description": { fields: ["meta_description"], scope: "page" },
  "tech.duplicate_description": { fields: ["meta_description"], scope: "page" },
  "tech.canonical": { fields: ["canonical"], scope: "page" },
  "tech.indexable": { fields: ["noindex"], scope: "page" },
  "schema.jsonld": { fields: ["jsonld_site"], scope: "site" },
  "schema.organization": { fields: ["jsonld_site"], scope: "site" },
  "schema.website": { fields: ["jsonld_site"], scope: "site" },
  "schema.page_type": { fields: ["jsonld_page"], scope: "page" },
  "schema.breadcrumbs": { fields: ["jsonld_page"], scope: "page" },
  "schema.open_graph": { fields: ["og"], scope: "page" },
  "schema.twitter_card": { fields: ["og"], scope: "page" },
  "content.faq_schema": { fields: ["jsonld_page"], scope: "page" },
  "content.h1": { fields: ["content_html"], scope: "page" },
  "content.heading_hierarchy": { fields: ["content_html"], scope: "page" },
  "content.title_h1_alignment": { fields: ["seo_title"], scope: "page" },
  "content.direct_answers": { fields: ["content_html"], scope: "page" },
  "content.questions_answered": { fields: ["content_html"], scope: "page" },
  "content.semantic_html": { fields: ["content_html"], scope: "page" },
  "content.scannable": { fields: ["content_html"], scope: "page" },
  "content.image_alt": { fields: ["image_alt"], scope: "page" },
  "content.internal_links": { fields: ["content_html"], scope: "page" },
};

/** The fields a rule's fix writes, or [] when it can't be fixed by writing fields. */
export function cmsFieldsForRule(ruleId: string): CmsField[] {
  if (ruleId.startsWith("ai.bot.")) return ["robots_txt"];
  return RULE_FIELDS[ruleId]?.fields ?? [];
}

export function cmsScopeForRule(ruleId: string): "page" | "site" {
  if (ruleId.startsWith("ai.bot.")) return "site";
  return RULE_FIELDS[ruleId]?.scope ?? "page";
}

/** Rules with no CMS field mapping — kept explicit so the test can tell "manual" from "forgotten". */
export const CMS_MANUAL_RULES: ReadonlySet<string> = new Set([
  "tech.https",
  "tech.sitemap",
  "tech.http_errors",
  "tech.lang",
  "tech.hreflang",
  "tech.broken_links",
  "tech.crawl_depth",
  "schema.org_sameas",
  "schema.entity_consistency",
  "content.substance",
  "content.topic_focus",
  "content.keyword_stuffing",
  "trust.about",
  "trust.contact",
  "trust.privacy",
  "trust.terms",
  "trust.org_identity",
  "trust.identity_consistency",
  "trust.contact_domain",
  "trust.authorship",
  "trust.author_credentials",
  "trust.dates",
  "trust.claims_sourced",
  "trust.superlatives",
  "trust.citations",
  "trust.anchor_text",
  "trust.commercial_balance",
  "perf.server_rendered",
  "perf.js_dependent_content",
  "perf.viewport",
  "perf.charset",
  "perf.html_size",
  "perf.response_time",
  "perf.text_ratio",
]);

/** Rule ids that have neither a field mapping nor an explicit manual entry. */
export function rulesWithoutCmsEntry(): string[] {
  return GEO_RULES.map((r) => r.id).filter(
    (id) => !cmsFieldsForRule(id).length && !CMS_MANUAL_RULES.has(id),
  );
}

export type CmsTargetKind = CmsTarget["kind"];

/**
 * Can this field be written on this platform, for this kind of page?
 * `pageKind` is what the live page is: a WordPress post/page, the WordPress
 * home or archive (no single object), a static Webflow page or a CMS item.
 */
export function fieldSupport(
  field: CmsField,
  ctx: {
    provider: CmsProvider;
    wpSeo?: WordPressSeoBackend;
    pageKind: "wp_object" | "wp_other" | "webflow_page" | "webflow_item" | "unknown";
  },
): { mode: CmsFixMode; reason: string } {
  const { provider, wpSeo = "none", pageKind } = ctx;
  if (provider === "wordpress") {
    const needsObject = (what: string) =>
      pageKind === "wp_object"
        ? null
        : {
            mode: "assisted" as const,
            reason: `This page isn't a single WordPress post or page, so ${what} is set in your theme or SEO plugin.`,
          };
    switch (field) {
      case "seo_title":
      case "meta_description":
        return (
          needsObject("it") ??
          (wpSeo === "none"
            ? {
                mode: "assisted",
                reason:
                  "Install the Mellox GEO plugin (or Rank Math) so Mellox can set this on WordPress.",
              }
            : { mode: "apply", reason: `Mellox writes it through ${seoName(wpSeo)}.` })
        );
      case "canonical":
      case "og":
        return (
          needsObject("it") ??
          (wpSeo === "mellox" || wpSeo === "rankmath"
            ? { mode: "apply", reason: `Mellox writes it through ${seoName(wpSeo)}.` }
            : {
                mode: "assisted",
                reason: "Install the Mellox GEO plugin so Mellox can set this on WordPress.",
              })
        );
      case "noindex":
        return (
          needsObject("it") ??
          (wpSeo === "none"
            ? {
                mode: "assisted",
                reason: "Install the Mellox GEO plugin so Mellox can change indexing on WordPress.",
              }
            : { mode: "apply", reason: `Mellox writes it through ${seoName(wpSeo)}.` })
        );
      case "jsonld_page":
        return (
          needsObject("structured data") ??
          (wpSeo === "mellox"
            ? { mode: "apply", reason: "Mellox adds it through the Mellox GEO plugin." }
            : {
                mode: "assisted",
                reason: "Install the Mellox GEO plugin so Mellox can add structured data.",
              })
        );
      case "jsonld_site":
      case "robots_txt":
      case "llms_txt":
        return wpSeo === "mellox"
          ? { mode: "apply", reason: "Mellox sets it through the Mellox GEO plugin." }
          : {
              mode: "assisted",
              reason:
                "Install the Mellox GEO plugin so Mellox can set this site-wide on WordPress.",
            };
      case "content_html":
        return (
          needsObject("that content") ?? {
            mode: "apply",
            reason: "Mellox edits the page's content in WordPress.",
          }
        );
      case "image_alt":
        return (
          needsObject("that content") ?? {
            mode: "apply",
            reason: "Mellox sets alt text on the images in WordPress.",
          }
        );
    }
  }
  // Webflow
  switch (field) {
    case "seo_title":
    case "meta_description":
    case "og":
      return pageKind === "webflow_page"
        ? { mode: "apply", reason: "Mellox updates the page's SEO settings in Webflow." }
        : {
            mode: "assisted",
            reason:
              "This is a CMS page; its SEO settings come from the collection template in Webflow.",
          };
    case "content_html":
      return pageKind === "webflow_item"
        ? { mode: "apply", reason: "Mellox edits this CMS item's rich text in Webflow." }
        : {
            mode: "assisted",
            reason: "Static page text is edited in the Webflow Designer.",
          };
    case "canonical":
    case "noindex":
    case "jsonld_page":
    case "jsonld_site":
    case "robots_txt":
    case "llms_txt":
    case "image_alt":
      return {
        mode: "assisted",
        reason:
          "Webflow's API can't change this setting; Mellox gives you the exact value to paste.",
      };
  }
}

function seoName(b: WordPressSeoBackend): string {
  return b === "mellox"
    ? "the Mellox GEO plugin"
    : b === "rankmath"
      ? "Rank Math"
      : b === "jetpack"
        ? "Jetpack SEO"
        : "WordPress";
}

export const FIELD_LABEL: Record<CmsField, string> = {
  seo_title: "SEO title",
  meta_description: "Meta description",
  canonical: "Canonical link",
  noindex: "Search indexing",
  og: "Social sharing (Open Graph)",
  jsonld_page: "Structured data (JSON-LD)",
  jsonld_site: "Site structured data (JSON-LD)",
  robots_txt: "robots.txt",
  llms_txt: "llms.txt",
  content_html: "Page content",
  image_alt: "Image alt text",
};

export function targetLabel(t: CmsTarget): string {
  switch (t.kind) {
    case "wp_object":
      return `WordPress ${t.type} #${t.id}`;
    case "wp_site":
      return "WordPress site settings";
    case "wp_media":
      return `WordPress image #${t.id}`;
    case "webflow_page":
      return "Webflow page";
    case "webflow_item":
      return "Webflow CMS item";
  }
}

/** Display string of a value for the before/after diff. */
export function displayValue(v: string | boolean | null): string {
  if (v === null || v === "") return "";
  if (typeof v === "boolean") return v ? "Hidden from search (noindex)" : "Visible to search";
  return v;
}
