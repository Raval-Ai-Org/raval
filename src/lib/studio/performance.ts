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
