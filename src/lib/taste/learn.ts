// Reactions in, taste out. Pure: counts only, with the thresholds in
// contracts.ts, so one loved post never becomes a rule.

import {
  MIN_LESSES,
  MIN_LOVES,
  TASTE_WINDOW,
  TRAIT_KINDS,
  type Lean,
  type Reaction,
  type Taste,
  type TraitKind,
  type Traits,
} from "./contracts";

export type ReactionRow = { reaction: Reaction; traits: Traits };

export function learnTaste(rows: readonly ReactionRow[]): Taste {
  const window = rows.slice(0, TASTE_WINDOW);
  const counts = new Map<string, { love: number; less: number }>();
  let loves = 0;
  let lesses = 0;
  for (const row of window) {
    if (row.reaction === "love") loves++;
    else lesses++;
    for (const kind of TRAIT_KINDS) {
      const value = row.traits[kind];
      if (!value) continue;
      const key = `${kind}\u0000${value}`;
      const c = counts.get(key) ?? { love: 0, less: 0 };
      c[row.reaction]++;
      counts.set(key, c);
    }
  }
  const lean: Partial<Record<TraitKind, Lean>> = {};
  // Most-loved first, so the strongest preference leads the prompt and chips.
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1].love - a[1].love || a[1].less - b[1].less || a[0].localeCompare(b[0]),
  );
  for (const [key, c] of sorted) {
    const [kind, value] = key.split("\u0000") as [TraitKind, string];
    const liked = c.love >= MIN_LOVES && c.love > c.less;
    const avoided = !liked && c.less >= MIN_LESSES && c.less >= c.love;
    if (!liked && !avoided) continue;
    const l = (lean[kind] ??= { liked: [], avoided: [] });
    (liked ? l.liked : l.avoided).push(value);
  }
  return { loves, lesses, lean };
}

/** How many more loves before anything can be learned (0 once something is). */
export function lovesToLearn(taste: Taste): number {
  const learned = Object.values(taste.lean).some((l) => l && (l.liked.length || l.avoided.length));
  if (learned) return 0;
  return Math.max(0, MIN_LOVES - taste.loves) || 1;
}

/** True when the taste carries any preference at all. */
export function hasLean(taste: Taste | null | undefined): taste is Taste {
  return (
    !!taste && Object.values(taste.lean).some((l) => l && (l.liked.length || l.avoided.length))
  );
}
