import type { AdminOverview } from "./types";

export type AdminOverviewActivityItem = AdminOverview["activity"]["items"][number];

export function buildOverviewActivity(
  items: AdminOverviewActivityItem[],
  options: { now?: Date; windowDays?: number; limit?: number } = {},
): AdminOverview["activity"] {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const limit = options.limit ?? 30;
  const since = now.getTime() - windowDays * 24 * 60 * 60 * 1_000;
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const visible = items
    .filter((item) => {
      const occurredAt = Date.parse(item.occurredAt);
      return Number.isFinite(occurredAt) && occurredAt >= since && occurredAt <= now.getTime();
    })
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, limit);

  return {
    windowDays,
    todayCount: visible.filter((item) => Date.parse(item.occurredAt) >= startOfTodayUtc).length,
    items: visible,
  };
}
