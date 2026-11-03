// signals.ts — what the stored threads add up to. Pure.
//
// Only counts of rows that exist: how many threads mention each tracked
// competitor, which questions keep coming back, which communities are busy.
// No reach, ranking or "AI will cite this" claim is ever derived from them.
import { similarity } from "@/lib/studio/ideas";
import type { CommunitySignals, CommunitySource } from "./contracts";

type SignalThread = {
  id: string;
  source: CommunitySource;
  community: string;
  title: string;
  snippet: string;
  competitorName: string | null;
  status: string;
};

/** Two titles about the same question. */
export const SAME_QUESTION_AT = 0.45;
/** A pattern needs at least this many threads. */
export const MIN_PATTERN = 2;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` names `name` as a word (case-insensitive). */
export function mentions(text: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function communitySignals(
  threads: readonly SignalThread[],
  competitors: readonly string[],
): CommunitySignals {
  const live = threads.filter((t) => t.status !== "hidden");

  const competitorMentions = competitors
    .map((name) => ({
      name,
      count: live.filter(
        (t) => t.competitorName === name || mentions(`${t.title} ${t.snippet}`, name),
      ).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const groups: Array<{ question: string; ids: string[] }> = [];
  for (const t of live) {
    const group = groups.find((g) => similarity(g.question, t.title) >= SAME_QUESTION_AT);
    if (group) group.ids.push(t.id);
    else groups.push({ question: t.title, ids: [t.id] });
  }
  const recurringQuestions = groups
    .filter((g) => g.ids.length >= MIN_PATTERN)
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, 5)
    .map((g) => ({ question: g.question, count: g.ids.length, threadIds: g.ids }));

  const byCommunity = new Map<
    string,
    { source: CommunitySource; community: string; count: number }
  >();
  for (const t of live) {
    const key = `${t.source}|${t.community.toLowerCase()}`;
    const entry = byCommunity.get(key) ?? { source: t.source, community: t.community, count: 0 };
    entry.count += 1;
    byCommunity.set(key, entry);
  }
  const activeCommunities = [...byCommunity.values()]
    .filter((c) => c.count >= MIN_PATTERN)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return { competitorMentions, recurringQuestions, activeCommunities };
}
