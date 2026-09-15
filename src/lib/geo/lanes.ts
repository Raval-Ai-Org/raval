// lanes.ts — group open findings into the action lanes the dashboard shows.
// A finding sits in exactly one lane, chosen in this order:
//
//   critical      critical severity, or high severity that fails
//   auto_fixable  Mellox can propose the change (deterministic or agent)
//   quick_wins    low effort, meaningful point impact
//   high_impact   the rest with the biggest point impact
//   manual        needs a person (content, legal, hosting)

import type { GeoFindingView } from "./contracts";

export type LaneId = "critical" | "auto_fixable" | "quick_wins" | "high_impact" | "manual";

export const LANES: { id: LaneId; name: string; hint: string }[] = [
  { id: "critical", name: "Critical issues", hint: "Blocks crawlers, indexing or AI engines" },
  {
    id: "auto_fixable",
    name: "Mellox can fix",
    hint: "Planned and implemented by the GEO Engineer, approved by you",
  },
  { id: "quick_wins", name: "Quick wins", hint: "Low effort, visible improvement" },
  { id: "high_impact", name: "High impact", hint: "Largest score gains" },
  { id: "manual", name: "Manual work", hint: "Needs your content, decisions or hosting changes" },
];

export type LaneFinding = Pick<
  GeoFindingView,
  "severity" | "status" | "effort" | "pointImpact" | "state" | "priorityScore"
> & { fixMode?: "deterministic" | "agent" | "manual" | null };

export function laneFor(f: LaneFinding): LaneId {
  if (f.severity === "critical" || (f.severity === "high" && f.status === "fail"))
    return "critical";
  if (f.fixMode === "agent" || f.fixMode === "deterministic") return "auto_fixable";
  if (f.fixMode === "manual")
    return f.effort === "low" && f.pointImpact >= 0.5 ? "quick_wins" : "manual";
  if (f.effort === "low" && f.pointImpact >= 0.5) return "quick_wins";
  return "high_impact";
}

export function groupByLane<T extends LaneFinding>(findings: T[]): Record<LaneId, T[]> {
  const out: Record<LaneId, T[]> = {
    critical: [],
    auto_fixable: [],
    quick_wins: [],
    high_impact: [],
    manual: [],
  };
  for (const f of findings) {
    if (f.state === "resolved" || f.state === "dismissed") continue;
    out[laneFor(f)].push(f);
  }
  for (const k of Object.keys(out) as LaneId[]) {
    out[k].sort((a, b) => b.priorityScore - a.priorityScore || b.pointImpact - a.pointImpact);
  }
  return out;
}
