// phases.ts — the user-facing story of a Brand DNA scan.
//
// Phases are derived from the stages the extraction pipeline really reports
// (src/lib/brand-extract.server.ts). Nothing here is timer-driven: a phase is
// complete only once the server has moved past it.

export type PhaseId = "website" | "identity" | "market" | "voice" | "dna";
export type PhaseStatus = "done" | "active" | "pending";

export const SCAN_PHASES: readonly { id: PhaseId; label: string; detail: string }[] = [
  { id: "website", label: "Reading your website", detail: "Homepage, key pages and sitemap" },
  { id: "identity", label: "Identifying visual identity", detail: "Logo, palette and typography" },
  { id: "market", label: "Researching your market", detail: "Mentions, reviews and competitors" },
  {
    id: "voice",
    label: "Understanding voice & audience",
    detail: "Tone, positioning and who you serve",
  },
  { id: "dna", label: "Building Brand DNA", detail: "Merging every signal into memory" },
];

const STAGE_PHASE: Record<string, number> = {
  fetch_home: 0,
  discover: 0,
  sitemap: 0,
  crawl: 0,
  signals: 1,
  search: 2,
  analyze: 3,
  finalize: 4,
  done: 4,
};

/** Phase index for a server stage, or -1 for stages that carry no position (e.g. "retry"). */
export function phaseIndexForStage(stage: string): number {
  return STAGE_PHASE[stage] ?? -1;
}

/** Furthest phase reached so far. Never moves backwards within a scan. */
export function advancePhase(current: number, stage: string): number {
  return Math.max(current, phaseIndexForStage(stage));
}

export function phaseStatus(index: number, active: number, complete: boolean): PhaseStatus {
  if (complete || index < active) return "done";
  return index === active ? "active" : "pending";
}
