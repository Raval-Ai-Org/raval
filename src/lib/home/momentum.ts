// Momentum: the top bar's streak and "Mox gets better with every piece" meter
// (Holo's streak chip and 0/25 line). Built only from pieces that were really
// made (finished Studio jobs, read in the free workspace pulse); nothing here
// is estimated, and a missing read shows nothing rather than a zero streak.
//
// Pure and browser-safe. Days are the person's own calendar days, so the
// browser turns the stored timestamps into local dates before calling this.

/** Piece counts where Mox reaches its next level. Add, never reorder. */
export const MOMENTUM_LEVELS = [25, 50, 100, 250, 500, 1000] as const;

export type Momentum = {
  /** Days in a row with at least one piece, ending today or yesterday. */
  streak: number;
  /** Something was made today, so the streak is safe. */
  madeToday: boolean;
  /** A streak that ends today unless something is made. */
  atRisk: boolean;
  /** The last seven days, oldest first: was anything made that day. */
  week: { day: string; made: boolean }[];
  total: number;
  level: {
    /** 1-based; level 1 is the way to the first 25. */
    index: number;
    /** The count where this level starts and where it ends. */
    from: number;
    goal: number;
    /** 0..1 of the way from `from` to `goal`. */
    progress: number;
    /** Every level is done (past the last goal). */
    maxed: boolean;
  };
};

/** A local `YYYY-MM-DD` for a timestamp, in the browser's own time zone. */
export function localDay(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shift(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(y, m - 1, d + by);
  return localDay(at);
}

export function levelFor(total: number): Momentum["level"] {
  const n = Math.max(0, Math.floor(total));
  let from = 0;
  for (let i = 0; i < MOMENTUM_LEVELS.length; i++) {
    const goal = MOMENTUM_LEVELS[i];
    if (n < goal) {
      return { index: i + 1, from, goal, progress: (n - from) / (goal - from), maxed: false };
    }
    from = goal;
  }
  const last = MOMENTUM_LEVELS[MOMENTUM_LEVELS.length - 1];
  return { index: MOMENTUM_LEVELS.length, from: last, goal: last, progress: 1, maxed: true };
}

/**
 * The streak and level from the days pieces were made (any order, repeats
 * fine) and the all-time count. `total` is never less than the days given.
 */
export function momentum(args: { days: string[]; total: number; today: string }): Momentum {
  const made = new Set(args.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  const madeToday = made.has(args.today);
  // A streak is still alive on a day nothing was made yet: it counts up to
  // yesterday and is "at risk" until something is made today.
  let cursor = madeToday ? args.today : shift(args.today, -1);
  let streak = 0;
  while (made.has(cursor)) {
    streak++;
    cursor = shift(cursor, -1);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = shift(args.today, i - 6);
    return { day, made: made.has(day) };
  });
  const total = Math.max(args.total, made.size);
  return {
    streak,
    madeToday,
    atRisk: streak > 0 && !madeToday,
    week,
    total,
    level: levelFor(total),
  };
}

/** The chip's words: "Start your streak!", "3 day streak", "Keep your 3 day streak". */
export function streakLabel(m: Pick<Momentum, "streak" | "atRisk">): string {
  if (m.streak <= 0) return "Start your streak!";
  const days = `${m.streak} day streak`;
  return m.atRisk ? `Keep your ${days}` : days;
}

/** True when `after` reached a level `before` hadn't (for a one-time celebration). */
export function levelledUp(before: number, after: number): boolean {
  return after > before && levelFor(after).index > levelFor(before).index;
}
