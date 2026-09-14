// score.ts — explainable scoring, findings and prioritised actions.
//
// Port of the GEO module's DeterministicScoringEngine + ScoreExplanationEngine
// + opportunity prioritisation, applied to the Mellox rule catalog:
//
//   rule credit      pass 1 · warn 0.5 · fail 0 · na excluded
//   page rule credit mean credit over the pages it applies to
//   category score   Σ(weight × credit) / Σ(weight of applicable rules) × 100
//   overall score    Σ(category score × category weight)
//   points lost      (1 − credit) × weight / Σweight × 100 × category weight
//   priority         0.5·impact + 0.25·confidence + 0.25·(1 − effort)
//
// Every deduction is traceable: finding → rule → evidence → points lost. A
// rule can only cost points once per page, and N/A never penalises.

import {
  GEO_RULES,
  type GeoRule,
  type PageRule,
  type ScanMode,
  type SiteContext,
  type SiteRule,
} from "./rules";
import { summarizeEngines } from "./robots";
import {
  GEO_CATEGORIES,
  type CategoryScore,
  type CrawledPage,
  type Effort,
  type GeoAction,
  type GeoCategoryId,
  type GeoFinding,
  type Priority,
  type RuleOutcome,
  type RuleStatus,
  type RuleSummary,
  type ScanReport,
  type ScoreTier,
  type Severity,
  type SiteArtifacts,
} from "./types";

const CREDIT: Record<Exclude<RuleStatus, "na">, number> = { pass: 1, warn: 0.5, fail: 0 };
const SEVERITY_IMPACT: Record<Severity, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.5,
  low: 0.25,
};
const EFFORT_VALUE: Record<Effort, number> = { low: 0.25, medium: 0.5, high: 0.75 };
const DOWNGRADE: Record<Severity, Severity> = {
  critical: "high",
  high: "medium",
  medium: "low",
  low: "low",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreTier(score: number): ScoreTier {
  return score >= 80 ? "strong" : score >= 55 ? "workable" : "needs_work";
}

export function priorityFor(
  impact: number,
  confidence: number,
  effort: Effort,
): { score: number; priority: Priority } {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const score =
    Math.round(
      (0.5 * clamp(impact) + 0.25 * clamp(confidence) + 0.25 * (1 - EFFORT_VALUE[effort])) * 1000,
    ) / 1000;
  const priority: Priority =
    score >= 0.8 ? "critical" : score >= 0.6 ? "high" : score >= 0.4 ? "medium" : "low";
  return { score, priority };
}

/** Stable finding identity across scans: rule + host + path (+ query). */
export function fingerprintFor(ruleId: string, host: string, pageUrl: string | null): string {
  if (!pageUrl) return `${ruleId}|${host}`;
  try {
    const u = new URL(pageUrl);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${ruleId}|${u.hostname.replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return `${ruleId}|${pageUrl}`;
  }
}

function buildContext(site: SiteArtifacts, pages: CrawledPage[], mode: ScanMode): SiteContext {
  const analyzed = pages
    .filter((p) => p.state === "fetched" && p.analysis && (p.statusCode ?? 200) < 400)
    .map((p) => ({ page: p, a: p.analysis! }));
  const statusByUrl = new Map<string, number | null>();
  for (const p of pages) {
    statusByUrl.set(p.url, p.statusCode);
    if (p.finalUrl) statusByUrl.set(p.finalUrl, p.statusCode);
  }
  const titleCounts = new Map<string, number>();
  const descriptionCounts = new Map<string, number>();
  for (const { a } of analyzed) {
    if (a.title)
      titleCounts.set(a.title.toLowerCase(), (titleCounts.get(a.title.toLowerCase()) ?? 0) + 1);
    if (a.metaDescription) {
      const key = a.metaDescription.toLowerCase();
      descriptionCounts.set(key, (descriptionCounts.get(key) ?? 0) + 1);
    }
  }
  const home =
    analyzed.find(({ a }) => a.pageType === "home") ??
    analyzed.slice().sort((x, y) => x.page.depth - y.page.depth)[0] ??
    null;
  return { site, mode, pages, analyzed, home, statusByUrl, titleCounts, descriptionCounts };
}

type Evaluation = {
  rule: GeoRule;
  /** One outcome for site rules; one per analyzed page for page rules. */
  outcomes: { pageUrl: string | null; outcome: RuleOutcome }[];
};

function safeEvaluate(fn: () => RuleOutcome, ruleId: string): RuleOutcome {
  try {
    return fn();
  } catch (error) {
    // A rule bug must not fail the scan — it is excluded and reported as N/A.
    console.error(`[geo] rule ${ruleId} threw`, error);
    return { status: "na", detail: "This check could not be evaluated." };
  }
}

function evaluateRules(ctx: SiteContext, rules: readonly GeoRule[]): Evaluation[] {
  return rules.map((rule) => {
    if (rule.scope === "site") {
      const outcome = safeEvaluate(() => (rule as SiteRule).evaluate(ctx), rule.id);
      return { rule, outcomes: [{ pageUrl: null, outcome }] };
    }
    return {
      rule,
      outcomes: ctx.analyzed.map(({ page, a }) => ({
        pageUrl: a.url,
        outcome: safeEvaluate(() => (rule as PageRule).evaluate({ page, a, site: ctx }), rule.id),
      })),
    };
  });
}

function summarizeRule(ev: Evaluation): Omit<RuleSummary, "pointsLost"> {
  const applicable = ev.outcomes.filter((o) => o.outcome.status !== "na");
  const passed = applicable.filter((o) => o.outcome.status === "pass").length;
  const warned = applicable.filter((o) => o.outcome.status === "warn").length;
  const failed = applicable.filter((o) => o.outcome.status === "fail").length;
  const credit = applicable.length
    ? applicable.reduce(
        (sum, o) => sum + CREDIT[o.outcome.status as Exclude<RuleStatus, "na">],
        0,
      ) / applicable.length
    : 1;
  const status: RuleStatus = !applicable.length
    ? "na"
    : credit === 1
      ? "pass"
      : failed > 0 && credit < 0.5
        ? "fail"
        : "warn";

  let detail: string;
  if (ev.rule.scope === "site" || ev.outcomes.length <= 1) {
    detail = ev.outcomes[0]?.outcome.detail ?? "Not evaluated.";
  } else if (!applicable.length) {
    detail = ev.outcomes[0]?.outcome.detail ?? "Not applicable to the crawled pages.";
  } else if (status === "pass") {
    detail = `Passes on all ${applicable.length} applicable pages.`;
  } else {
    const worst =
      applicable.find((o) => o.outcome.status === "fail") ??
      applicable.find((o) => o.outcome.status === "warn");
    detail = `${failed + warned} of ${applicable.length} pages need work${worst ? ` — e.g. ${worst.outcome.detail}` : ""}`;
  }

  return {
    ruleId: ev.rule.id,
    category: ev.rule.category,
    scope: ev.rule.scope,
    title: ev.rule.title,
    weight: ev.rule.weight,
    status,
    credit: Math.round(credit * 1000) / 1000,
    applicable: applicable.length,
    passed,
    warned,
    failed,
    detail,
  };
}

export type ScoredScan = {
  report: ScanReport;
  findings: GeoFinding[];
  /** Per-page score keyed by page URL. */
  pageScores: Map<string, { score: number; categories: Partial<Record<GeoCategoryId, number>> }>;
};

export function scoreScan(
  site: SiteArtifacts,
  pages: CrawledPage[],
  opts: { mode: ScanMode; rules?: readonly GeoRule[] } = { mode: "full" },
): ScoredScan {
  const ctx = buildContext(site, pages, opts.mode);
  const evaluations = evaluateRules(ctx, opts.rules ?? GEO_RULES);

  /* ── Categories and points ── */
  const categories: CategoryScore[] = GEO_CATEGORIES.map((meta) => {
    const evs = evaluations.filter((e) => e.rule.category === meta.id);
    const summaries = evs.map(summarizeRule);
    const active = summaries.filter((s) => s.status !== "na");
    const weightSum = active.reduce((sum, s) => sum + s.weight, 0);
    const earned = active.reduce((sum, s) => sum + s.weight * s.credit, 0);
    const score = weightSum ? (earned / weightSum) * 100 : 100;
    const rules: RuleSummary[] = summaries.map((s) => ({
      ...s,
      pointsLost:
        s.status === "na" || !weightSum
          ? 0
          : round1((1 - s.credit) * (s.weight / weightSum) * 100 * meta.weight),
    }));
    return {
      id: meta.id,
      name: meta.name,
      weight: meta.weight,
      score: Math.round(score),
      passed: summaries.filter((s) => s.status === "pass").length,
      warned: summaries.filter((s) => s.status === "warn").length,
      failed: summaries.filter((s) => s.status === "fail").length,
      na: summaries.filter((s) => s.status === "na").length,
      rules,
    };
  });
  const totalWeight = GEO_CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const overall = Math.round(
    categories.reduce((sum, c) => sum + (c.score * c.weight) / totalWeight, 0),
  );
  const ruleSummaryById = new Map(
    categories.flatMap((c) => c.rules.map((r) => [r.ruleId, r] as const)),
  );

  /* ── Findings ── */
  const findings: GeoFinding[] = [];
  for (const ev of evaluations) {
    const summary = ruleSummaryById.get(ev.rule.id);
    if (!summary || summary.status === "na") continue;
    const bad = ev.outcomes.filter(
      (o) => o.outcome.status === "warn" || o.outcome.status === "fail",
    );
    if (!bad.length) continue;
    const deficit = bad.reduce((s, o) => s + (1 - CREDIT[o.outcome.status as "warn" | "fail"]), 0);
    for (const { pageUrl, outcome } of bad) {
      const status = outcome.status as "warn" | "fail";
      const severity = status === "fail" ? ev.rule.severity : DOWNGRADE[ev.rule.severity];
      const { score, priority } = priorityFor(
        SEVERITY_IMPACT[severity],
        ev.rule.confidence,
        ev.rule.effort,
      );
      findings.push({
        ruleId: ev.rule.id,
        category: ev.rule.category,
        status,
        severity,
        priority,
        priorityScore: score,
        title: ev.rule.title,
        detail: outcome.detail,
        evidence: outcome.evidence ?? {},
        pageUrl,
        fingerprint: fingerprintFor(ev.rule.id, site.host, pageUrl),
        pointImpact: deficit ? round1((summary.pointsLost * (1 - CREDIT[status])) / deficit) : 0,
        fixId: ev.rule.fixId,
        safety: ev.rule.safety,
        effort: ev.rule.effort,
      });
    }
  }
  findings.sort((a, b) => b.priorityScore - a.priorityScore || b.pointImpact - a.pointImpact);

  /* ── Actions: findings grouped by actionKey ── */
  const groups = new Map<string, GeoFinding[]>();
  for (const f of findings) {
    const rule = GEO_RULES.find((r) => r.id === f.ruleId);
    const key = rule?.actionKey ?? f.ruleId;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const actions: GeoAction[] = [...groups.entries()].map(([key, group]) => {
    const lead = group.reduce(
      (best, f) => (f.priorityScore > best.priorityScore ? f : best),
      group[0],
    );
    const rule = GEO_RULES.find((r) => r.id === lead.ruleId)!;
    const pointsLost = round1(group.reduce((s, f) => s + f.pointImpact, 0));
    const pageUrls = new Set(group.map((f) => f.pageUrl).filter(Boolean));
    // Points recoverable nudge priority so a site-wide problem outranks a one-page nit.
    const impact = Math.min(1, SEVERITY_IMPACT[lead.severity] + Math.min(0.2, pointsLost / 25));
    const { score, priority } = priorityFor(impact, rule.confidence, rule.effort);
    const detail =
      pageUrls.size > 1
        ? `Affects ${pageUrls.size} pages — ${lead.detail}`
        : group.length > 1 && rule.actionKey
          ? group
              .map((f) => f.detail)
              .slice(0, 3)
              .join(" ")
          : lead.detail;
    return {
      ruleId: key,
      category: lead.category,
      priority,
      priorityScore: score,
      title: rule.recommendation,
      detail,
      affectedPages: pageUrls.size,
      pointsLost,
      fixId: lead.fixId,
      safety: lead.safety,
      effort: lead.effort,
    };
  });
  actions.sort((a, b) => b.priorityScore - a.priorityScore || b.pointsLost - a.pointsLost);

  /* ── Per-page scores (page rules only, categories renormalised) ── */
  const pageScores = new Map<
    string,
    { score: number; categories: Partial<Record<GeoCategoryId, number>> }
  >();
  for (const { a } of ctx.analyzed) {
    const catScores: Partial<Record<GeoCategoryId, number>> = {};
    let weighted = 0;
    let weightUsed = 0;
    for (const meta of GEO_CATEGORIES) {
      let w = 0;
      let earned = 0;
      for (const ev of evaluations) {
        if (ev.rule.scope !== "page" || ev.rule.category !== meta.id) continue;
        const o = ev.outcomes.find((x) => x.pageUrl === a.url)?.outcome;
        if (!o || o.status === "na") continue;
        w += ev.rule.weight;
        earned += ev.rule.weight * CREDIT[o.status];
      }
      if (!w) continue;
      const s = (earned / w) * 100;
      catScores[meta.id] = Math.round(s);
      weighted += s * meta.weight;
      weightUsed += meta.weight;
    }
    pageScores.set(a.url, {
      score: weightUsed ? Math.round(weighted / weightUsed) : 100,
      categories: catScores,
    });
  }

  const allRules = categories.flatMap((c) => c.rules);
  const home = ctx.home?.a;
  const report: ScanReport = {
    overall,
    tier: scoreTier(overall),
    categories,
    actions,
    engines: summarizeEngines(site.robots.status === "found" ? site.robots.text : ""),
    counts: {
      pagesCrawled: ctx.analyzed.length,
      pagesFailed: pages.filter(
        (p) => p.state === "failed" || (p.state === "fetched" && (p.statusCode ?? 0) >= 400),
      ).length,
      pagesSkipped: pages.filter((p) => p.state === "skipped").length,
      passed: allRules.filter((r) => r.status === "pass").length,
      warned: allRules.filter((r) => r.status === "warn").length,
      failed: allRules.filter((r) => r.status === "fail").length,
      findings: findings.length,
    },
    snapshot: {
      title: home?.title ?? null,
      description: home?.metaDescription ?? null,
      schemaTypes: home?.schema.types.slice(0, 12) ?? [],
      words: home?.text.words ?? 0,
      sitemapUrls: site.sitemap.urls,
      llmsTxt: site.llms.found,
    },
    pageScores: [...pageScores.entries()]
      .map(([url, v]) => ({ url, score: v.score, categories: v.categories }))
      .sort((x, y) => x.score - y.score)
      .slice(0, 500),
  };

  return { report, findings, pageScores };
}
