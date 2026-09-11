// ops-watch.ts — the checks behind the ops-watch cron job and the readiness
// probe: missed scheduler runs, AI spend anomalies, webhook rejection spikes
// and output-quality regressions (truncation / parse failures).
import "server-only";

export type Heartbeat = {
  job: string;
  expected_interval_seconds: number;
  last_succeeded_at: string | null;
  last_started_at: string | null;
  last_error: string | null;
};

/** A job is "missed" when it has not succeeded within 3× its interval. */
export function missedHeartbeats(rows: Heartbeat[], now = Date.now()): Heartbeat[] {
  return rows.filter((r) => {
    const last = r.last_succeeded_at ? Date.parse(r.last_succeeded_at) : 0;
    return now - last > r.expected_interval_seconds * 3000;
  });
}

/**
 * Spend anomaly: today's spend is more than `ratio`× the trailing daily
 * average (7 days), and above an absolute floor so a quiet week does not
 * alert on a few cents.
 */
export function spendAnomaly(
  todayUsd: number,
  previousDaysUsd: number[],
  opts: { ratio?: number; floorUsd?: number } = {},
): { anomalous: boolean; baselineUsd: number } {
  const ratio = opts.ratio ?? 3;
  const floor = opts.floorUsd ?? 5;
  const days = previousDaysUsd.filter((d) => Number.isFinite(d));
  const baseline = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
  return { anomalous: todayUsd >= floor && todayUsd > baseline * ratio, baselineUsd: baseline };
}

export async function runOpsWatch(deps: {
  db: any;
  alert: (a: { key: string; severity: "warning" | "critical"; title: string; detail: string }) => Promise<boolean>;
  now?: () => number;
}) {
  const now = deps.now?.() ?? Date.now();
  const alerts: string[] = [];

  // 1. Missed scheduler runs.
  const { data: beats } = await deps.db
    .from("cron_heartbeats")
    .select("job, expected_interval_seconds, last_succeeded_at, last_started_at, last_error");
  for (const hb of missedHeartbeats((beats ?? []) as Heartbeat[], now)) {
    if (hb.job === "ops-watch") continue;
    if (
      await deps.alert({
        key: `missed:${hb.job}`,
        severity: hb.job === "run-schedules" ? "critical" : "warning",
        title: `Scheduled job missed: ${hb.job}`,
        detail: `Last success: ${hb.last_succeeded_at ?? "never"}${hb.last_error ? ` · last error: ${hb.last_error.slice(0, 200)}` : ""}`,
      })
    )
      alerts.push(`missed:${hb.job}`);
  }

  // 2. AI spend anomaly (platform-wide, from the per-workspace daily rollup).
  const since = new Date(now - 8 * 86_400_000).toISOString().slice(0, 10);
  const { data: daily } = await deps.db
    .from("ai_usage_daily")
    .select("day, cost_usd, truncated_calls, calls, scope_key")
    .gte("day", since)
    .like("scope_key", "ws:%");
  const byDay = new Map<string, { cost: number; truncated: number; calls: number }>();
  for (const r of (daily ?? []) as Array<{ day: string; cost_usd: number; truncated_calls: number; calls: number }>) {
    const cur = byDay.get(r.day) ?? { cost: 0, truncated: 0, calls: 0 };
    byDay.set(r.day, {
      cost: cur.cost + Number(r.cost_usd),
      truncated: cur.truncated + Number(r.truncated_calls),
      calls: cur.calls + Number(r.calls),
    });
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const todayRow = byDay.get(today) ?? { cost: 0, truncated: 0, calls: 0 };
  const previous = [...byDay.entries()].filter(([d]) => d !== today).map(([, v]) => v.cost);
  const spend = spendAnomaly(todayRow.cost, previous);
  if (spend.anomalous) {
    if (
      await deps.alert({
        key: `spend:${today}`,
        severity: "critical",
        title: "AI spend anomaly",
        detail: `Today $${todayRow.cost.toFixed(2)} vs trailing average $${spend.baselineUsd.toFixed(2)}/day.`,
      })
    )
      alerts.push("spend");
  }

  // 3. Output quality: truncated completions above 10% of today's calls.
  if (todayRow.calls >= 50 && todayRow.truncated / todayRow.calls > 0.1) {
    if (
      await deps.alert({
        key: `truncation:${today}`,
        severity: "warning",
        title: "Many AI answers are being cut off",
        detail: `${todayRow.truncated} of ${todayRow.calls} calls today hit the output ceiling.`,
      })
    )
      alerts.push("truncation");
  }

  // 4. Webhook rejection spike (possible secret mismatch or forgery).
  const hourAgo = new Date(now - 3600_000).toISOString();
  const { data: rejected } = await deps.db
    .from("sdr_webhook_events")
    .select("id")
    .in("outcome", ["rejected", "stale"])
    .gte("received_at", hourAgo)
    .limit(1000);
  const rejectedCount = (rejected ?? []).length;
  if (rejectedCount >= 20) {
    if (
      await deps.alert({
        key: `webhooks:${today}`,
        severity: "critical",
        title: "Delivery webhooks are being rejected",
        detail: `${rejectedCount} rejected or stale callbacks in the last hour. Check the webhook secret on both services.`,
      })
    )
      alerts.push("webhooks");
  }

  // 5. Retention for operational log tables.
  const { data: pruned } = await deps.db.rpc("prune_operational_logs");

  return { alerts, pruned: pruned ?? null };
}
