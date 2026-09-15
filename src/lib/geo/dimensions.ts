// dimensions.ts — the GEO readiness score broken into the dimensions people
// ask about (crawlability, indexability, answer readiness …), computed from the
// rule summaries the server already produced for a scan (score.ts). Nothing is
// re-evaluated and nothing is invented: a dimension's score is the weighted
// credit of the rules that feed it, N/A rules excluded.
//
//   rule credit          pass 1 · warn 0.5 · fail 0 (from score.ts)
//   dimension score      Σ(rule weight × share × credit) / Σ(rule weight × share)
//   overall readiness    Σ(dimension score × dimension weight) over dimensions with data
//
// A score describes how well the site follows these checks. It doesn't
// guarantee rankings, traffic or AI citations.

import type { RuleSummary, ScanReport } from "./types";

export type GeoDimensionId =
  | "crawlability"
  | "indexability"
  | "technical_seo"
  | "extractability"
  | "answer_readiness"
  | "entity_clarity"
  | "structured_data"
  | "authority_trust"
  | "ai_search";

export type GeoDimensionMeta = {
  id: GeoDimensionId;
  name: string;
  weight: number;
  question: string;
};

export const GEO_DIMENSIONS: readonly GeoDimensionMeta[] = [
  {
    id: "crawlability",
    name: "Crawlability",
    weight: 0.14,
    question: "Can search and AI crawlers reach your pages?",
  },
  {
    id: "indexability",
    name: "Indexability",
    weight: 0.12,
    question: "Are the right pages allowed into indexes, once each?",
  },
  {
    id: "technical_seo",
    name: "Technical SEO",
    weight: 0.1,
    question: "Is the page metadata complete and correct?",
  },
  {
    id: "extractability",
    name: "Content extractability",
    weight: 0.12,
    question: "Can a machine pull clean, structured passages from your pages?",
  },
  {
    id: "answer_readiness",
    name: "Answer readiness",
    weight: 0.12,
    question: "Do pages answer real questions directly?",
  },
  {
    id: "entity_clarity",
    name: "Entity clarity",
    weight: 0.1,
    question: "Is it clear who you are and what you offer?",
  },
  {
    id: "structured_data",
    name: "Structured data",
    weight: 0.1,
    question: "Is schema.org markup present, valid and relevant?",
  },
  {
    id: "authority_trust",
    name: "Authority & trust",
    weight: 0.12,
    question: "Are authorship, sources and business details verifiable?",
  },
  {
    id: "ai_search",
    name: "AI search readiness",
    weight: 0.08,
    question: "Are AI engines allowed in and given what they need?",
  },
];

export const DIMENSION_BY_ID = Object.fromEntries(GEO_DIMENSIONS.map((d) => [d.id, d])) as Record<
  GeoDimensionId,
  GeoDimensionMeta
>;

type Share = { dim: GeoDimensionId; share: number };
const one = (dim: GeoDimensionId): Share[] => [{ dim, share: 1 }];
const split = (a: GeoDimensionId, sa: number, b: GeoDimensionId): Share[] => [
  { dim: a, share: sa },
  { dim: b, share: Math.round((1 - sa) * 100) / 100 },
];

/** rule id → the dimensions it feeds (shares sum to 1). `ai.bot.*` share one entry. */
export const RULE_DIMENSIONS: Readonly<Record<string, Share[]>> = {
  "ai.robots_txt": split("crawlability", 0.5, "ai_search"),
  "ai.bot.*": split("ai_search", 0.7, "crawlability"),
  "ai.llms_txt": one("ai_search"),
  "tech.https": one("technical_seo"),
  "tech.sitemap": split("crawlability", 0.6, "indexability"),
  "tech.robots_sitemap": one("crawlability"),
  "tech.http_errors": split("crawlability", 0.6, "technical_seo"),
  "tech.indexable": one("indexability"),
  "tech.canonical": split("indexability", 0.7, "technical_seo"),
  "tech.title": split("technical_seo", 0.6, "extractability"),
  "tech.duplicate_title": split("indexability", 0.5, "technical_seo"),
  "tech.meta_description": split("technical_seo", 0.6, "extractability"),
  "tech.duplicate_description": split("indexability", 0.5, "technical_seo"),
  "tech.lang": one("technical_seo"),
  "tech.hreflang": one("technical_seo"),
  "tech.broken_links": one("crawlability"),
  "tech.crawl_depth": one("crawlability"),
  "schema.jsonld": one("structured_data"),
  "schema.organization": split("structured_data", 0.5, "entity_clarity"),
  "schema.org_sameas": split("entity_clarity", 0.5, "structured_data"),
  "schema.website": one("structured_data"),
  "schema.page_type": one("structured_data"),
  "schema.breadcrumbs": one("structured_data"),
  "schema.open_graph": split("technical_seo", 0.5, "entity_clarity"),
  "schema.twitter_card": one("technical_seo"),
  "schema.entity_consistency": split("entity_clarity", 0.5, "structured_data"),
  "content.h1": one("extractability"),
  "content.heading_hierarchy": one("extractability"),
  "content.title_h1_alignment": split("answer_readiness", 0.5, "entity_clarity"),
  "content.substance": split("answer_readiness", 0.5, "extractability"),
  "content.questions_answered": one("answer_readiness"),
  "content.direct_answers": one("answer_readiness"),
  "content.faq_schema": split("answer_readiness", 0.5, "structured_data"),
  "content.topic_focus": split("answer_readiness", 0.5, "entity_clarity"),
  "content.keyword_stuffing": split("answer_readiness", 0.5, "authority_trust"),
  "content.semantic_html": one("extractability"),
  "content.image_alt": split("extractability", 0.5, "technical_seo"),
  "content.internal_links": split("crawlability", 0.5, "extractability"),
  "content.scannable": one("extractability"),
  "trust.about": split("authority_trust", 0.5, "entity_clarity"),
  "trust.contact": split("authority_trust", 0.5, "entity_clarity"),
  "trust.privacy": one("authority_trust"),
  "trust.terms": one("authority_trust"),
  "trust.org_identity": split("entity_clarity", 0.5, "authority_trust"),
  "trust.identity_consistency": split("entity_clarity", 0.5, "authority_trust"),
  "trust.contact_domain": split("authority_trust", 0.5, "entity_clarity"),
  "trust.authorship": one("authority_trust"),
  "trust.author_credentials": one("authority_trust"),
  "trust.dates": one("authority_trust"),
  "trust.claims_sourced": one("authority_trust"),
  "trust.superlatives": one("authority_trust"),
  "trust.citations": one("authority_trust"),
  "trust.anchor_text": split("authority_trust", 0.5, "extractability"),
  "trust.commercial_balance": one("authority_trust"),
  "perf.server_rendered": split("extractability", 0.6, "ai_search"),
  "perf.js_dependent_content": split("extractability", 0.6, "ai_search"),
  "perf.viewport": one("technical_seo"),
  "perf.charset": one("technical_seo"),
  "perf.html_size": split("technical_seo", 0.5, "crawlability"),
  "perf.response_time": split("technical_seo", 0.5, "crawlability"),
  "perf.text_ratio": split("technical_seo", 0.5, "crawlability"),
};

export function sharesForRule(ruleId: string): Share[] | null {
  if (ruleId.startsWith("ai.bot.")) return RULE_DIMENSIONS["ai.bot.*"];
  return RULE_DIMENSIONS[ruleId] ?? null;
}

export type FixMode = "deterministic" | "agent" | "manual";

export type DimensionCheck = {
  ruleId: string;
  title: string;
  status: RuleSummary["status"];
  passed: number;
  warned: number;
  failed: number;
  applicable: number;
  detail: string;
  /** Points this rule costs the legacy overall score (score.ts). */
  pointsLost: number;
  share: number;
  fixMode: FixMode | null;
};

export type DimensionScore = GeoDimensionMeta & {
  /** null when no applicable check fed this dimension. */
  score: number | null;
  checks: DimensionCheck[];
  passed: number;
  warned: number;
  failed: number;
  na: number;
  /** Failing/warning checks an agent or deterministic fix can address. */
  fixable: number;
};

export type ReadinessBreakdown = {
  overall: number | null;
  dimensions: DimensionScore[];
};

const CREDIT = { pass: 1, warn: 0.5, fail: 0 } as const;

export function scoreDimensions(
  report: Pick<ScanReport, "categories">,
  fixModeFor: (ruleId: string) => FixMode | null = () => null,
): ReadinessBreakdown {
  const rules = report.categories.flatMap((c) => c.rules);
  const dimensions: DimensionScore[] = GEO_DIMENSIONS.map((meta) => {
    let weighted = 0;
    let possible = 0;
    const checks: DimensionCheck[] = [];
    for (const r of rules) {
      const share = sharesForRule(r.ruleId)?.find((s) => s.dim === meta.id)?.share;
      if (!share) continue;
      checks.push({
        ruleId: r.ruleId,
        title: r.title,
        status: r.status,
        passed: r.passed,
        warned: r.warned,
        failed: r.failed,
        applicable: r.applicable,
        detail: r.detail,
        pointsLost: r.pointsLost,
        share,
        fixMode: fixModeFor(r.ruleId),
      });
      if (r.status === "na") continue;
      const w = r.weight * share;
      possible += w;
      weighted += w * (Number.isFinite(r.credit) ? r.credit : CREDIT[r.status]);
    }
    const order = { fail: 0, warn: 1, pass: 2, na: 3 } as const;
    checks.sort((a, b) => order[a.status] - order[b.status] || b.pointsLost - a.pointsLost);
    return {
      ...meta,
      score: possible ? Math.round((weighted / possible) * 100) : null,
      checks,
      passed: checks.filter((c) => c.status === "pass").length,
      warned: checks.filter((c) => c.status === "warn").length,
      failed: checks.filter((c) => c.status === "fail").length,
      na: checks.filter((c) => c.status === "na").length,
      fixable: checks.filter(
        (c) => (c.status === "warn" || c.status === "fail") && c.fixMode && c.fixMode !== "manual",
      ).length,
    };
  });
  const scored = dimensions.filter((d) => d.score !== null);
  const totalWeight = scored.reduce((s, d) => s + d.weight, 0);
  const overall = totalWeight
    ? Math.round(scored.reduce((s, d) => s + (d.score as number) * d.weight, 0) / totalWeight)
    : null;
  return { overall, dimensions };
}
