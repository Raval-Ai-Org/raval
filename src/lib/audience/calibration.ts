// Predicted versus real: turning a published post's numbers into a comparable
// result, and letting real results correct future scores. Pure.
//
// The rules that keep this honest:
//   * a post needs MIN_VIEWS views before its reactions mean anything;
//   * "actual" is a place among the workspace's OWN posts on the same network,
//     and needs MIN_COMPARE of them;
//   * nothing is adjusted from fewer than MIN_PAIRS predicted/actual pairs, and
//     even then the correction is shrunk until there are many;
//   * a pattern needs MIN_GROUP posts on each side.
import { clampScore } from "./score";

export const MIN_VIEWS = 100;
export const MIN_COMPARE = 8;
export const MIN_PAIRS = 8;
export const MIN_GROUP = 2;
/** The correction reaches half strength at this many pairs. */
export const SHRINK_AT = 20;
/** A correction never moves a score by more than this. */
export const MAX_SHIFT = 15;
export const OUTCOME_AFTER_DAYS = 7;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export type PostMetrics = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
};

export function readMetrics(raw: unknown): PostMetrics {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    views: count(m.views),
    likes: count(m.likes),
    comments: count(m.comments),
    shares: count(m.shares),
    saves: count(m.saves),
  };
}

/** Same weighting as Studio's performance read. NULL below the viewing sample. */
export function engagementRate(metrics: PostMetrics): number | null {
  if (metrics.views < MIN_VIEWS) return null;
  return (
    (metrics.saves * 3 + metrics.shares * 3 + metrics.comments * 2 + metrics.likes) / metrics.views
  );
}

/**
 * Where `value` sits among `all` (which includes it), 0-100. NULL until there
 * are enough posts to compare with. Ties share the middle of their range.
 */
export function percentileAmong(value: number, all: number[]): number | null {
  if (all.length < MIN_COMPARE) return null;
  let below = 0;
  let equal = 0;
  for (const other of all) {
    if (other < value) below++;
    else if (other === value) equal++;
  }
  return clampScore(((below + equal / 2) / all.length) * 100);
}

/** Is a published post ready to be frozen as a result? */
export function outcomeReady(args: {
  deliveredAt: string | null;
  metricsSyncedAt: string | null;
  now: Date;
}): boolean {
  if (!args.deliveredAt || !args.metricsSyncedAt) return false;
  const delivered = Date.parse(args.deliveredAt);
  const synced = Date.parse(args.metricsSyncedAt);
  if (!Number.isFinite(delivered) || !Number.isFinite(synced)) return false;
  const horizon = delivered + OUTCOME_AFTER_DAYS * 86_400_000;
  // The numbers must have been read after the window closed, not before.
  return args.now.getTime() >= horizon && synced >= horizon;
}

export type Pair = { predicted: number; actual: number };

export type Calibration = { n: number; bias: number; mae: number };

export function calibrate(pairs: Pair[]): Calibration {
  if (!pairs.length) return { n: 0, bias: 0, mae: 0 };
  const diffs = pairs.map((p) => p.predicted - p.actual);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    n: pairs.length,
    bias: round(diffs.reduce((a, b) => a + b, 0) / diffs.length),
    mae: round(diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length),
  };
}

/** How many points to take off (positive) or add (negative) to a new score. */
export function shrunkShift(
  calibration: Pick<Calibration, "n" | "bias"> | null | undefined,
): number {
  if (!calibration || calibration.n < MIN_PAIRS) return 0;
  const shift = calibration.bias * (calibration.n / (calibration.n + SHRINK_AT));
  return Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(shift)));
}

export function applyCalibration(
  overall: number,
  calibration: Pick<Calibration, "n" | "bias"> | null | undefined,
): { overall: number; calibrated: boolean; measuredPosts: number } {
  const shift = shrunkShift(calibration);
  return {
    overall: clampScore(overall - shift),
    calibrated: shift !== 0,
    measuredPosts: calibration && calibration.n >= MIN_PAIRS ? calibration.n : 0,
  };
}

/* ───────────────────────── learned patterns ───────────────────────── */

export type MeasuredPost = {
  title: string;
  platform: string;
  contentType: string;
  engagement: number;
  /** Characters in the post, when known. */
  length?: number;
  /** True when the opening line is a question. */
  question?: boolean;
};

const LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  social: "text posts",
  image: "image posts",
  carousel: "carousels",
  video: "videos",
  script: "videos",
  ad: "ads",
};

const label = (key: string) => LABEL[key] ?? key;
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function groups(posts: MeasuredPost[], key: (p: MeasuredPost) => string | null) {
  const map = new Map<string, number[]>();
  for (const post of posts) {
    const k = key(post);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), post.engagement]);
  }
  return [...map.entries()]
    .filter(([, values]) => values.length >= MIN_GROUP)
    .map(([name, values]) => ({ name, avg: values.reduce((a, b) => a + b, 0) / values.length }))
    .sort((a, b) => b.avg - a.avg);
}

/** A gap this size or larger between two groups is worth saying out loud. */
const CLEAR_GAP = 1.3;

/**
 * Up to four plain sentences about what this audience really responds to,
 * strongest first. Empty until there is enough to go on.
 */
export function learnedPatterns(posts: MeasuredPost[]): string[] {
  const measured = posts.filter((p) => p.engagement > 0);
  if (measured.length < 4) return [];
  const out: string[] = [];

  const formats = groups(measured, (p) => p.contentType || null);
  if (formats.length >= 2 && formats[0].avg >= formats[formats.length - 1].avg * CLEAR_GAP) {
    out.push(
      `${cap(label(formats[0].name))} get more reactions than ${label(formats[formats.length - 1].name)}.`,
    );
  }

  const platforms = groups(measured, (p) => p.platform || null);
  if (
    platforms.length >= 2 &&
    platforms[0].avg >= platforms[platforms.length - 1].avg * CLEAR_GAP
  ) {
    out.push(
      `People react more on ${label(platforms[0].name)} than on ${label(platforms[platforms.length - 1].name)}.`,
    );
  }

  const withLength = measured.filter((p) => typeof p.length === "number" && p.length > 0);
  const lengths = groups(withLength, (p) => ((p.length as number) <= 400 ? "short" : "long"));
  if (lengths.length === 2 && lengths[0].avg >= lengths[1].avg * CLEAR_GAP) {
    out.push(
      lengths[0].name === "short"
        ? "Shorter posts get more reactions than long ones."
        : "Longer posts get more reactions than short ones.",
    );
  }

  const withOpening = measured.filter((p) => typeof p.question === "boolean");
  const openings = groups(withOpening, (p) => (p.question ? "question" : "statement"));
  if (openings.length === 2 && openings[0].avg >= openings[1].avg * CLEAR_GAP) {
    out.push(
      openings[0].name === "question"
        ? "Posts that open with a question get more reactions."
        : "Posts that open with a statement get more reactions than ones that open with a question.",
    );
  }
  return out.slice(0, 4);
}
