// grounding.ts — keeps AI insights tied to the deterministic signals they
// explain. Pure: no I/O, fully unit-tested.
import { z } from "zod";
import type { Signal } from "./signals";
import type { InsightItem } from "./types";

export const MAX_INSIGHTS = 4;

export const InsightSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        summary: z.string().min(10).max(500),
        source: z.enum(["mellox", "ga4", "gsc", "geo"]),
        signalIds: z.array(z.string().max(700)).min(1).max(6),
        severity: z.enum(["positive", "watch", "negative"]),
        recommendation: z.string().min(10).max(400),
      }),
    )
    .max(6),
});

const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * Keep only insights grounded in the signals: known ids, a single source, and
 * no number that doesn't appear in the cited facts.
 */
export function groundInsights(
  raw: z.infer<typeof InsightSchema>["insights"],
  signals: Signal[],
): InsightItem[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const out: InsightItem[] = [];
  for (const item of raw) {
    const cited = [...new Set(item.signalIds)]
      .map((id) => byId.get(id))
      .filter((s): s is Signal => !!s);
    if (!cited.length) continue;
    const source = cited[0].source;
    // Never let one insight blend sources (GA4 sessions ≠ Search Console clicks ≠ GEO score).
    if (cited.some((s) => s.source !== source) || item.source !== source) continue;
    const allowed = new Set(
      cited.flatMap((s) => `${s.fact} ${s.label} ${s.value ?? ""}`.match(NUMBER) ?? []),
    );
    const text = `${item.title} ${item.summary} ${item.recommendation}`;
    if ((text.match(NUMBER) ?? []).some((n) => !allowed.has(n))) continue;
    out.push({
      title: item.title.trim(),
      summary: item.summary.trim(),
      source,
      signalIds: cited.map((s) => s.id),
      severity: item.severity,
      recommendation: item.recommendation.trim(),
    });
    if (out.length >= MAX_INSIGHTS) break;
  }
  return out;
}
