type Content = { id: string; title: string; status: string };
type Publication = {
  content_item_id: string;
  platform: string;
  status: string;
  metrics: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export type Underperformer = {
  contentItemId: string;
  title: string;
  platform: string;
  views: number;
  /** The usual (median) views on this platform it is compared with. */
  usualViews: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Recent posts that reached far fewer people than this workspace's own usual
 * on the same platform. Needs at least four measured posts on a platform and a
 * usual of 100 views, so a quiet new account is never called a problem.
 * `publications` are expected newest first; only the latest `recent` count.
 */
export function underperformers(
  content: Content[],
  publications: Publication[],
  opts: { recent?: number; ratio?: number } = {},
): Underperformer[] {
  const recent = opts.recent ?? 3;
  const ratio = opts.ratio ?? 0.4;
  const byId = new Map(content.map((item) => [item.id, item]));
  const byPlatform = new Map<string, { id: string; views: number }[]>();
  const seen = new Set<string>();
  for (const row of publications) {
    if (row.status !== "published" || !byId.has(row.content_item_id)) continue;
    const key = `${row.platform}:${row.content_item_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const views = count(record(row.metrics).views);
    if (views <= 0) continue;
    const list = byPlatform.get(row.platform) ?? [];
    list.push({ id: row.content_item_id, views });
    byPlatform.set(row.platform, list);
  }
  const out: Underperformer[] = [];
  for (const [platform, rows] of byPlatform) {
    if (rows.length < 4) continue;
    const usual = median(rows.map((r) => r.views));
    if (usual < 100) continue;
    for (const row of rows.slice(0, recent)) {
      if (row.views < usual * ratio) {
        out.push({
          contentItemId: row.id,
          title: byId.get(row.id)!.title,
          platform,
          views: row.views,
          usualViews: Math.round(usual),
        });
      }
    }
  }
  return out;
}

/** Measured examples only. Require a viewing sample so a single like cannot dominate. */
export function recentPerformanceSignals(
  content: Content[],
  publications: Publication[],
  limit = 3,
): string[] {
  const byId = new Map(
    content.filter((item) => item.status !== "rejected").map((item) => [item.id, item]),
  );
  const seen = new Set<string>();
  return publications
    .filter((row) => row.status === "published" && byId.has(row.content_item_id))
    .map((row) => {
      const metrics = record(row.metrics);
      const views = count(metrics.views);
      const saves = count(metrics.saves);
      const shares = count(metrics.shares);
      const comments = count(metrics.comments);
      const likes = count(metrics.likes);
      return {
        row,
        views,
        saves,
        shares,
        comments,
        likes,
        score: views >= 100 ? (saves * 3 + shares * 3 + comments * 2 + likes) / views : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      if (seen.has(item.row.content_item_id)) return false;
      seen.add(item.row.content_item_id);
      return true;
    })
    .slice(0, limit)
    .map(
      (item) =>
        `${byId.get(item.row.content_item_id)!.title} (${item.row.platform}; ${item.views} views, ${item.saves} saves, ${item.shares} shares, ${item.comments} comments)`,
    );
}
