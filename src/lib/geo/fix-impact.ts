// fix-impact.ts — "what changed since your fixes went live", from rows that
// already exist: site scans, fixes that are live, and tracked-prompt checks.
// Pure and browser-safe.
//
// It compares before and after the first fix went live. That is a comparison
// in time, not proof that the fixes caused the change, so the UI words it as
// "since your first fix". Nothing is claimed from too little data: a side with
// fewer than MIN_CHECKS answers shows no number at all.

/** Answers needed on each side before a mention rate or a position is shown. */
export const MIN_CHECKS = 5;
/** How far back "before" looks, and how recent "after" is. */
export const WINDOW_DAYS = 28;

const DAY = 86_400_000;

export type ImpactScan = { at: string; score: number; scoreVersion: number };
export type ImpactFix = {
  liveAt: string;
  state: "live" | "checking" | "verified" | "not_fixed";
};
export type ImpactCheck = { at: string; mentioned: boolean; position: number | null };

export type FixImpact = {
  /** When the first fix went live on the website; null when none has. */
  firstFixAt: string | null;
  fixes: { live: number; verified: number; checking: number; notFixed: number };
  /** The last scan before the first fix and the newest scan after it (same score version). */
  score: { before: number; after: number; beforeAt: string; afterAt: string } | null;
  /** Share of AI answers that named the brand, before and after. */
  mentions: { before: number; after: number; checksBefore: number; checksAfter: number } | null;
  /** Average place in the answer when the brand was named (1 is first). */
  position: { before: number; after: number } | null;
  /** What is still missing for a comparison, so the UI can say what to do. */
  waiting: { scan: boolean; checks: boolean };
};

const time = (iso: string) => Date.parse(iso);

function rate(checks: ImpactCheck[]): number {
  return checks.filter((c) => c.mentioned).length / checks.length;
}

function averagePosition(checks: ImpactCheck[]): number | null {
  const placed = checks.filter((c) => c.mentioned && c.position != null);
  if (placed.length < MIN_CHECKS) return null;
  return Math.round((placed.reduce((sum, c) => sum + c.position!, 0) / placed.length) * 10) / 10;
}

export function computeFixImpact(input: {
  scans: ImpactScan[];
  fixes: ImpactFix[];
  checks: ImpactCheck[];
  now?: number;
}): FixImpact {
  const now = input.now ?? Date.now();
  const fixes = input.fixes.filter((f) => Number.isFinite(time(f.liveAt)));
  const counts = {
    live: fixes.length,
    verified: fixes.filter((f) => f.state === "verified").length,
    checking: fixes.filter((f) => f.state === "checking").length,
    notFixed: fixes.filter((f) => f.state === "not_fixed").length,
  };
  if (!fixes.length) {
    return {
      firstFixAt: null,
      fixes: counts,
      score: null,
      mentions: null,
      position: null,
      waiting: { scan: false, checks: false },
    };
  }
  const first = Math.min(...fixes.map((f) => time(f.liveAt)));

  const scans = input.scans
    .filter((s) => Number.isFinite(time(s.at)) && Number.isFinite(s.score))
    .sort((a, b) => time(a.at) - time(b.at));
  const after = [...scans].reverse().find((s) => time(s.at) > first) ?? null;
  // Scores from different versions aren't comparable.
  const before = after
    ? ([...scans]
        .reverse()
        .find((s) => time(s.at) <= first && s.scoreVersion === after.scoreVersion) ?? null)
    : null;

  const window = WINDOW_DAYS * DAY;
  const checksBefore = input.checks.filter((c) => {
    const at = time(c.at);
    return at <= first && at > first - window;
  });
  const checksAfter = input.checks.filter((c) => {
    const at = time(c.at);
    return at > first && at > now - window;
  });
  const enough = checksBefore.length >= MIN_CHECKS && checksAfter.length >= MIN_CHECKS;
  const positionBefore = averagePosition(checksBefore);
  const positionAfter = averagePosition(checksAfter);

  return {
    firstFixAt: new Date(first).toISOString(),
    fixes: counts,
    score:
      before && after
        ? { before: before.score, after: after.score, beforeAt: before.at, afterAt: after.at }
        : null,
    mentions: enough
      ? {
          before: rate(checksBefore),
          after: rate(checksAfter),
          checksBefore: checksBefore.length,
          checksAfter: checksAfter.length,
        }
      : null,
    position:
      positionBefore != null && positionAfter != null
        ? { before: positionBefore, after: positionAfter }
        : null,
    waiting: { scan: !after, checks: !enough },
  };
}
