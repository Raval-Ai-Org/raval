// text.ts — shared text primitives for the page analyzers (ports of the GEO
// module's tokenize / stop-word / sentence helpers).

export const STOP_WORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before " +
    "being below between both but by can can't cannot could couldn't did didn't do does doesn't " +
    "doing don't down during each few for from further had hadn't has hasn't have haven't having " +
    "he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've " +
    "if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off " +
    "on once only or other ought our ours ourselves out over own same shan't she she'd she'll " +
    "she's should shouldn't so some such than that that's the their theirs them themselves then " +
    "there there's these they they'd they'll they're they've this those through to too under " +
    "until up very was wasn't we we'd we'll we're we've were weren't what what's when when's " +
    "where where's which while who who's whom why why's with won't would wouldn't you you'd " +
    "you'll you're you've your yours yourself yourselves will just also like get use make one two " +
    "new navigation menu search skip copyright rights reserved privacy terms page website site " +
    "cookies cookie accept login sign read learn click"
  ).split(/\s+/),
);

export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

export function wordCount(text: string | null | undefined): number {
  return words(text).length;
}

/** Lowercase alphanumeric tokens of 3+ characters. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? [];
}

export function meaningfulTokens(text: string | null | undefined): string[] {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t));
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Split prose into sentences at terminal punctuation followed by a capital or digit. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function countBy<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}

/** Entries sorted by count desc, then first occurrence (stable, deterministic). */
export function mostCommon<T>(counts: Map<T, number>, n: number): [T, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
