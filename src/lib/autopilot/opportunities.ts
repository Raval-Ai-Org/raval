// Opportunities — deciding which market, competitor and performance signals
// are worth putting in front of a person. Pure.
//
// A model rates how relevant a candidate is to the brand. Everything else is
// decided here: whether it is fresh, whether it has a real source, whether it
// repeats something already shown, and the final score. Titles, links and
// dates always come from the source record, never from the model.
import {
  isLowQualitySource,
  normalizeSourceUrl,
  sourceAuthorityHint,
} from "@/lib/research/sources";
import { similarity, tokens } from "@/lib/studio/ideas";
import {
  OPPORTUNITY_FORMATS,
  type Evidence,
  type OpportunityFormat,
  type OpportunityKind,
} from "./contracts";

export type Candidate = {
  kind: OpportunityKind;
  title: string;
  summary: string;
  evidence: Evidence[];
  sourceKind: string;
  sourceId: string | null;
  significance: "major" | "notable" | "minor";
  /** When the thing happened or was reported; null when the source gave no date. */
  date: string | null;
};

/** The lowest score that is shown at all. */
export const MIN_SCORE = 55;
/** The lowest score a running program may act on without being asked. */
export const AUTO_ACT_SCORE = 78;
/** How many opportunities a program may act on by itself in one week. */
export const AUTO_ACT_PER_WEEK = 2;
export const MAX_CANDIDATES = 14;

const DAY = 86_400_000;

/** How old a signal may be before it is not worth responding to. */
const HORIZON_DAYS: Record<OpportunityKind, number> = {
  news: 10,
  competitor: 21,
  trend: 30,
  customer: 30,
  performance: 14,
};

const SHELF_DAYS: Record<OpportunityKind, number> = {
  news: 7,
  competitor: 14,
  trend: 14,
  customer: 14,
  performance: 10,
};

export function isStale(candidate: Pick<Candidate, "kind" | "date">, now: Date): boolean {
  if (!candidate.date) return candidate.kind === "news";
  const at = Date.parse(candidate.date);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > HORIZON_DAYS[candidate.kind] * DAY;
}

/** 100 today, falling to 0 at the horizon. An undated signal sits in the middle. */
export function freshness(candidate: Pick<Candidate, "kind" | "date">, now: Date): number {
  if (!candidate.date) return 50;
  const age = Math.max(0, now.getTime() - Date.parse(candidate.date)) / DAY;
  return Math.round(Math.max(0, 1 - age / HORIZON_DAYS[candidate.kind]) * 100);
}

export function expiryFor(kind: OpportunityKind, now: Date): string {
  return new Date(now.getTime() + SHELF_DAYS[kind] * DAY).toISOString();
}

/**
 * A stable identity: the source page when there is one, otherwise the words of
 * the title. The same story found by two sweeps collapses to one row.
 */
export function candidateFingerprint(
  candidate: Pick<Candidate, "kind" | "title" | "evidence">,
): string {
  const url = candidate.evidence[0]?.url;
  if (url) return `${candidate.kind}:${normalizeSourceUrl(url)}`.slice(0, 200);
  const words = [...tokens(candidate.title)].sort().slice(0, 10).join("-");
  return `${candidate.kind}:t:${words || "untitled"}`.slice(0, 200);
}

const SAME_STORY_AT = 0.5;

/**
 * What is left after the cheap, certain rejections: no usable source for a
 * web claim, too old, already known, or the same story as something recent.
 */
export function filterCandidates(
  candidates: Candidate[],
  opts: { knownFingerprints: ReadonlySet<string>; recentTitles: string[]; now: Date },
): Candidate[] {
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const evidence = raw.evidence.filter((e) => e.url && !isLowQualitySource(e.url));
    const candidate = { ...raw, evidence };
    // A claim from the web carries its link, or it is not shown.
    if (candidate.kind !== "performance" && evidence.length === 0) continue;
    if (candidate.title.trim().length < 6) continue;
    if (isStale(candidate, opts.now)) continue;
    const fp = candidateFingerprint(candidate);
    if (opts.knownFingerprints.has(fp) || seen.has(fp)) continue;
    if (opts.recentTitles.some((t) => similarity(candidate.title, t) >= SAME_STORY_AT)) continue;
    if (kept.some((k) => similarity(candidate.title, k.title) >= SAME_STORY_AT)) continue;
    seen.add(fp);
    kept.push(candidate);
  }
  const rank = { major: 2, notable: 1, minor: 0 } as const;
  return kept
    .sort(
      (a, b) =>
        rank[b.significance] - rank[a.significance] ||
        freshness(b, opts.now) - freshness(a, opts.now),
    )
    .slice(0, MAX_CANDIDATES);
}

export type ScoreParts = {
  relevance: number;
  freshness: number;
  significance: number;
  authority: number;
};

const SIGNIFICANCE = { major: 100, notable: 65, minor: 35 } as const;
const AUTHORITY = { high: 100, medium: 70, low: 40 } as const;

export function scoreOpportunity(
  candidate: Candidate,
  relevance: number,
  now: Date,
): { score: number; parts: ScoreParts } {
  const parts: ScoreParts = {
    relevance: Math.max(0, Math.min(100, Math.round(relevance))),
    freshness: freshness(candidate, now),
    significance: SIGNIFICANCE[candidate.significance],
    authority: candidate.evidence[0]?.url
      ? AUTHORITY[sourceAuthorityHint(candidate.evidence[0].url)]
      : 70,
  };
  const score = Math.round(
    parts.relevance * 0.5 +
      parts.freshness * 0.2 +
      parts.significance * 0.2 +
      parts.authority * 0.1,
  );
  return { score, parts };
}

export type Rating = {
  index: number;
  relevance: number;
  why: string;
  action: string;
  format?: string;
};

export type RatedCandidate = {
  candidate: Candidate;
  fingerprint: string;
  score: number;
  parts: ScoreParts;
  why: string;
  action: string;
  format: OpportunityFormat;
};

/** A relevance the model itself calls weak is not worth a person's attention. */
const MIN_RELEVANCE = 50;

/**
 * Accept the model's ratings only for candidates it was really shown, once
 * each, and only when the result clears the bar. `isGrounded` lets the caller
 * refuse a reason that states a figure or name the evidence does not contain.
 */
export function acceptRatings(
  candidates: Candidate[],
  ratings: Rating[],
  now: Date,
  isGrounded: (text: string, candidate: Candidate) => boolean = () => true,
): RatedCandidate[] {
  const out: RatedCandidate[] = [];
  const used = new Set<number>();
  for (const rating of ratings) {
    if (!Number.isInteger(rating.index) || used.has(rating.index)) continue;
    const candidate = candidates[rating.index];
    if (!candidate) continue;
    used.add(rating.index);
    const why = (rating.why ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
    const action = (rating.action ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
    if (!Number.isFinite(rating.relevance) || rating.relevance < MIN_RELEVANCE) continue;
    if (why.length < 12 || action.length < 8) continue;
    if (!isGrounded(`${why} ${action}`, candidate)) continue;
    const { score, parts } = scoreOpportunity(candidate, rating.relevance, now);
    if (score < MIN_SCORE) continue;
    out.push({
      candidate,
      fingerprint: candidateFingerprint(candidate),
      score,
      parts,
      why,
      action,
      format: (OPPORTUNITY_FORMATS as readonly string[]).includes(rating.format ?? "")
        ? (rating.format as OpportunityFormat)
        : "social",
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The sources that actually talk about a claim, by shared words. Used to give
 * a Market Brain opportunity (which has no link of its own) the links it rests
 * on. No match means no evidence, and the claim is then not shown.
 */
export function matchEvidence(
  text: string,
  sources: { title: string; url: string; snippet?: string; publishedDate?: string | null }[],
  max = 2,
): Evidence[] {
  const want = tokens(text);
  if (!want.size) return [];
  return sources
    .map((source) => {
      const have = tokens(`${source.title} ${source.snippet ?? ""}`);
      let shared = 0;
      for (const t of want) if (have.has(t)) shared++;
      return { source, shared };
    })
    .filter((m) => m.shared >= 2)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, max)
    .map((m) => ({
      title: m.source.title.slice(0, 200),
      url: m.source.url,
      date: m.source.publishedDate ?? null,
    }));
}

/** The three pieces a "campaign" response is made of, for the platforms in use. */
export function campaignPieces(
  platforms: string[],
): { type: "social" | "carousel"; platform: string }[] {
  const list = platforms.length ? platforms : ["linkedin"];
  const pieces: { type: "social" | "carousel"; platform: string }[] = [
    { type: "social", platform: list[0] },
    {
      type: "carousel",
      platform: list.find((p) => ["instagram", "linkedin", "facebook"].includes(p)) ?? list[0],
    },
    { type: "social", platform: list[1] ?? list[0] },
  ];
  // A carousel only exists on some networks; fall back to a post elsewhere.
  if (!["instagram", "linkedin", "facebook"].includes(pieces[1].platform))
    pieces[1].type = "social";
  return pieces;
}
