import { describe, expect, it } from "vitest";
import { GEO_DIMENSIONS, RULE_DIMENSIONS, scoreDimensions, sharesForRule } from "./dimensions";
import { GEO_RULES } from "./rules";
import type { RuleSummary } from "./types";

const summary = (ruleId: string, status: RuleSummary["status"], weight = 2): RuleSummary => ({
  ruleId,
  category: "technical",
  scope: "page",
  title: ruleId,
  weight,
  status,
  credit: status === "pass" ? 1 : status === "warn" ? 0.5 : status === "fail" ? 0 : 1,
  applicable: status === "na" ? 0 : 1,
  passed: status === "pass" ? 1 : 0,
  warned: status === "warn" ? 1 : 0,
  failed: status === "fail" ? 1 : 0,
  detail: `${ruleId} ${status}`,
  pointsLost: status === "fail" ? 3 : status === "warn" ? 1.5 : 0,
});

const report = (rules: RuleSummary[]) =>
  ({
    categories: [
      {
        id: "technical",
        name: "Technical",
        weight: 1,
        score: 0,
        passed: 0,
        warned: 0,
        failed: 0,
        na: 0,
        rules,
      },
    ],
  }) as unknown as Parameters<typeof scoreDimensions>[0];

describe("GEO dimensions", () => {
  it("maps every rule in the catalog, with shares summing to 1", () => {
    for (const rule of GEO_RULES) {
      const shares = sharesForRule(rule.id);
      expect(shares, rule.id).toBeTruthy();
      expect(
        shares!.reduce((s, x) => s + x.share, 0),
        rule.id,
      ).toBeCloseTo(1, 5);
    }
    expect(GEO_DIMENSIONS.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1, 5);
    for (const [id, shares] of Object.entries(RULE_DIMENSIONS)) {
      for (const s of shares)
        expect(
          GEO_DIMENSIONS.some((d) => d.id === s.dim),
          id,
        ).toBe(true);
    }
  });

  it("scores from rule credit and excludes N/A", () => {
    const r = scoreDimensions(
      report([
        summary("tech.indexable", "pass"),
        summary("tech.canonical", "fail"),
        summary("tech.hreflang", "na"),
      ]),
    );
    const idx = r.dimensions.find((d) => d.id === "indexability")!;
    // indexable: w2×1×1 · canonical: w2×0.7×0 → 2 / 3.4
    expect(idx.score).toBe(Math.round((2 / 3.4) * 100));
    const tech = r.dimensions.find((d) => d.id === "technical_seo")!;
    expect(tech.na).toBe(1);
    expect(tech.score).toBe(0);
    expect(r.dimensions.find((d) => d.id === "authority_trust")!.score).toBeNull();
  });

  it("weights overall readiness only over dimensions with data", () => {
    const r = scoreDimensions(
      report([summary("ai.llms_txt", "pass"), summary("trust.privacy", "fail")]),
    );
    const ai = r.dimensions.find((d) => d.id === "ai_search")!;
    const trust = r.dimensions.find((d) => d.id === "authority_trust")!;
    expect(ai.score).toBe(100);
    expect(trust.score).toBe(0);
    expect(r.overall).toBe(Math.round((100 * 0.08) / (0.08 + 0.12)));
  });

  it("counts fixable failing checks and orders failures first", () => {
    const r = scoreDimensions(
      report([
        summary("schema.jsonld", "pass"),
        summary("schema.breadcrumbs", "fail"),
        summary("schema.website", "warn"),
      ]),
      (id) => (id === "schema.breadcrumbs" ? "agent" : "manual"),
    );
    const sd = r.dimensions.find((d) => d.id === "structured_data")!;
    expect(sd.fixable).toBe(1);
    expect(sd.checks.map((c) => c.status)).toEqual(["fail", "warn", "pass"]);
  });
});
