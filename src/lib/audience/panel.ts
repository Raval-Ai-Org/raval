// Who answers a deeper check, and how their answers become one result. Pure.
import {
  STANCES,
  type Dimensions,
  type PulseResult,
  type Reaction,
  type SegmentScore,
  type Stance,
  type TournamentOutput,
  type TournamentVariant,
  type Confidence,
} from "./contracts";
import { normalizeText } from "./hash";
import { averageDimensions, clampScore, cleanDimensions, overallOf } from "./score";

/** Simulated people across the whole panel. This is the cost ceiling of a check. */
export const PANEL_PEOPLE = 20;
const MIN_PER_TWIN = 3;
const MAX_PER_TWIN = 8;

export type PanelSeat = { twinId: string; people: number };

/** Split the panel across groups by their share of the audience. Same input, same seats. */
export function panelPlan(
  twins: { id: string; weight: number }[],
  total = PANEL_PEOPLE,
): PanelSeat[] {
  if (!twins.length) return [];
  const weight = twins.reduce((sum, t) => sum + Math.max(1, t.weight), 0);
  return twins.map((twin) => ({
    twinId: twin.id,
    people: Math.max(
      MIN_PER_TWIN,
      Math.min(MAX_PER_TWIN, Math.round((Math.max(1, twin.weight) / weight) * total)),
    ),
  }));
}

export const STANCE_VALUE: Record<Stance, number> = {
  love: 100,
  like: 75,
  neutral: 50,
  skip: 28,
  dislike: 8,
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function list(value: unknown, max: number, each = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, each))
    .filter(Boolean)
    .slice(0, max);
}

/** One group's answer, as the model returned it, made safe to store. */
export type TwinAnswer = {
  twinId: string;
  twinName: string;
  weight: number;
  dimensions: Dimensions;
  people: { who: string; stance: Stance; quote: string; wouldAct: boolean }[];
  likes: string[];
  objections: string[];
};

export function cleanTwinAnswer(
  raw: unknown,
  twin: { id: string; name: string; weight: number },
  seats: number,
): TwinAnswer | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!record) return null;
  const people = (Array.isArray(record.people) ? record.people : [])
    .map((row) => {
      const p = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const stance = STANCES.includes(p.stance as Stance) ? (p.stance as Stance) : null;
      const quote = text(p.quote, 240);
      if (!stance || !quote) return null;
      return {
        who: text(p.who, 80) || "Someone in this group",
        stance,
        quote,
        wouldAct: p.wouldAct === true,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, seats);
  // An answer with nobody in it is not an answer.
  if (!people.length) return null;
  return {
    twinId: twin.id,
    twinName: twin.name,
    weight: twin.weight,
    dimensions: cleanDimensions(record.dimensions),
    people,
    likes: list(record.likes, 3),
    objections: list(record.objections, 3),
  };
}

function stanceMean(people: { stance: Stance }[]): number {
  if (!people.length) return 50;
  return people.reduce((sum, p) => sum + STANCE_VALUE[p.stance], 0) / people.length;
}

/** A group's score: what it said about the piece, and how its people reacted. */
export function twinScore(answer: Pick<TwinAnswer, "dimensions" | "people">): number {
  return clampScore(0.6 * overallOf(answer.dimensions) + 0.4 * stanceMean(answer.people));
}

function dedupeLines(lines: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = normalizeText(line).replace(/[^a-z0-9 ]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export type PulseAggregate = { overall: number; dimensions: Dimensions; pulse: PulseResult };

/** Every group's answer, weighted by its share of the audience. */
export function aggregatePulse(answers: TwinAnswer[]): PulseAggregate | null {
  if (!answers.length) return null;
  const weight = answers.reduce((sum, a) => sum + Math.max(1, a.weight), 0);
  const dimensions = averageDimensions(
    answers.map((a) => ({ dimensions: a.dimensions, weight: Math.max(1, a.weight) })),
  );
  const overall = clampScore(
    answers.reduce((sum, a) => sum + twinScore(a) * Math.max(1, a.weight), 0) / weight,
  );

  const reactions: Reaction[] = [];
  let positive = 0;
  let neutral = 0;
  for (const answer of answers) {
    for (const person of answer.people) {
      reactions.push({ twinId: answer.twinId, twinName: answer.twinName, ...person });
      if (person.stance === "love" || person.stance === "like") positive++;
      else if (person.stance === "neutral") neutral++;
    }
  }
  const people = reactions.length || 1;
  const pos = Math.round((positive / people) * 100);
  const neu = Math.round((neutral / people) * 100);

  const segments: SegmentScore[] = answers
    .map((a) => ({
      twinId: a.twinId,
      name: a.twinName,
      score: twinScore(a),
      note: a.objections[0] ?? a.likes[0] ?? "",
    }))
    .sort((a, b) => b.score - a.score);

  return {
    overall,
    dimensions,
    pulse: {
      sentiment: { positive: pos, neutral: neu, negative: Math.max(0, 100 - pos - neu) },
      reactions,
      segments,
      strengths: dedupeLines(
        answers.flatMap((a) => a.likes),
        4,
      ),
      objections: dedupeLines(
        answers.flatMap((a) => a.objections),
        4,
      ),
      people: reactions.length,
    },
  };
}

/** Largest gap between two groups; above this the piece splits the audience. */
export function segmentSpread(segments: SegmentScore[]): number {
  if (segments.length < 2) return 0;
  const scores = segments.map((s) => s.score);
  return Math.max(...scores) - Math.min(...scores);
}

/* ───────────────────────── comparing versions ───────────────────────── */

/** Inside this many points two versions are a coin toss, and Mellox says so. */
export const TOO_CLOSE_MARGIN = 4;

/** One group's view of every version, side by side. */
export type TwinJudgement = {
  twinId: string;
  weight: number;
  /** One entry per version, in order. */
  scores: Dimensions[];
  /** How many of the group's people picked each version. */
  picks: number[];
  reasons: string[];
};

export function cleanJudgement(
  raw: unknown,
  twin: { id: string; weight: number },
  versions: number,
  seats: number,
): TwinJudgement | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = record && Array.isArray(record.versions) ? record.versions : null;
  if (!rows) return null;
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const index = typeof r.index === "number" ? Math.round(r.index) : -1;
    if (index >= 0 && index < versions && !byIndex.has(index)) byIndex.set(index, r);
  }
  // Every version must be judged, or the comparison is not a comparison.
  if (byIndex.size !== versions) return null;
  const scores: Dimensions[] = [];
  const picks: number[] = [];
  const reasons: string[] = [];
  for (let i = 0; i < versions; i++) {
    const r = byIndex.get(i)!;
    scores.push(cleanDimensions(r.dimensions));
    picks.push(Math.max(0, Math.min(seats, typeof r.picks === "number" ? Math.round(r.picks) : 0)));
    reasons.push(text(r.reason, 220));
  }
  return { twinId: twin.id, weight: twin.weight, scores, picks, reasons };
}

export type VersionInput = {
  ref: string | null;
  label: string;
  title: string;
  body: string;
  isOriginal: boolean;
};

/**
 * Rank versions from every group's judgement. A version's number is mostly how
 * the groups scored it, plus a share for how often their people picked it.
 */
export function rankVersions(
  versions: VersionInput[],
  judgements: TwinJudgement[],
): Pick<TournamentOutput, "variants" | "winnerIndex" | "tooClose" | "margin"> {
  const weight = judgements.reduce((sum, j) => sum + Math.max(1, j.weight), 0) || 1;
  const scored = versions.map((version, index) => {
    const dimensions = averageDimensions(
      judgements.map((j) => ({ dimensions: j.scores[index], weight: Math.max(1, j.weight) })),
    );
    let picked = 0;
    for (const j of judgements) {
      const total = j.picks.reduce((sum, n) => sum + n, 0);
      if (total > 0) picked += (j.picks[index] / total) * Math.max(1, j.weight);
    }
    const pickedShare = judgements.length ? Math.round((picked / weight) * 100) : 0;
    // The reason from the group that liked it most.
    const best = [...judgements].sort(
      (a, b) => overallOf(b.scores[index]) - overallOf(a.scores[index]),
    )[0];
    return {
      index,
      ref: version.ref,
      label: version.label,
      title: version.title,
      body: version.body,
      isOriginal: version.isOriginal,
      dimensions,
      picked: pickedShare,
      overall: clampScore(0.8 * overallOf(dimensions) + 0.2 * pickedShare),
      why: best?.reasons[index] ?? "",
      rank: 0,
    } satisfies TournamentVariant;
  });
  const order = [...scored].sort((a, b) => b.overall - a.overall || a.index - b.index);
  order.forEach((variant, i) => {
    scored[variant.index].rank = i + 1;
  });
  const margin = order.length > 1 ? order[0].overall - order[1].overall : 100;
  const tooClose = order.length > 1 && margin < TOO_CLOSE_MARGIN;
  return {
    variants: scored,
    winnerIndex: order.length ? order[0].index : null,
    tooClose,
    margin,
  };
}

/** A comparison is never more certain than "fairly sure" without real results. */
export function tournamentConfidence(tooClose: boolean, base: Confidence): Confidence {
  return tooClose ? "low" : base;
}
