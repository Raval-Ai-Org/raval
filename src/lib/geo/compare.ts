// compare.ts — what changed between two scans of the same site. This replaces
// the GEO module's simulated "validation": a fix is validated by re-scanning
// and seeing its finding disappear, keyed by the finding fingerprint.

import { CATEGORY_BY_ID, type GeoCategoryId, type Severity } from "./types";

export type ComparableFinding = {
  fingerprint: string;
  ruleId: string;
  title: string;
  detail: string;
  severity: Severity;
  category: GeoCategoryId;
  pageUrl: string | null;
  pointImpact: number;
};

export type ComparableScan = {
  id: string;
  createdAt: string;
  overall: number | null;
  categories: { id: GeoCategoryId; score: number }[];
  findings: ComparableFinding[];
};

export type ScanComparison = {
  base: { id: string; createdAt: string; overall: number | null };
  target: { id: string; createdAt: string; overall: number | null };
  overallDelta: number | null;
  categories: {
    id: GeoCategoryId;
    name: string;
    before: number | null;
    after: number | null;
    delta: number | null;
  }[];
  newFindings: ComparableFinding[];
  resolvedFindings: ComparableFinding[];
  persistingCount: number;
  regressions: ComparableFinding[];
  summary: string;
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function byImpact(a: ComparableFinding, b: ComparableFinding) {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.pointImpact - a.pointImpact;
}

export function compareScans(
  base: ComparableScan,
  target: ComparableScan,
  limit = 100,
): ScanComparison {
  const before = new Map(base.findings.map((f) => [f.fingerprint, f]));
  const after = new Map(target.findings.map((f) => [f.fingerprint, f]));

  const newFindings = [...after.values()].filter((f) => !before.has(f.fingerprint)).sort(byImpact);
  const resolvedFindings = [...before.values()]
    .filter((f) => !after.has(f.fingerprint))
    .sort(byImpact);
  const persistingCount = [...after.keys()].filter((k) => before.has(k)).length;
  const regressions = newFindings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high);

  const ids = new Set<GeoCategoryId>([
    ...base.categories.map((c) => c.id),
    ...target.categories.map((c) => c.id),
  ]);
  const categories = [...ids].map((id) => {
    const b = base.categories.find((c) => c.id === id)?.score ?? null;
    const a = target.categories.find((c) => c.id === id)?.score ?? null;
    return {
      id,
      name: CATEGORY_BY_ID[id]?.name ?? id,
      before: b,
      after: a,
      delta: a !== null && b !== null ? a - b : null,
    };
  });

  const overallDelta =
    target.overall !== null && base.overall !== null ? target.overall - base.overall : null;
  const parts = [
    overallDelta === null
      ? "Score unavailable for one of the scans"
      : overallDelta === 0
        ? "Score unchanged"
        : `Score ${overallDelta > 0 ? "up" : "down"} ${Math.abs(overallDelta)} points`,
    `${resolvedFindings.length} issue${resolvedFindings.length === 1 ? "" : "s"} resolved`,
    `${newFindings.length} new`,
    `${persistingCount} still open`,
  ];

  return {
    base: { id: base.id, createdAt: base.createdAt, overall: base.overall },
    target: { id: target.id, createdAt: target.createdAt, overall: target.overall },
    overallDelta,
    categories,
    newFindings: newFindings.slice(0, limit),
    resolvedFindings: resolvedFindings.slice(0, limit),
    persistingCount,
    regressions: regressions.slice(0, 20),
    summary: `${parts.join(" · ")}.`,
  };
}
