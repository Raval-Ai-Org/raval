// classify.ts — keeping the model's read of a thread to what it was given. Pure.
//
// The classifier (route community.classify) only labels and summarises the
// numbered results it was handed. Here its answer is checked: an index it
// invents is dropped, a kind outside the list falls back to the query's own,
// a competitor that isn't tracked is removed, and a thread the model calls
// off-topic is not stored at all. The link, title and community always come
// from the search result, never from the model.
import { MATCH_KINDS, type MatchKind } from "./contracts";
import type { RawThread } from "./threads";

export type ClassifiedThread = RawThread & { summary: string; relevance: number };

/** Below this relevance a thread is not stored. */
export const MIN_RELEVANCE = 40;
const MAX_SUMMARY = 220;

export const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["threads"],
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "kind", "relevance", "summary", "competitor"],
        properties: {
          index: { type: "integer" },
          kind: { type: "string", enum: [...MATCH_KINDS] },
          relevance: { type: "integer" },
          summary: { type: "string" },
          competitor: { type: "string" },
        },
      },
    },
  },
} as const;

type ModelItem = {
  index?: unknown;
  kind?: unknown;
  relevance?: unknown;
  summary?: unknown;
  competitor?: unknown;
};

function oneLine(text: string): string {
  const t = text
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  return t.length > MAX_SUMMARY ? `${t.slice(0, MAX_SUMMARY - 1)}…` : t;
}

export function groundClassification(
  threads: readonly RawThread[],
  answer: { threads?: unknown } | null | undefined,
  competitors: readonly string[],
): ClassifiedThread[] {
  const items = Array.isArray(answer?.threads) ? (answer.threads as ModelItem[]) : [];
  const byIndex = new Map<number, ModelItem>();
  for (const item of items) {
    const i = typeof item.index === "number" ? Math.trunc(item.index) : -1;
    if (i >= 0 && i < threads.length && !byIndex.has(i)) byIndex.set(i, item);
  }
  const tracked = new Map(competitors.map((c) => [c.toLowerCase(), c]));
  const out: ClassifiedThread[] = [];
  threads.forEach((thread, i) => {
    const item = byIndex.get(i);
    // Not judged: kept on the query's own reason with a neutral relevance.
    if (!item) {
      out.push({ ...thread, summary: "", relevance: 50 });
      return;
    }
    const relevance = Math.max(
      0,
      Math.min(100, typeof item.relevance === "number" ? Math.round(item.relevance) : 50),
    );
    if (relevance < MIN_RELEVANCE) return;
    const kind = (MATCH_KINDS as readonly string[]).includes(String(item.kind))
      ? (item.kind as MatchKind)
      : thread.matchedOn;
    const named =
      typeof item.competitor === "string"
        ? tracked.get(item.competitor.trim().toLowerCase())
        : null;
    const competitorName = named ?? thread.competitorName;
    out.push({
      ...thread,
      // A competitor kind needs a tracked competitor behind it.
      matchedOn:
        (kind === "competitor" || kind === "alternative") && !competitorName
          ? thread.matchedOn
          : kind,
      competitorName,
      relevance,
      summary: typeof item.summary === "string" ? oneLine(item.summary) : "",
    });
  });
  return out;
}
