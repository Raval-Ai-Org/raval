import { describe, expect, it } from "vitest";
import { analyzePage } from "./analyze-page";
import { compareScans } from "./compare";
import { fixRecipeFor } from "./fix-recipes";
import { GEO_RULES } from "./rules";
import { fingerprintFor, priorityFor, scoreScan } from "./score";
import { GEO_CATEGORIES, type CrawledPage, type SiteArtifacts } from "./types";
import { ACME_HOME } from "./test-fixtures";

function page(url: string, html: string, extra: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url,
    finalUrl: url,
    depth: 0,
    state: "fetched",
    statusCode: 200,
    contentType: "text/html",
    fetchMs: 300,
    skipReason: null,
    xRobotsTag: null,
    analysis: analyzePage(html, url),
    ...extra,
  };
}

const goodSite: SiteArtifacts = {
  origin: "https://acme.io",
  host: "acme.io",
  https: true,
  robots: {
    status: "found",
    text: "User-agent: *\nAllow: /\nSitemap: https://acme.io/sitemap.xml",
    sitemaps: ["https://acme.io/sitemap.xml"],
  },
  llms: { found: true, bytes: 120, full: false },
  sitemap: { found: true, urls: 3, isIndex: false, sources: ["https://acme.io/sitemap.xml"] },
};

const badSite: SiteArtifacts = {
  origin: "http://bad.io",
  host: "bad.io",
  https: false,
  robots: { status: "found", text: "User-agent: *\nDisallow: /", sitemaps: [] },
  llms: { found: false, bytes: 0, full: false },
  sitemap: { found: false, urls: 0, isIndex: false, sources: [] },
};

const BAD_HTML = `<html><head><meta name="robots" content="noindex"></head><body><div>Hi</div></body></html>`;

describe("rule catalog", () => {
  it("has unique ids, valid categories and a recipe for every fix id", () => {
    const ids = GEO_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(GEO_CATEGORIES.map((c) => c.id));
    for (const rule of GEO_RULES) {
      expect(categories.has(rule.category), rule.id).toBe(true);
      expect(rule.weight, rule.id).toBeGreaterThan(0);
      if (rule.fixId)
        expect(fixRecipeFor(rule.fixId, { url: "https://acme.io" }), rule.fixId).not.toBeNull();
    }
    expect(GEO_CATEGORIES.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
  });
});

describe("scoreScan", () => {
  const good = scoreScan(goodSite, [page("https://acme.io/", ACME_HOME)], { mode: "quick" });
  const bad = scoreScan(badSite, [page("http://bad.io/", BAD_HTML)], { mode: "quick" });

  it("scores a well-built site far above a broken one", () => {
    expect(good.report.overall).toBeGreaterThan(bad.report.overall + 30);
    expect(good.report.categories).toHaveLength(6);
    for (const c of [...good.report.categories, ...bad.report.categories]) {
      expect(Number.isFinite(c.score)).toBe(true);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
    expect(bad.report.tier).toBe("needs_work");
  });

  it("explains every lost point: category deductions add up to the gap from 100", () => {
    for (const c of bad.report.categories) {
      const lost = c.rules.reduce((s, r) => s + r.pointsLost, 0);
      expect(lost).toBeCloseTo((100 - c.score) * c.weight, 0);
    }
  });

  it("never penalises N/A rules", () => {
    const multiPageOnly = bad.report.categories
      .flatMap((c) => c.rules)
      .find((r) => r.ruleId === "tech.duplicate_title");
    expect(multiPageOnly).toMatchObject({ status: "na", pointsLost: 0 });
  });

  it("emits traceable findings with stable fingerprints", () => {
    const noindex = bad.findings.find((f) => f.ruleId === "tech.indexable");
    expect(noindex).toMatchObject({
      status: "fail",
      severity: "critical",
      pageUrl: "http://bad.io/",
      fixId: "noindex",
    });
    expect(noindex!.fingerprint).toBe("tech.indexable|bad.io/");
    expect(bad.findings.find((f) => f.ruleId === "tech.https")!.fingerprint).toBe(
      "tech.https|bad.io",
    );
    expect(bad.findings.every((f) => f.pointImpact >= 0)).toBe(true);
  });

  it("groups crawler blocks into one prioritised action", () => {
    const bots = bad.report.actions.filter((a) => a.ruleId === "ai.bots");
    expect(bots).toHaveLength(1);
    expect(bots[0].title).toBe("Unblock AI crawlers in robots.txt");
    const scores = bad.report.actions.map((a) => a.priorityScore);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(bad.report.engines.every((e) => e.state === "blocked")).toBe(true);
  });

  it("aggregates page rules across a multi-page crawl", () => {
    const pages = [
      page("https://acme.io/", ACME_HOME),
      page(
        "https://acme.io/a",
        "<html><head><title>Same title for both pages</title></head><body><h1>A</h1></body></html>",
        { depth: 1 },
      ),
      page(
        "https://acme.io/b",
        "<html><head><title>Same title for both pages</title></head><body><h1>B</h1><a href='/gone'>x</a></body></html>",
        { depth: 1 },
      ),
      { ...page("https://acme.io/gone", "", { depth: 2 }), statusCode: 404, analysis: null },
    ];
    const full = scoreScan(goodSite, pages, { mode: "full" });
    const dup = full.report.categories
      .flatMap((c) => c.rules)
      .find((r) => r.ruleId === "tech.duplicate_title")!;
    expect(dup).toMatchObject({ applicable: 3, warned: 2 });
    expect(
      full.findings.filter((f) => f.ruleId === "tech.broken_links").map((f) => f.pageUrl),
    ).toEqual(["https://acme.io/b"]);
    expect(full.report.counts).toMatchObject({ pagesCrawled: 3, pagesFailed: 1 });
    expect(full.pageScores.size).toBe(3);
  });
});

describe("prioritisation and comparison", () => {
  it("bands the GEO module's impact / confidence / effort composite", () => {
    expect(priorityFor(1, 1, "low")).toMatchObject({ priority: "critical" });
    expect(priorityFor(0.25, 0.5, "high").priority).toBe("low");
    expect(fingerprintFor("x", "a.io", "https://www.a.io/p/?q=1")).toBe("x|a.io/p?q=1");
  });

  it("diffs two scans by fingerprint", () => {
    const base = {
      id: "1",
      createdAt: "2026-01-01",
      overall: 40,
      categories: [{ id: "technical" as const, score: 50 }],
      findings: [
        {
          fingerprint: "a",
          ruleId: "r",
          title: "A",
          detail: "",
          severity: "high" as const,
          category: "technical" as const,
          pageUrl: null,
          pointImpact: 3,
        },
        {
          fingerprint: "b",
          ruleId: "r",
          title: "B",
          detail: "",
          severity: "low" as const,
          category: "technical" as const,
          pageUrl: null,
          pointImpact: 1,
        },
      ],
    };
    const target = {
      ...base,
      id: "2",
      overall: 55,
      categories: [{ id: "technical" as const, score: 70 }],
      findings: [
        base.findings[1],
        {
          fingerprint: "c",
          ruleId: "r",
          title: "C",
          detail: "",
          severity: "critical" as const,
          category: "technical" as const,
          pageUrl: null,
          pointImpact: 5,
        },
      ],
    };
    const diff = compareScans(base, target);
    expect(diff.overallDelta).toBe(15);
    expect(diff.resolvedFindings.map((f) => f.fingerprint)).toEqual(["a"]);
    expect(diff.newFindings.map((f) => f.fingerprint)).toEqual(["c"]);
    expect(diff.regressions).toHaveLength(1);
    expect(diff.persistingCount).toBe(1);
    expect(diff.categories[0]).toMatchObject({ before: 50, after: 70, delta: 20 });
  });
});
