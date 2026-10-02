// path.ts — "what stands between this site and 100". Built from the rule
// summaries score.ts already produced: every lost point is attributed to one
// rule, and every rule to who can close it. Nothing is re-evaluated.

import { scoreDimensions } from "./dimensions";
import type { DimensionSummary, FixRoute, PathStep, PathTo100, ScanReport } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildPathTo100(
  report: Pick<ScanReport, "categories">,
  routeFor: (ruleId: string) => FixRoute,
): PathTo100 {
  const steps: PathStep[] = report.categories
    .flatMap((c) => c.rules)
    .filter((r) => r.pointsLost > 0)
    .map((r) => ({
      ruleId: r.ruleId,
      title: r.title,
      points: r.pointsLost,
      affectedPages: r.scope === "page" ? r.warned + r.failed : 0,
      route: routeFor(r.ruleId),
    }))
    .sort((a, b) => b.points - a.points);
  const sum = (route: FixRoute) =>
    round1(steps.filter((s) => s.route === route).reduce((n, s) => n + s.points, 0));
  return {
    auto: sum("auto"),
    needsInput: sum("needs_input"),
    manual: sum("manual"),
    steps: steps.slice(0, 40),
  };
}

export function summarizeDimensions(report: Pick<ScanReport, "categories">): DimensionSummary[] {
  return scoreDimensions(report).dimensions.map((d) => ({
    id: d.id,
    name: d.name,
    question: d.question,
    score: d.score,
    failed: d.failed,
    warned: d.warned,
  }));
}
